import { NextRequest, NextResponse } from "next/server";
import { listClients } from "@/lib/clients";
import { getGlobalPricing } from "@/lib/pricing";
import { getBalances } from "@/lib/wallet";
import { readRange, type RangeAggregate } from "@/lib/stats";
import { runWithTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Admin cross-client analytics: for every client, the call volumes/outcomes AND
 * the computed cost over a day range — plus grand totals. Powers the admin
 * Financials + client-wise Reports views.
 *
 * Each client's rolled-up counters live under its own tenant scope
 * (`t:<clientId>:stats:*`), so we read them by running readRange inside
 * runWithTenant(clientId). runWithTenant("") forces a tenant-less read used for
 * legacy pre-tenancy data (kept off the client rows, surfaced separately).
 */

function istToday(): string {
  return new Date(Date.now() + (5 * 60 + 30) * 60 * 1000).toISOString().slice(0, 10);
}

function summarize(agg: RangeAggregate) {
  const o = agg.outcomes;
  const connected = o.press1 + o.connected; // "lifted"
  // Everything settled that isn't lifted or busy.
  const failed = Math.max(0, agg.total - connected - o.busy);
  return {
    total: agg.total,
    connected,
    press1: o.press1,
    busy: o.busy,
    noAnswer: o.noAnswer,
    failed,
    connectedSeconds: agg.durSum,
    minutes: Math.ceil(agg.durSum / 60),
    liftRate: agg.total ? Math.round((connected / agg.total) * 100) : 0,
  };
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const today = istToday();
  const from = url.searchParams.get("from") || today;
  const to = url.searchParams.get("to") || from;

  const [pricing, clients] = await Promise.all([getGlobalPricing(), listClients()]);
  const balances = await getBalances(clients.map((c) => c.id));

  // Cost is now the live wallet model: a flat rate per CONNECTED (answered) call.
  const round2 = (n: number) => Math.round(n * 100) / 100;

  const rows = await Promise.all(
    clients.map(async (c) => {
      const agg = await runWithTenant(c.id, () => readRange(from, to));
      const s = summarize(agg);
      const effConn = c.perConnectedCall == null ? pricing.perConnectedCall : c.perConnectedCall;
      return {
        id: c.id,
        name: c.name,
        email: c.email,
        active: c.active,
        perCallOverride: c.perCall,
        perMinuteOverride: c.perMinute,
        perConnectedCallOverride: c.perConnectedCall,
        effPerCall: c.perCall == null ? pricing.perCall : c.perCall,
        effPerMinute: c.perMinute == null ? pricing.perMinute : c.perMinute,
        effPerConnectedCall: effConn,
        balance: balances[c.id] ?? 0,
        ...s,
        cost: round2(s.connected * effConn),
      };
    }),
  );

  // Legacy / unassigned pre-tenancy data (tenant-less keys). Only surfaced if it
  // actually holds calls, and costed at the global default connected rate.
  const legacyAgg = await runWithTenant("", () => readRange(from, to));
  const legacyS = summarize(legacyAgg);
  const legacy =
    legacyS.total > 0
      ? {
          ...legacyS,
          cost: round2(legacyS.connected * pricing.perConnectedCall),
        }
      : null;

  const totals = rows.reduce(
    (t, r) => ({
      total: t.total + r.total,
      connected: t.connected + r.connected,
      press1: t.press1 + r.press1,
      minutes: t.minutes + r.minutes,
      cost: Math.round((t.cost + r.cost) * 100) / 100,
    }),
    { total: 0, connected: 0, press1: 0, minutes: 0, cost: 0 },
  );

  return NextResponse.json({
    range: { from, to },
    currency: pricing.currency,
    pricing,
    rows,
    legacy,
    totals,
  });
}
