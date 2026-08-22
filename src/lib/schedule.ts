import { query, withTx } from "./db";
import { newId } from "./redis";
import { runWithTenant, currentClientId } from "./tenant";
import { createBulkJob } from "./bulk";

/**
 * Scheduled runs — a campaign or a WhatsApp send that starts by itself.
 *
 * A schedule owns WHAT to run (a campaign or a webhook, plus the recipients)
 * and WHEN. When it comes due the scheduler creates an ordinary bulk job, so
 * from that moment on it is dialled or sent by exactly the same worker as
 * anything started by hand — there is no second execution path to keep honest.
 *
 * Times are Asia/Kolkata throughout. "Every Wednesday at 7pm" means 7pm in
 * India, and keeps meaning that regardless of where the server runs.
 */

export type ScheduleKind = "call" | "whatsapp";
export type RepeatRule = "once" | "daily" | "weekly";

export interface ScheduleSpec {
  /** For calls: which campaign to dial with. */
  campaignId?: string;
  /** For WhatsApp: the Pabbly webhook to post to. */
  webhookUrl?: string;
  concurrency?: number;
  delayMs?: number;
  jitterPct?: number;
  recipients: { phone: string; name?: string; email?: string }[];
}

export interface Schedule {
  id: string;
  clientId: string;
  name: string;
  kind: ScheduleKind;
  repeat: RepeatRule;
  /** Weekly only: 0 = Sunday … 6 = Saturday, in IST. */
  days: number[];
  /** "HH:MM" in IST, for daily and weekly. */
  atTime: string | null;
  nextRunAt: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastJobId: string | null;
  lastError: string | null;
  runs: number;
  createdAt: string;
  recipientCount: number;
  spec: ScheduleSpec;
}

const IST = "+05:30";
const MAX_RECIPIENTS = 20000;

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** The IST calendar date of an instant, as "YYYY-MM-DD". */
export function istDate(d: Date): string {
  return new Date(d.getTime() + 330 * 60000).toISOString().slice(0, 10);
}

/** Day of week in IST — 0 = Sunday. */
export function istDay(d: Date): number {
  return new Date(d.getTime() + 330 * 60000).getUTCDay();
}

/** "HH:MM" on an IST calendar date, as a real instant. */
function istInstant(dateStr: string, hhmm: string): Date {
  return new Date(Date.parse(`${dateStr}T${hhmm}:00.000${IST}`));
}

function addDays(dateStr: string, n: number): string {
  const d = new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + n * 86400000);
  return d.toISOString().slice(0, 10);
}

export function isValidTime(t: unknown): t is string {
  return typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
}

/**
 * When does this schedule next fire, strictly after `from`?
 *
 * `once` has no rule to compute from — its single instant is stored directly —
 * so it returns null here and the caller keeps whatever was set.
 */
export function computeNextRun(
  repeat: RepeatRule,
  days: number[],
  atTime: string | null,
  from: Date = new Date(),
): Date | null {
  if (repeat === "once" || !isValidTime(atTime)) return null;

  const wanted = repeat === "weekly"
    ? (days.length ? days : [istDay(from)])
    : [0, 1, 2, 3, 4, 5, 6];

  let date = istDate(from);
  // Eight days covers today plus a full week, so a weekly rule always lands.
  for (let i = 0; i < 8; i++) {
    const candidate = istInstant(date, atTime);
    if (candidate.getTime() > from.getTime() && wanted.includes(istDay(candidate))) {
      return candidate;
    }
    date = addDays(date, 1);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type Row = {
  id: string; client_id: string; name: string; kind: string; repeat_rule: string;
  days: number[] | null; at_time: string | null; next_run_at: Date | null;
  enabled: boolean; last_run_at: Date | null; last_job_id: string | null;
  last_error: string | null; runs: number; created_at: Date; spec: ScheduleSpec;
};

function toSchedule(r: Row): Schedule {
  const spec = (r.spec || { recipients: [] }) as ScheduleSpec;
  return {
    id: r.id,
    clientId: r.client_id,
    name: r.name,
    kind: r.kind as ScheduleKind,
    repeat: r.repeat_rule as RepeatRule,
    days: r.days ?? [],
    atTime: r.at_time,
    nextRunAt: r.next_run_at ? r.next_run_at.toISOString() : null,
    enabled: r.enabled,
    lastRunAt: r.last_run_at ? r.last_run_at.toISOString() : null,
    lastJobId: r.last_job_id,
    lastError: r.last_error,
    runs: r.runs,
    createdAt: r.created_at.toISOString(),
    recipientCount: spec.recipients?.length ?? 0,
    // The recipient list can be thousands of rows; callers that need it ask for
    // it explicitly rather than having it ride along on every list request.
    spec: { ...spec, recipients: [] },
  };
}

const COLS = `id, client_id, name, kind, repeat_rule, days, at_time, next_run_at,
              enabled, last_run_at, last_job_id, last_error, runs, created_at, spec`;

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export interface CreateScheduleInput {
  name: string;
  kind: ScheduleKind;
  repeat: RepeatRule;
  /** `once`: the instant to run at (ISO). */
  startAt?: string;
  /** `daily`/`weekly`: "HH:MM" IST. */
  atTime?: string;
  days?: number[];
  spec: ScheduleSpec;
}

export function validateSchedule(input: CreateScheduleInput): string | null {
  if (!input.name?.trim()) return "Give the schedule a name";
  if (input.kind !== "call" && input.kind !== "whatsapp") return "Unknown schedule type";
  if (!input.spec?.recipients?.length) return "Add at least one recipient";
  if (input.spec.recipients.length > MAX_RECIPIENTS) return `At most ${MAX_RECIPIENTS} recipients per schedule`;
  if (input.kind === "call" && !input.spec.campaignId) return "Choose a campaign";

  if (input.repeat === "once") {
    const t = Date.parse(input.startAt || "");
    if (!Number.isFinite(t)) return "Choose when it should run";
    if (t <= Date.now()) return "That time has already passed";
  } else {
    if (!isValidTime(input.atTime)) return "Choose a time of day";
    if (input.repeat === "weekly" && !(input.days || []).length) return "Choose at least one day";
  }
  return null;
}

export async function createSchedule(clientId: string, input: CreateScheduleInput): Promise<Schedule> {
  const days = (input.days || []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const nextRun = input.repeat === "once"
    ? new Date(input.startAt!)
    : computeNextRun(input.repeat, days, input.atTime ?? null);

  const { rows } = await query<Row>(
    `INSERT INTO schedule (id, client_id, name, kind, repeat_rule, days, at_time, next_run_at, spec)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     RETURNING ${COLS}`,
    [
      newId("sch"), clientId, input.name.trim(), input.kind, input.repeat,
      input.repeat === "weekly" ? days : null,
      input.repeat === "once" ? null : input.atTime ?? null,
      nextRun, JSON.stringify(input.spec),
    ],
  );
  return toSchedule(rows[0]);
}

export async function listSchedules(clientId: string): Promise<Schedule[]> {
  const { rows } = await query<Row>(
    `SELECT ${COLS} FROM schedule WHERE client_id = $1 ORDER BY enabled DESC, next_run_at ASC NULLS LAST, created_at DESC`,
    [clientId],
  );
  return rows.map(toSchedule);
}

export async function getSchedule(clientId: string, id: string): Promise<Schedule | null> {
  const { rows } = await query<Row>(
    `SELECT ${COLS} FROM schedule WHERE client_id = $1 AND id = $2`, [clientId, id]);
  return rows.length ? toSchedule(rows[0]) : null;
}

export async function setScheduleEnabled(clientId: string, id: string, enabled: boolean): Promise<Schedule | null> {
  // Re-arming a repeating schedule has to recompute its next run: the stored one
  // is in the past by now, and a past time would fire immediately on resume.
  const current = await getSchedule(clientId, id);
  if (!current) return null;
  let nextRun = current.nextRunAt ? new Date(current.nextRunAt) : null;
  if (enabled && current.repeat !== "once") {
    nextRun = computeNextRun(current.repeat, current.days, current.atTime);
  }
  const { rows } = await query<Row>(
    `UPDATE schedule SET enabled = $3, next_run_at = $4 WHERE client_id = $1 AND id = $2 RETURNING ${COLS}`,
    [clientId, id, enabled, nextRun],
  );
  return rows.length ? toSchedule(rows[0]) : null;
}

export async function deleteSchedule(clientId: string, id: string): Promise<boolean> {
  const { rowCount } = await query(`DELETE FROM schedule WHERE client_id = $1 AND id = $2`, [clientId, id]);
  return rowCount > 0;
}

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

/**
 * Turn one due schedule into a real bulk job.
 *
 * The claim and the advance happen in ONE transaction, before any job is
 * created: a schedule is only ever picked up by whoever moves `next_run_at`
 * forward first, so a second poller — or an overlapping tick — cannot fire the
 * same run twice. Creating the job afterwards is the slow part, and it is
 * deliberately outside that lock.
 */
export async function runDueSchedules(now: Date = new Date()): Promise<{ fired: number }> {
  let claimed: Row[] = [];
  try {
    claimed = await withTx(async (c) => {
      const { rows } = await c.query<Row>(
        `SELECT ${COLS} FROM schedule
         WHERE enabled = true AND next_run_at IS NOT NULL AND next_run_at <= $1
         ORDER BY next_run_at ASC
         LIMIT 20
         FOR UPDATE SKIP LOCKED`,
        [now],
      );
      for (const r of rows) {
        const next = computeNextRun(r.repeat_rule as RepeatRule, r.days ?? [], r.at_time, now);
        // A one-off has nothing after it, so it stands down rather than lingering
        // as an armed schedule with a time in the past.
        await c.query(
          `UPDATE schedule SET next_run_at = $2, enabled = $3, last_run_at = $4, runs = runs + 1 WHERE id = $1`,
          [r.id, next, r.repeat_rule === "once" ? false : true, now],
        );
      }
      return rows;
    });
  } catch (e) {
    console.error("[schedule] could not claim due schedules:", e);
    return { fired: 0 };
  }

  let fired = 0;
  for (const r of claimed) {
    try {
      const spec = (r.spec || { recipients: [] }) as ScheduleSpec;
      const job = await runWithTenant(r.client_id, () =>
        createBulkJob({
          kind: r.kind as ScheduleKind,
          campaignId: spec.campaignId,
          webhookUrl: spec.webhookUrl,
          rows: spec.recipients || [],
          concurrency: spec.concurrency,
          delayMs: spec.delayMs,
          jitterPct: spec.jitterPct,
        }),
      );
      await query(`UPDATE schedule SET last_job_id = $2, last_error = NULL WHERE id = $1`, [r.id, job.id]);
      fired++;
      console.info(
        `[schedule] "${r.name}" (${r.kind}) fired — job ${job.id}, ${spec.recipients?.length ?? 0} recipient(s)`,
      );
    } catch (e: any) {
      const msg = String(e?.message || e).slice(0, 300);
      await query(`UPDATE schedule SET last_error = $2 WHERE id = $1`, [r.id, msg]).catch(() => {});
      console.error(`[schedule] "${r.name}" failed to start:`, msg);
    }
  }
  return { fired };
}

// ---------------------------------------------------------------------------
// Poller
// ---------------------------------------------------------------------------

const G = globalThis as unknown as { __ivrSchedulerStarted?: boolean };
const POLL_MS = Number(process.env.SCHEDULE_POLL_INTERVAL_MS) || 30_000;

export async function startScheduler(): Promise<void> {
  if (G.__ivrSchedulerStarted) return;
  G.__ivrSchedulerStarted = true;
  console.info(`[schedule] scheduler started — interval ${POLL_MS / 1000}s`);
  const timer = setInterval(() => void runDueSchedules(), POLL_MS);
  if (timer && typeof (timer as any).unref === "function") (timer as any).unref();
}

/** The recipient list for one schedule — fetched only when actually needed. */
export async function getScheduleRecipients(clientId: string, id: string) {
  const { rows } = await query<{ spec: ScheduleSpec }>(
    `SELECT spec FROM schedule WHERE client_id = $1 AND id = $2`, [clientId, id]);
  return rows.length ? rows[0].spec?.recipients ?? [] : [];
}

export { currentClientId };
