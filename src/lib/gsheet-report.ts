import { query } from "./db";
import { getGSheetConn, type CallOutcome } from "./gsheets";

/**
 * Reporting for Sheet Auto-Dial, answered from `gsheet_lead` rather than from
 * the campaign counters.  The counters are keyed by campaign, so two sheets
 * feeding one campaign are indistinguishable there; the lead table knows which
 * connection each call came from, and also carries the name, email and sheet row
 * that the call record never sees.
 *
 * Scope: leads a call was actually PLACED for — `called_at IS NOT NULL`.  A lead
 * still sitting in the queue has never been dialled and is not part of a call
 * report.  A lead whose placement failed IS included: Plivo was asked and
 * refused, which is a result worth looking at.
 *
 * Soft-deleted leads are INCLUDED.  Clearing the queue is a queue operation, not
 * a history one — excluding them would make last week's report shrink every time
 * the queue was emptied.  They carry `removedFromQueue` so a row can say so.
 *
 * One row = one lead = its most recent call.  A lead re-dialled by hand
 * overwrites its own call_uuid and outcome, so the report follows the lead, not
 * every individual attempt.
 */

export type SheetReportOutcome = CallOutcome | "in-progress";

/** IST calendar days, YYYY-MM-DD, inclusive at both ends. Omit for "all time". */
export interface SheetReportRange {
  from?: string;
  to?: string;
}

export interface SheetReportRow {
  leadId: number;
  rowIndex: number;
  name: string | null;
  email: string | null;
  phone: string;
  outcome: SheetReportOutcome;
  hangupCause: string | null;
  durationSec: number | null;
  calledAt: string;
  callUuid: string | null;
  error: string | null;
  /** Lead was cleared out of the queue after this call. The call still counts. */
  removedFromQueue: boolean;
}

export interface SheetReportSummary {
  connId: string;
  connName: string;
  tabName: string;
  campaignId: string;
  from: string | null;
  to: string | null;
  /** Calls placed in range. */
  dialled: number;
  /** Picked up — press1 + connected. */
  lifted: number;
  outcomes: Record<string, number>;
  uniqueNumbers: number;
  talkTimeSec: number;
  /** Mean length across lifted calls only — an unanswered call has no length. */
  avgDurationSec: number;
  liftRate: number;
  press1Rate: number;
  firstCallAt: string | null;
  lastCallAt: string | null;
  byDay: { day: string; dialled: number; lifted: number }[];
  byHour: Record<string, number>;
}

const IST_TZ = "Asia/Kolkata";

/**
 * The outcome a report row is filed under.  `status = 'failed'` means the call
 * was never placed (Plivo refused), so there is no hangup and no call_outcome;
 * a placed call with no outcome yet is still in flight.
 */
const OUTCOME_SQL = `CASE
    WHEN gl.status = 'failed' THEN 'failed'
    WHEN gl.call_outcome IS NULL THEN 'in-progress'
    ELSE gl.call_outcome
  END`;

const LIFTED_SQL = `gl.call_outcome IN ('press1', 'connected')`;

/** Every report query starts here: this connection's placed calls, in range. */
function reportWhere(
  params: unknown[],
  clientId: string,
  connId: string,
  range: SheetReportRange,
): string {
  params.push(clientId, connId);
  let sql = `WHERE gl.client_id = $1 AND gl.conn_id = $2 AND gl.called_at IS NOT NULL`;
  if (range.from) {
    params.push(range.from);
    sql += ` AND gl.called_at >= ($${params.length}::date::timestamp AT TIME ZONE '${IST_TZ}')`;
  }
  if (range.to) {
    params.push(range.to);
    sql += ` AND gl.called_at < (($${params.length}::date + 1)::timestamp AT TIME ZONE '${IST_TZ}')`;
  }
  return sql;
}

/** "lifted" is a group; anything else names one outcome exactly. */
function outcomeFilterSql(params: unknown[], outcome?: string): string {
  if (!outcome) return "";
  if (outcome === "lifted") return ` AND ${LIFTED_SQL}`;
  params.push(outcome);
  return ` AND ${OUTCOME_SQL} = $${params.length}`;
}

export async function getSheetReport(
  clientId: string,
  connId: string,
  range: SheetReportRange = {},
): Promise<SheetReportSummary | null> {
  const conn = await getGSheetConn(connId);
  if (!conn || conn.clientId !== clientId) return null;

  const params: unknown[] = [];
  const where = reportWhere(params, clientId, connId, range);

  const [byOutcome, totals, byDay, byHour] = await Promise.all([
    query<{ outcome: string; n: number; dur: number }>(
      `SELECT ${OUTCOME_SQL} AS outcome, count(*)::int AS n,
              coalesce(sum(gl.duration_sec), 0)::int AS dur
       FROM gsheet_lead gl ${where} GROUP BY 1`,
      params,
    ),
    query<{ uniq: number; first_at: Date | null; last_at: Date | null }>(
      `SELECT count(DISTINCT gl.phone)::int AS uniq,
              min(gl.called_at) AS first_at, max(gl.called_at) AS last_at
       FROM gsheet_lead gl ${where}`,
      params,
    ),
    query<{ day: string; dialled: number; lifted: number }>(
      `SELECT (gl.called_at AT TIME ZONE '${IST_TZ}')::date::text AS day,
              count(*)::int AS dialled,
              count(*) FILTER (WHERE ${LIFTED_SQL})::int AS lifted
       FROM gsheet_lead gl ${where} GROUP BY 1 ORDER BY 1`,
      params,
    ),
    query<{ hour: string; n: number }>(
      `SELECT lpad(extract(hour FROM gl.called_at AT TIME ZONE '${IST_TZ}')::int::text, 2, '0') AS hour,
              count(*)::int AS n
       FROM gsheet_lead gl ${where} GROUP BY 1 ORDER BY 1`,
      params,
    ),
  ]);

  const outcomes: Record<string, number> = {};
  let dialled = 0;
  let talkTimeSec = 0;
  for (const r of byOutcome.rows) {
    outcomes[r.outcome] = r.n;
    dialled += r.n;
    talkTimeSec += r.dur;
  }
  const press1 = outcomes.press1 || 0;
  const lifted = press1 + (outcomes.connected || 0);
  const t = totals.rows[0];

  return {
    connId: conn.id,
    connName: conn.connName?.trim() || conn.tabName || "Sheet",
    tabName: conn.tabName,
    campaignId: conn.campaignId,
    from: range.from ?? null,
    to: range.to ?? null,
    dialled,
    lifted,
    outcomes,
    uniqueNumbers: t?.uniq ?? 0,
    talkTimeSec,
    avgDurationSec: lifted ? Math.round(talkTimeSec / lifted) : 0,
    liftRate: dialled ? Math.round((lifted / dialled) * 100) : 0,
    press1Rate: dialled ? Math.round((press1 / dialled) * 100) : 0,
    firstCallAt: t?.first_at ? t.first_at.toISOString() : null,
    lastCallAt: t?.last_at ? t.last_at.toISOString() : null,
    byDay: byDay.rows.map((r) => ({ day: r.day, dialled: r.dialled, lifted: r.lifted })),
    byHour: Object.fromEntries(byHour.rows.map((r) => [r.hour, r.n])),
  };
}

export interface SheetReportRowOpts extends SheetReportRange {
  outcome?: string;
  limit?: number;
  offset?: number;
}

export async function listSheetReportRows(
  clientId: string,
  connId: string,
  opts: SheetReportRowOpts = {},
): Promise<SheetReportRow[]> {
  const limit = Math.min(Math.max(1, opts.limit ?? 500), 50000);
  const offset = Math.max(0, opts.offset ?? 0);

  const params: unknown[] = [];
  const where =
    reportWhere(params, clientId, connId, opts) + outcomeFilterSql(params, opts.outcome);
  params.push(limit, offset);

  const { rows } = await query<{
    id: string;
    row_index: number;
    name: string | null;
    email: string | null;
    phone: string;
    outcome: string;
    hangup_cause: string | null;
    duration_sec: number | null;
    called_at: Date;
    call_uuid: string | null;
    error: string | null;
    deleted_at: Date | null;
  }>(
    `SELECT gl.id, gl.row_index, gl.name, gl.email, gl.phone,
            ${OUTCOME_SQL} AS outcome,
            gl.hangup_cause, gl.duration_sec, gl.called_at, gl.call_uuid,
            gl.error, gl.deleted_at
     FROM gsheet_lead gl ${where}
     ORDER BY gl.called_at DESC, gl.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  return rows.map((r) => ({
    leadId: Number(r.id),
    rowIndex: r.row_index,
    name: r.name,
    email: r.email,
    phone: r.phone,
    outcome: r.outcome as SheetReportOutcome,
    hangupCause: r.hangup_cause,
    durationSec: r.duration_sec,
    calledAt: r.called_at.toISOString(),
    callUuid: r.call_uuid,
    error: r.error,
    removedFromQueue: r.deleted_at !== null,
  }));
}

/**
 * Shared by the report page and both exports: resolve the connection (proving it
 * belongs to this client) and read the range in one go.
 */
export async function loadSheetReport(
  clientId: string,
  connId: string,
  opts: SheetReportRowOpts = {},
): Promise<{ summary: SheetReportSummary; rows: SheetReportRow[] } | null> {
  const summary = await getSheetReport(clientId, connId, opts);
  if (!summary) return null;
  const rows = await listSheetReportRows(clientId, connId, opts);
  return { summary, rows };
}
