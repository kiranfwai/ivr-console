import { NextResponse } from "next/server";
import { PLIVO_CPS } from "@/lib/cps";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

// Mirror the worker's live-cap knobs so the dashboard shows the same numbers.
const MAX_LIVE = Number(process.env.PLIVO_MAX_LIVE) || 500;
const MAX_CALL_SEC = Number(process.env.PLIVO_MAX_CALL_SEC) || 180;

/**
 * GET /api/plivo-stats — account-wide dialing telemetry for the dashboard.
 *
 * - `cps`     : the account-wide CPS limit (PLIVO_CPS) shared by every placeCall.
 * - `maxLive` : hard ceiling on simultaneously-live calls (PLIVO_MAX_LIVE).
 * - `live`    : calls currently live across ALL call campaigns — rows still
 *               'dialing'/'ok' (placed, not yet finalized by the hangup webhook),
 *               aged out after MAX_CALL_SEC so a lost callback can't inflate it.
 */
export async function GET() {
  let live = 0;
  try {
    const { rows } = await query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM bulk_row r
         JOIN bulk_job j ON j.id = r.job_id
        WHERE j.kind = 'call'
          AND r.status IN ('dialing','ok')
          AND r.attempted_at > now() - make_interval(secs => $1::int)`,
      [MAX_CALL_SEC],
    );
    live = rows[0]?.n ?? 0;
  } catch {
    // Best-effort telemetry — never fail the dashboard poll over it.
  }
  return NextResponse.json({ cps: PLIVO_CPS, maxLive: MAX_LIVE, live });
}
