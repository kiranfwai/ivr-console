"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Play, Pause, Trash2, Plus, AlertCircle, MessageCircle, Phone } from "lucide-react";
import {
  Button, Input, Label, Select, Badge, EmptyState, Spinner, Modal, IconButton, ConfirmDialog,
  DataPanel, DataTable, TH, TD, toast,
} from "./ui";
import { api } from "./useData";

export interface ScheduleSpec {
  campaignId?: string;
  webhookUrl?: string;
  concurrency?: number;
  delayMs?: number;
  jitterPct?: number;
  recipients: { phone: string; name?: string; email?: string }[];
}

export interface ScheduleApi {
  id: string;
  name: string;
  kind: "call" | "whatsapp";
  repeat: "once" | "daily" | "weekly";
  days: number[];
  atTime: string | null;
  nextRunAt: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  runs: number;
  recipientCount: number;
}

const DAY_LABEL = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** An instant as IST wall-clock, e.g. "Wed 27 Aug, 7:00 pm". */
export function istWhen(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 330 * 60000);
  const h = d.getUTCHours();
  const m = String(d.getUTCMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${DAY_LABEL[d.getUTCDay()]} ${d.getUTCDate()} ${
    ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]
  }, ${h12}:${m} ${ampm}`;
}

/** "HH:MM" 24h -> "7:00 pm". */
function pretty(t: string | null): string {
  if (!t) return "";
  const [H, M] = t.split(":").map(Number);
  const ampm = H >= 12 ? "pm" : "am";
  return `${H % 12 || 12}:${String(M).padStart(2, "0")} ${ampm}`;
}

export function describe(s: ScheduleApi): string {
  if (s.repeat === "once") return "Once";
  if (s.repeat === "daily") return `Every day at ${pretty(s.atTime)}`;
  const days = s.days.length === 7 ? "every day" : s.days.map((d) => DAY_LABEL[d]).join(", ");
  return `${days} at ${pretty(s.atTime)}`;
}

/** The local datetime-input value for "an hour from now", so the field opens sensibly. */
function defaultStartAt(): string {
  const d = new Date(Date.now() + 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/* ------------------------------------------------------------------
   Schedule form — shared by the "New schedule" modal and the inline
   "When → Schedule" step on Bulk calls.
   ------------------------------------------------------------------ */

export interface ScheduleDraft {
  name: string;
  repeat: "once" | "daily" | "weekly";
  startAt: string;
  atTime: string;
  days: number[];
}

export function newScheduleDraft(): ScheduleDraft {
  return { name: "", repeat: "once", startAt: defaultStartAt(), atTime: "19:00", days: [new Date().getDay()] };
}

/** Saves a schedule. Throws on failure (callers show the toast). */
export async function saveSchedule(kind: "call" | "whatsapp", draft: ScheduleDraft, spec: ScheduleSpec) {
  const { name, repeat, startAt, atTime, days } = draft;
  await api("/api/schedules", {
    method: "POST",
    body: JSON.stringify({
      name: name.trim() || (kind === "call" ? "Scheduled campaign" : "Scheduled WhatsApp send"),
      kind,
      repeat,
      // The picker is the browser's local clock; the server stores the instant.
      startAt: repeat === "once" ? new Date(startAt).toISOString() : undefined,
      atTime: repeat === "once" ? undefined : atTime,
      days: repeat === "weekly" ? days : undefined,
      spec,
    }),
  });
}

export function ScheduleFields({
  kind,
  draft,
  onChange,
}: {
  kind: "call" | "whatsapp";
  draft: ScheduleDraft;
  onChange: (d: ScheduleDraft) => void;
}) {
  const set = (patch: Partial<ScheduleDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="grid gap-3.5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        {draft.repeat === "once" ? (
          <div>
            <Label>Date &amp; time</Label>
            <Input type="datetime-local" value={draft.startAt} onChange={(e) => set({ startAt: e.target.value })} />
          </div>
        ) : (
          <div>
            <Label hint="IST">Time of day</Label>
            <Input type="time" value={draft.atTime} onChange={(e) => set({ atTime: e.target.value })} />
          </div>
        )}
        <div>
          <Label>Repeat</Label>
          <Select value={draft.repeat} onChange={(e) => set({ repeat: e.target.value as ScheduleDraft["repeat"] })}>
            <option value="once">Once, at a set time</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </Select>
        </div>
      </div>

      {draft.repeat === "weekly" && (
        <div>
          <Label>Which days</Label>
          <div className="flex flex-wrap gap-1.5">
            {DAY_LABEL.map((d, i) => {
              const on = draft.days.includes(i);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => set({ days: on ? draft.days.filter((x) => x !== i) : [...draft.days, i].sort() })}
                  className={`h-[30px] rounded-[8px] border px-2.5 text-[12.5px] font-medium transition-colors ${
                    on ? "border-accent/40 bg-accent/10 text-accent" : "border-line bg-panel text-ink2 hover:text-ink"
                  }`}
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <Label hint="optional">Name</Label>
        <Input
          value={draft.name}
          onChange={(e) => set({ name: e.target.value })}
          placeholder={kind === "call" ? "Webinar reminder calls" : "Wednesday reminder"}
        />
      </div>
    </div>
  );
}

/**
 * Runs that start by themselves — used by both the bulk-call and bulk-WhatsApp
 * screens. The parent owns the recipients and settings and hands them over through
 * `buildSpec` at the moment the schedule is saved, so what gets scheduled is
 * exactly what pressing "send now" would have sent.
 */
export default function ScheduleCard({
  kind,
  buildSpec,
  recipientCount,
  title,
  description,
  hideNew,
  emptyHint,
  reloadKey,
  onCount,
}: {
  kind: "call" | "whatsapp";
  buildSpec: () => ScheduleSpec | null;
  recipientCount: number;
  title?: string;
  description?: string;
  /** Hide "New schedule" when the parent offers its own way to schedule. */
  hideNew?: boolean;
  /** Empty-state line when there are no recipients yet. */
  emptyHint?: string;
  /** Bump to reload the list after the parent saved a schedule itself. */
  reloadKey?: number;
  /** Told how many schedules there are, after every load. */
  onCount?: (n: number) => void;
}) {
  const [items, setItems] = useState<ScheduleApi[] | null>(null);
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<ScheduleApi | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ schedules: ScheduleApi[] }>("/api/schedules");
      const mine = r.schedules.filter((s) => s.kind === kind);
      setItems(mine);
      onCount?.(mine.length);
    } catch (e: any) {
      toast(e?.message || "Could not load schedules", "danger");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  useEffect(() => { load(); }, [load, reloadKey]);

  async function toggle(s: ScheduleApi) {
    try {
      await api(`/api/schedules/${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) });
      await load();
    } catch (e: any) {
      toast(e?.message || "Could not change it", "danger");
    }
  }

  async function remove() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await api(`/api/schedules/${toDelete.id}`, { method: "DELETE" });
      setToDelete(null);
      await load();
    } catch (e: any) {
      toast(e?.message || "Could not delete", "danger");
    } finally {
      setDeleting(false);
    }
  }

  const KindIcon = kind === "call" ? Phone : MessageCircle;

  return (
    <>
      <DataPanel
        title={title || "Scheduled runs"}
        meta={description || "Starts by itself at the time you choose — nothing needs to be open."}
        action={
          !hideNew && (
            <Button size="sm" leftIcon={<Plus size={13} />} onClick={() => setOpen(true)} disabled={!recipientCount}>
              New schedule
            </Button>
          )
        }
      >
        {items === null ? (
          <div className="flex justify-center border-t border-line py-8"><Spinner /></div>
        ) : items.length === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              icon={<CalendarClock size={20} />}
              title="Nothing scheduled"
              description={
                recipientCount
                  ? "Set a date and time and this list will go out on its own."
                  : emptyHint || "Add your recipients first, then create a schedule."
              }
            />
          </div>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={TH}>Name</th>
                <th className={`${TH} hidden sm:table-cell`}>Recipients</th>
                <th className={TH}>Next run</th>
                <th className={`${TH} hidden md:table-cell`}>Repeats</th>
                <th className={TH}>Status</th>
                <th className={`${TH} w-[110px]`} />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => {
                // Same rule as the Scheduled page: a one-off that has run and has
                // nothing left to fire is finished, not paused — and has nothing to resume.
                const finished = !s.nextRunAt && !s.enabled && s.runs > 0;
                return (
                  <tr key={s.id} className="hover:bg-ink/[0.02]">
                    <td className={TD}>
                      <div className="flex items-center gap-2.5">
                        <div className="grid h-8 w-8 flex-none place-items-center rounded-[8px] bg-accent/10 text-accent">
                          <KindIcon size={14} />
                        </div>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-ink">{s.name}</div>
                          {s.lastError && (
                            <div className="mt-0.5 flex items-center gap-1 text-xs text-danger">
                              <AlertCircle size={12} className="shrink-0" /> <span className="truncate">{s.lastError}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className={`${TD} hidden tabular-nums sm:table-cell`}>
                      {s.recipientCount.toLocaleString()}
                    </td>
                    <td className={TD}>
                      {s.nextRunAt && s.enabled ? (
                        <>
                          <div className="whitespace-nowrap">{istWhen(s.nextRunAt)}</div>
                          <div className="text-xs text-muted">IST</div>
                        </>
                      ) : finished && s.lastRunAt ? (
                        <>
                          <div className="whitespace-nowrap text-muted">Ran {istWhen(s.lastRunAt)}</div>
                          <div className="text-xs text-muted">IST</div>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={`${TD} hidden md:table-cell`}>{describe(s)}</td>
                    <td className={TD}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {finished
                          ? <Badge tone="muted">Finished</Badge>
                          : s.enabled
                            ? <Badge tone="ok">Armed</Badge>
                            : <Badge tone="warn">Paused</Badge>}
                        {s.runs > 0 && <span className="text-xs text-muted">ran {s.runs}×</span>}
                      </div>
                    </td>
                    <td className={TD}>
                      <div className="flex justify-end gap-0.5">
                        {!finished && (
                          <IconButton
                            size="sm"
                            title={s.enabled ? "Pause" : "Resume"}
                            icon={s.enabled ? <Pause size={15} /> : <Play size={15} />}
                            onClick={() => toggle(s)}
                          />
                        )}
                        <IconButton size="sm" variant="danger" title="Delete" icon={<Trash2 size={15} />} onClick={() => setToDelete(s)} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </DataPanel>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete this schedule?"
        body={<>The schedule &ldquo;{toDelete?.name}&rdquo; will be removed. Runs already started are not affected.</>}
        confirmLabel="Yes, delete"
        busy={deleting}
        onConfirm={remove}
        onClose={() => !deleting && setToDelete(null)}
      />

      <NewScheduleModal
        open={open}
        kind={kind}
        recipientCount={recipientCount}
        buildSpec={buildSpec}
        onClose={() => setOpen(false)}
        onSaved={async () => { setOpen(false); await load(); }}
      />
    </>
  );
}

function NewScheduleModal({
  open, kind, recipientCount, buildSpec, onClose, onSaved,
}: {
  open: boolean;
  kind: "call" | "whatsapp";
  recipientCount: number;
  buildSpec: () => ScheduleSpec | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<ScheduleDraft>(newScheduleDraft);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setDraft(newScheduleDraft());
  }, [open]);

  async function save() {
    const spec = buildSpec();
    if (!spec) return;
    setSaving(true);
    try {
      await saveSchedule(kind, draft, spec);
      toast("Scheduled.", "ok");
      onSaved();
    } catch (e: any) {
      toast(e?.message || "Could not save the schedule", "danger");
    }
    setSaving(false);
  }

  if (!open) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Schedule this run"
      maxWidth="max-w-[460px]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!recipientCount} leftIcon={<CalendarClock size={14} />}>
            Schedule it
          </Button>
        </>
      }
    >
      <p className="mb-4 text-[13px] text-muted">
        {recipientCount.toLocaleString()} recipient{recipientCount === 1 ? "" : "s"} will be saved with this
        schedule and used every time it runs. Times are IST.
      </p>
      <ScheduleFields kind={kind} draft={draft} onChange={setDraft} />
    </Modal>
  );
}
