import { NextRequest, NextResponse } from "next/server";
import { runDueSchedules } from "@/lib/schedule";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — every client's schedules, so support can see what is armed. */
export async function GET() {
  const { rows } = await query(
    `SELECT s.id, s.client_id, c.name AS client_name, s.name, s.kind, s.repeat_rule,
            s.at_time, s.days, s.next_run_at, s.enabled, s.runs, s.last_run_at, s.last_error,
            jsonb_array_length(coalesce(s.spec->'recipients','[]'::jsonb)) AS recipients
     FROM schedule s LEFT JOIN app_client c ON c.id = s.client_id
     ORDER BY s.enabled DESC, s.next_run_at ASC NULLS LAST
     LIMIT 500`,
  );
  return NextResponse.json({ schedules: rows });
}

/**
 * POST — run whatever is due right now instead of waiting for the next poll.
 * The poller does this on its own every 30s; this is the manual nudge, and it
 * takes the same claim, so it cannot double-fire alongside the poller.
 */
export async function POST(_req: NextRequest) {
  try {
    return NextResponse.json({ ok: true, ...(await runDueSchedules()) });
  } catch (e) {
    console.error("[admin/schedules] run failed:", e);
    return NextResponse.json({ error: "Could not run due schedules." }, { status: 503 });
  }
}
