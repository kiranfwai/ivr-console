import { getClientPlivoCreds } from "./plivo-config";
import { listAccountNumbers, type PlivoNumber } from "./plivo";

/**
 * A client's own Plivo caller-ID numbers.
 *
 * Each client connects their OWN Plivo account (see plivo-config.ts). This lists
 * the numbers on THAT account — read live from Plivo with the client's creds. A
 * client that hasn't connected an account has no numbers here (connected:false);
 * they see a "connect your account" prompt in the UI instead.
 *
 * Read-only — never dials or bills.
 */

export function numKey(raw: string): string {
  return String(raw || "").replace(/\D+/g, "");
}

export function toE164(digits: string): string {
  const d = numKey(digits);
  return d ? `+${d}` : "";
}

export interface ClientNumber extends PlivoNumber {
  e164: string;
  isDefault: boolean; // true if this is the client's default caller-ID
}

export interface ClientAccountNumbers {
  connected: boolean;
  numbers: ClientNumber[];
  total: number;
  defaultFrom: string; // the client's chosen default caller-ID (E.164 / digits)
}

/** The numbers on this client's own connected Plivo account. */
export async function getClientAccountNumbers(clientId: string): Promise<ClientAccountNumbers> {
  const creds = await getClientPlivoCreds(clientId);
  // Only a client with their OWN connected account has numbers here; the shared
  // env account is never surfaced as a client's numbers.
  if (creds.source !== "client") {
    return { connected: false, numbers: [], total: 0, defaultFrom: "" };
  }
  const { numbers, total } = await listAccountNumbers({ authId: creds.authId, authToken: creds.authToken });
  const defKey = numKey(creds.fromNumber);
  const decorated: ClientNumber[] = numbers
    .map((n) => ({ ...n, e164: toE164(n.number), isDefault: !!defKey && numKey(n.number) === defKey }))
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.number.localeCompare(b.number));
  return { connected: true, numbers: decorated, total, defaultFrom: creds.fromNumber };
}
