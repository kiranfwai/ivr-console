import { NextRequest, NextResponse } from "next/server";
import { listClients } from "@/lib/clients";
import { getGlobalPricing } from "@/lib/pricing";
import { listCalls } from "@/lib/calls";
import { deriveOutcome } from "@/lib/outcome";
import { runWithTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin caller-level drill-down (across clients).
 *   GET ?client=<id|all>&from=&to=&status=&limit=
 *     client  — a specific client id, or "all"/"" for every client (+ legacy)
 *     status  — connected | failed | no-answer | busy (optional filter)
 *
 * Returns each individual call (caller number, client, campaign, outcome,
 * duration, per-call charge, time) plus totals. Calls are tenant-scoped, so we
 * read each client's calls inside runWithTenant(clientId). Admin-only (enforced
 * in middleware).
 */

const STATUS_GROUPS: Record<string, Set<string>> = {
  connected: new Set(["press1", "connected"]),
  busy: new Set(["busy"]),
  "no-answer": new Set(["no-answer"]),
  failed: new Set(["rejected", "error", "failed"]),
};

function istToday(): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

interface CallerRow {
  clientId: string;
  clientName: string;
  to: string;
  campaignName: string;
  outcome: string;
  durationSec: number | null;
  charge: number;
  triggeredAt: string;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const today = istToday();
  const from = url.searchParams.get("from") || today;
  const to = url.searchParams.get("to") || from;
  const status = url.searchParams.get("status") || "";
  const clientParam = url.searchParams.get("client") || "all";
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || "1000")), 5000);

  const [pricing, clients] = await Promise.all([getGlobalPricing(), listClients()]);
  const rateOf = (perConn: number | null) => (perConn == null ? pricing.perConnectedCall : perConn);

  // Which tenants to scan. A specific client → just that one; else every client
  // plus the tenant-less legacy bucket (pre-tenancy calls).
  const specific = clientParam !== "all" && clientParam !== "";
  const targets = specific
    ? clients.filter((c) => c.id === clientParam)
    : clients;

  const group = STATUS_GROUPS[status];

  async function rowsForTenant(
    id: string,
    name: string,
    rate: number,
  ): Promise<CallerRow[]> {
    const calls = await runWithTenant(id, () => listCalls({ from, to, limit }));
    return calls.map((c) => {
      const settled = c.hangupAt || c.status === "failed";
      const outcome = settled ? deriveOutcome(c.hangupCause, c.digit, !!c.answeredAt) : "in-progress";
      const connected = outcome === "connected" || outcome === "press1";
      return {
        clientId: id,
        clientName: name,
        to: c.to,
        campaignName: c.campaignName || "",
        outcome,
        durationSec: c.durationSec ?? null,
        charge: connected ? rate : 0,
        triggeredAt: c.triggeredAt,
      };
    });
  }

  const perTenant = await Promise.all(
    targets.map((c) => rowsForTenant(c.id, c.name || c.email, rateOf(c.perConnectedCall))),
  );
  let rows = perTenant.flat();

  // Legacy / unassigned (tenant-less) calls, only when viewing all clients.
  if (!specific) {
    const legacy = await rowsForTenant("", "Pryank", pricing.perConnectedCall);
    rows = rows.concat(legacy);
  }

  if (group) rows = rows.filter((r) => group.has(r.outcome));

  // Newest first, capped.
  rows.sort((a, b) => (a.triggeredAt < b.triggeredAt ? 1 : a.triggeredAt > b.triggeredAt ? -1 : 0));
  const capped = rows.length > limit;
  rows = rows.slice(0, limit);

  const totals = rows.reduce(
    (t, r) => {
      const connected = r.outcome === "connected" || r.outcome === "press1";
      return {
        total: t.total + 1,
        connected: t.connected + (connected ? 1 : 0),
        charge: Math.round((t.charge + r.charge) * 100) / 100,
      };
    },
    { total: 0, connected: 0, charge: 0 },
  );

  return NextResponse.json({
    range: { from, to },
    currency: pricing.currency,
    rows,
    totals,
    capped,
  });
}
