"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Play, Pause, Trash2, AlertCircle, Phone, MessageCircle } from "lucide-react";
import {
  Section,
  Tiles,
  Tile,
  DataPanel,
  DataTable,
  TH,
  TD,
  Badge,
  Kebab,
  EmptyState,
  Spinner,
  ConfirmDialog,
  toast,
} from "./ui";
import { api } from "./useData";
import { type ScheduleApi, istWhen, describe } from "./ScheduleCard";

/**
 * Everything queued to fire, calls and WhatsApp together.
 *
 * Scheduling was already live before this screen existed — but the schedule
 * card was mounted inside Bulk calls AND again inside WhatsApp, each filtering
 * `/api/schedules` down to its own `kind`. So there was no way to answer "what
 * is going to fire tonight?" without opening both and merging them by eye.
 *
 * This screen is the same data with the filter removed. No backend work: it
 * reads the same endpoint and uses the same PATCH/DELETE the cards already use.
 *
 * Creating a schedule still happens on Bulk calls or WhatsApp, because that's
 * where the recipient list is — this screen manages what already exists.
 */
export default function ScheduledTab() {
  const [items, setItems] = useState<ScheduleApi[] | null>(null);
  const [err, setErr] = useState(false);
  const [confirmDel, setConfirmDel] = useState<ScheduleApi | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ schedules: ScheduleApi[] }>("/api/schedules");
      // Soonest first; anything without a next run sinks to the bottom.
      const sorted = [...r.schedules].sort((a, b) => {
        const at = a.nextRunAt && a.enabled ? Date.parse(a.nextRunAt) : Infinity;
        const bt = b.nextRunAt && b.enabled ? Date.parse(b.nextRunAt) : Infinity;
        return at - bt;
      });
      setItems(sorted);
      setErr(false);
    } catch (e: any) {
      setErr(true);
      toast(e?.message || "Could not load schedules", "danger");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const stats = useMemo(() => {
    const list = items ?? [];
    const armed = list.filter((s) => s.enabled);
    const next = armed
      .filter((s) => s.nextRunAt)
      .sort((a, b) => Date.parse(a.nextRunAt!) - Date.parse(b.nextRunAt!))[0];
    const lastRun = list
      .filter((s) => s.lastRunAt)
      .sort((a, b) => Date.parse(b.lastRunAt!) - Date.parse(a.lastRunAt!))[0];
    return {
      total: list.length,
      repeating: list.filter((s) => s.repeat !== "once").length,
      once: list.filter((s) => s.repeat === "once").length,
      armed: armed.length,
      queued: armed.reduce((n, s) => n + (s.recipientCount || 0), 0),
      next,
      lastRun,
      failing: list.filter((s) => s.lastError).length,
    };
  }, [items]);

  async function toggle(s: ScheduleApi) {
    try {
      await api(`/api/schedules/${s.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !s.enabled }),
      });
      toast(s.enabled ? `Paused “${s.name}”` : `Resumed “${s.name}”`, "ok");
      await load();
    } catch (e: any) {
      toast(e?.message || "Could not change it", "danger");
    }
  }

  async function remove(s: ScheduleApi) {
    setBusy(true);
    try {
      await api(`/api/schedules/${s.id}`, { method: "DELETE" });
      toast(`Deleted “${s.name}”`, "ok");
      await load();
    } catch (e: any) {
      toast(e?.message || "Could not delete", "danger");
    } finally {
      setBusy(false);
      setConfirmDel(null);
    }
  }

  return (
    <Section>
      <Tiles>
        <Tile
          label="Scheduled"
          value={stats.total}
          sub={`${stats.repeating} repeating · ${stats.once} one-off`}
        />
        <Tile
          label="Next run"
          value={stats.next?.nextRunAt ? istWhen(stats.next.nextRunAt).split(",")[0] : "—"}
          sub={stats.next?.nextRunAt ? `${istWhen(stats.next.nextRunAt).split(", ")[1]} IST` : "nothing armed"}
        />
        <Tile
          label="Queued recipients"
          value={stats.queued.toLocaleString()}
          sub={`across ${stats.armed} armed job${stats.armed === 1 ? "" : "s"}`}
        />
        <Tile
          label="Last error"
          value={stats.failing}
          sub={stats.failing ? "needs a look" : "none"}
          tone={stats.failing ? "danger" : "muted"}
        />
      </Tiles>

      <DataPanel
        title="Everything scheduled"
        meta="calls and WhatsApp, in one place"
        footer="New schedules are created on Bulk calls or WhatsApp, where the recipient list is."
      >
        {err ? (
          <div className="py-10 text-center text-sm text-danger">
            Couldn’t load schedules.{" "}
            <button onClick={load} className="text-brand underline">
              Retry
            </button>
          </div>
        ) : items === null ? (
          <div className="flex justify-center py-12 text-muted">
            <Spinner size={18} />
          </div>
        ) : items.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={<CalendarClock size={20} />}
              title="Nothing scheduled"
              description="Set one up from Bulk calls or WhatsApp and it will appear here — armed, paused or finished."
            />
          </div>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={TH}>What</th>
                <th className={TH}>Type</th>
                <th className={TH}>Repeats</th>
                <th className={TH}>Next run</th>
                <th className={TH}>Status</th>
                <th className={`${TH} w-[52px]`} />
              </tr>
            </thead>
            <tbody>
              {items.map((s) => {
                const finished = !s.nextRunAt && !s.enabled && s.runs > 0;
                return (
                  <tr key={s.id} className="transition-colors hover:bg-white/[0.022]">
                    <td className={TD}>
                      <div className="flex items-center gap-2 font-semibold">
                        <span
                          className={`h-[7px] w-[7px] shrink-0 rounded-full ${
                            s.lastError ? "bg-danger" : s.enabled ? "bg-ok" : "bg-muted"
                          }`}
                        />
                        <span className="truncate">{s.name}</span>
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-muted">
                        {s.recipientCount.toLocaleString()} recipient
                        {s.recipientCount === 1 ? "" : "s"}
                        {s.runs > 0 && <> · ran {s.runs}×</>}
                      </div>
                      {s.lastError && (
                        <div className="mt-1 flex items-center gap-1 text-[11.5px] text-danger">
                          <AlertCircle size={12} /> {s.lastError}
                        </div>
                      )}
                    </td>
                    <td className={TD}>
                      <Badge tone="muted">
                        {s.kind === "call" ? (
                          <>
                            <Phone size={11} /> Bulk call
                          </>
                        ) : (
                          <>
                            <MessageCircle size={11} /> WhatsApp
                          </>
                        )}
                      </Badge>
                    </td>
                    <td className={`${TD} text-ink2`}>{describe(s)}</td>
                    <td className={`${TD} tabular-nums`}>
                      {s.enabled && s.nextRunAt ? (
                        <>
                          {istWhen(s.nextRunAt)} <span className="text-muted">IST</span>
                        </>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={TD}>
                      {s.lastError ? (
                        <Badge tone="danger">Errored</Badge>
                      ) : finished ? (
                        <Badge tone="muted">Finished</Badge>
                      ) : s.enabled ? (
                        <Badge tone="ok">Armed</Badge>
                      ) : (
                        <Badge tone="warn">Paused</Badge>
                      )}
                    </td>
                    <td className={TD}>
                      <Kebab
                        items={[
                          // A finished one-off has nothing left to fire.
                          ...(finished
                            ? []
                            : [{
                                label: s.enabled ? "Pause" : "Resume",
                                icon: s.enabled ? <Pause size={13} /> : <Play size={13} />,
                                onClick: () => toggle(s),
                              }]),
                          {
                            label: "Delete",
                            icon: <Trash2 size={13} />,
                            danger: true,
                            onClick: () => setConfirmDel(s),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </DataPanel>

      <ConfirmDialog
        open={!!confirmDel}
        title="Delete schedule"
        busy={busy}
        confirmLabel="Delete schedule"
        body={
          <>
            Delete <span className="font-medium text-ink">{confirmDel?.name}</span>? It won’t run again.
            Runs that already started are not affected, and nothing already sent is undone.
          </>
        }
        onConfirm={() => confirmDel && remove(confirmDel)}
        onClose={() => setConfirmDel(null)}
      />
    </Section>
  );
}
