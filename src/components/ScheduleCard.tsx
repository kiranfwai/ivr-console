"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Play, Pause, Trash2, Plus, AlertCircle } from "lucide-react";
import { Card, Button, Input, Label, Select, Badge, EmptyState, Spinner, Modal, toast } from "./ui";
import { api } from "./useData";

export interface ScheduleSpec {
  campaignId?: string;
  webhookUrl?: string;
  concurrency?: number;
  delayMs?: number;
  jitterPct?: number;
  recipients: { phone: string; name?: string; email?: string }[];
}

interface ScheduleApi {
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
function istWhen(iso: string): string {
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

function describe(s: ScheduleApi): string {
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

/**
 * Runs that start by themselves — used by both the bulk-call and bulk-WhatsApp
 * tabs. The parent owns the recipients and settings and hands them over through
 * `buildSpec` at the moment the schedule is saved, so what gets scheduled is
 * exactly what pressing "send now" would have sent.
 */
export default function ScheduleCard({
  kind,
  buildSpec,
  recipientCount,
  title,
  description,
}: {
  kind: "call" | "whatsapp";
  buildSpec: () => ScheduleSpec | null;
  recipientCount: number;
  title?: string;
  description?: string;
}) {
  const [items, setItems] = useState<ScheduleApi[] | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ schedules: ScheduleApi[] }>("/api/schedules");
      setItems(r.schedules.filter((s) => s.kind === kind));
    } catch (e: any) {
      toast(e?.message || "Could not load schedules", "danger");
    }
  }, [kind]);

  useEffect(() => { load(); }, [load]);

  async function toggle(s: ScheduleApi) {
    try {
      await api(`/api/schedules/${s.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !s.enabled }) });
      await load();
    } catch (e: any) {
      toast(e?.message || "Could not change it", "danger");
    }
  }

  async function remove(s: ScheduleApi) {
    if (!window.confirm(`Delete the schedule "${s.name}"? Runs already started are not affected.`)) return;
    try {
      await api(`/api/schedules/${s.id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      toast(e?.message || "Could not delete", "danger");
    }
  }

  return (
    <>
      <Card
        title={<span className="flex items-center gap-2"><CalendarClock size={16} className="text-brand" /> {title || "Scheduled runs"}</span>}
        description={description || "Starts by itself at the time you choose — nothing needs to be open"}
        action={
          <Button size="sm" leftIcon={<Plus size={13} />} onClick={() => setOpen(true)} disabled={!recipientCount}>
            New schedule
          </Button>
        }
      >
        {items === null ? (
          <div className="flex justify-center py-6"><Spinner /></div>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<CalendarClock size={20} />}
            title="Nothing scheduled"
            description={
              recipientCount
                ? "Set a date and time and this list will go out on its own."
                : "Add your recipients above, then create a schedule."
            }
          />
        ) : (
          <div className="grid gap-2">
            {items.map((s) => (
              <div key={s.id} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-ink truncate">{s.name}</span>
                    {s.enabled
                      ? <Badge tone="ok">Armed</Badge>
                      : <Badge tone="muted">Paused</Badge>}
                    {s.runs > 0 && <span className="text-xs text-muted">ran {s.runs}×</span>}
                  </div>
                  <div className="text-xs text-muted mt-0.5">
                    {describe(s)} · {s.recipientCount.toLocaleString()} recipient{s.recipientCount === 1 ? "" : "s"}
                    {s.nextRunAt && s.enabled && <> · next {istWhen(s.nextRunAt)} IST</>}
                    {!s.nextRunAt && !s.enabled && s.runs > 0 && <> · finished</>}
                  </div>
                  {s.lastError && (
                    <div className="text-xs text-danger mt-1 flex items-center gap-1">
                      <AlertCircle size={12} /> {s.lastError}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" leftIcon={s.enabled ? <Pause size={13} /> : <Play size={13} />}
                          onClick={() => toggle(s)}>
                    {s.enabled ? "Pause" : "Resume"}
                  </Button>
                  <Button size="sm" variant="ghost" leftIcon={<Trash2 size={13} />} onClick={() => remove(s)}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

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
  const [name, setName] = useState("");
  const [repeat, setRepeat] = useState<"once" | "daily" | "weekly">("once");
  const [startAt, setStartAt] = useState(defaultStartAt());
  const [atTime, setAtTime] = useState("19:00");
  const [days, setDays] = useState<number[]>([new Date().getDay()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) { setName(""); setRepeat("once"); setStartAt(defaultStartAt()); setAtTime("19:00"); }
  }, [open]);

  async function save() {
    const spec = buildSpec();
    if (!spec) return;
    setSaving(true);
    try {
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
      toast("Scheduled.", "ok");
      onSaved();
    } catch (e: any) {
      toast(e?.message || "Could not save the schedule", "danger");
    }
    setSaving(false);
  }

  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Schedule this run">
      <div className="grid gap-3">
        <div className="text-xs text-muted">
          {recipientCount.toLocaleString()} recipient{recipientCount === 1 ? "" : "s"} will be saved with this
          schedule and used every time it runs. Times are IST.
        </div>

        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)}
                 placeholder={kind === "call" ? "Webinar reminder calls" : "Wednesday reminder"} />
        </div>

        <div>
          <Label>How often</Label>
          <Select value={repeat} onChange={(e) => setRepeat(e.target.value as any)}>
            <option value="once">Once, at a set time</option>
            <option value="daily">Every day</option>
            <option value="weekly">Every week</option>
          </Select>
        </div>

        {repeat === "once" ? (
          <div>
            <Label>When</Label>
            <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
          </div>
        ) : (
          <div>
            <Label hint="IST">Time of day</Label>
            <Input type="time" value={atTime} onChange={(e) => setAtTime(e.target.value)} />
          </div>
        )}

        {repeat === "weekly" && (
          <div>
            <Label>Which days</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_LABEL.map((d, i) => {
                const on = days.includes(i);
                return (
                  <button
                    key={d}
                    onClick={() => setDays(on ? days.filter((x) => x !== i) : [...days, i].sort())}
                    className={`px-2.5 py-1 rounded-lg text-xs border transition-colors ${
                      on ? "bg-brand/15 border-brand/40 text-brand" : "border-line text-ink2 hover:text-ink"
                    }`}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving} disabled={!recipientCount}>Schedule it</Button>
        </div>
      </div>
    </Modal>
  );
}
