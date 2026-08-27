import { NextRequest, NextResponse } from "next/server";
import { query, ensureSchema } from "@/lib/db";
import { newId } from "@/lib/redis";
import { sendMail } from "@/lib/mail";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * "Request access" from the public landing page.
 *
 * This is one of the very few endpoints reachable without a session, so it
 * validates hard, caps how often one address may post, and never reflects
 * anything back that would let it be used as a probe. The row is written first
 * and the alert email attempted second: if mail is down the lead is still saved
 * and `notify_error` records why nobody was told.
 */

const MAX_PER_IP_PER_HOUR = 5;

function clean(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || req.headers.get("x-real-ip") || "").trim().slice(0, 64);
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  const name = clean(body.name, 120);
  const company = clean(body.company, 160);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone, 20).replace(/\D/g, "");
  const consent = body.consent === true;

  // Same rules the form enforces, restated here — the form is not the gate.
  const invalid =
    name.length < 2
      ? "name"
      : company.length < 2
        ? "company"
        : !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
          ? "email"
          : !/^[6-9]\d{9}$/.test(phone)
            ? "phone"
            : null;
  if (invalid) {
    return NextResponse.json({ ok: false, field: invalid }, { status: 400 });
  }

  await ensureSchema();
  const ip = clientIp(req);

  // Flood guard. Deliberately answers ok:true so a bot learns nothing from it.
  if (ip) {
    const { rows } = await query<{ n: string }>(
      `SELECT count(*) AS n FROM access_request
        WHERE ip = $1 AND created_at > now() - interval '1 hour'`,
      [ip],
    );
    if (Number(rows[0]?.n || 0) >= MAX_PER_IP_PER_HOUR) {
      return NextResponse.json({ ok: true });
    }
  }

  const id = newId("req");
  await query(
    `INSERT INTO access_request (id, name, company, email, phone, consent, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, name, company, email, phone, consent, ip || null, req.headers.get("user-agent")?.slice(0, 300) || null],
  );

  const lines = [
    `Name:     ${name}`,
    `Company:  ${company}`,
    `Email:    ${email}`,
    `WhatsApp: +91 ${phone}`,
    `Consent:  ${consent ? "yes" : "no"}`,
    ``,
    `Received: ${new Date().toISOString()}`,
    `Ref:      ${id}`,
  ].join("\n");

  const html = `
    <div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;line-height:1.6;color:#111">
      <h2 style="margin:0 0 4px;font-size:18px">New access request</h2>
      <p style="margin:0 0 16px;color:#666;font-size:13px">IVR Console — from the landing page</p>
      <table style="border-collapse:collapse;font-size:14px">
        ${[
          ["Name", esc(name)],
          ["Company", esc(company)],
          ["Email", `<a href="mailto:${esc(email)}">${esc(email)}</a>`],
          ["WhatsApp", `<a href="https://wa.me/91${phone}">+91 ${phone}</a>`],
          ["Consent", consent ? "yes" : "no"],
        ]
          .map(
            ([k, v]) =>
              `<tr><td style="padding:4px 16px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><b>${v}</b></td></tr>`,
          )
          .join("")}
      </table>
      <p style="margin:18px 0 0;color:#999;font-size:12px">Ref ${id}</p>
    </div>`;

  const mail = await sendMail({
    subject: `New access request — ${name} (${company})`,
    text: lines,
    html,
    replyTo: email, // replying in the inbox answers the person directly
  });

  await query(
    `UPDATE access_request
        SET notified_at = $2, notify_error = $3
      WHERE id = $1`,
    [id, mail.ok ? new Date() : null, mail.ok ? null : (mail.error || "unknown").slice(0, 500)],
  );

  if (!mail.ok) {
    // Loud in the server log, silent to the visitor — their request did land.
    console.error(`[access-request] ${id} saved but not emailed: ${mail.error}`);
  }

  return NextResponse.json({ ok: true });
}
