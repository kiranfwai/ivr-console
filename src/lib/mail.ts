import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound email, sent by the app itself over SMTP.
 *
 * Configuration is a single connection string so it works with whatever mail
 * account FWAI already has — Google Workspace, Zoho, anything that speaks SMTP:
 *
 *   SMTP_URL   smtps://user%40freedomwithai.com:app-password@smtp.gmail.com:465
 *   MAIL_FROM  "IVR Console <ivr@freedomwithai.com>"   (defaults to the SMTP user)
 *   MAIL_TO    where internal alerts land; comma-separated for more than one
 *
 * With SMTP_URL unset nothing is sent and every call reports back why. That is
 * the deliberate local/dev default: the sandbox must never mail anyone, and a
 * missing config must never take a request down with it.
 *
 * Note the "@" in a mailbox username has to be percent-encoded as %40, or the
 * URL parser reads it as the host separator.
 */

let cached: Transporter | null | undefined;

function transport(): Transporter | null {
  if (cached !== undefined) return cached;
  const url = process.env.SMTP_URL;
  cached = url
    ? nodemailer.createTransport(url, {
        // A wedged SMTP server must not hold an HTTP request open.
        connectionTimeout: 8_000,
        greetingTimeout: 8_000,
        socketTimeout: 12_000,
      })
    : null;
  return cached;
}

function defaultFrom(): string {
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  try {
    const user = decodeURIComponent(new URL(process.env.SMTP_URL || "").username || "");
    return user ? `IVR Console <${user}>` : "IVR Console";
  } catch {
    return "IVR Console";
  }
}

export interface MailResult {
  ok: boolean;
  /** Why it did not send — safe to store, never shown to the public. */
  error?: string;
}

export interface MailInput {
  subject: string;
  text: string;
  html?: string;
  /** Defaults to MAIL_TO. */
  to?: string;
  /** So hitting reply in the inbox answers the person who wrote in. */
  replyTo?: string;
}

/**
 * Send one email. Never throws — callers decide what a failure means, and for
 * every current caller the answer is "carry on, the row is already saved".
 */
export async function sendMail({ subject, text, html, to, replyTo }: MailInput): Promise<MailResult> {
  const t = transport();
  if (!t) return { ok: false, error: "SMTP_URL is not set — email disabled" };

  const recipients = (to || process.env.MAIL_TO || "").trim();
  if (!recipients) return { ok: false, error: "no recipient — set MAIL_TO" };

  try {
    await t.sendMail({ from: defaultFrom(), to: recipients, subject, text, html, replyTo });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** True when the app is actually able to send. Used by health/diagnostics. */
export function mailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL && (process.env.MAIL_TO || "").trim());
}
