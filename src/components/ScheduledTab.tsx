"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Play, Pause, Trash2, AlertCircle, Phone, MessageCircle } from "lucide-react";
import {
  Section,
  DataTable,
  TH,
  TD,
  Badge,
  IconButton,
  EmptyState,
  Spinner,
  ConfirmDialog,
  toast,
} from "./ui";
import { api } from "./useData";
import { type ScheduleApi, istWhen, describe } from "./ScheduleCard";
import { Panel, Seg, relTime } from "./DashboardParts";

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
type Filter = "all" | "call" | "whatsapp";

export default function ScheduledTab() {
  const [items, setItems] = useState<ScheduleApi[] | null>(null);
  const [err, setErr] = useState(false);
  const [confirmDel, setConfirmDel] = useState<ScheduleApi | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

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
    return {
      total: list.length,
      repeating: list.filter((s) => s.repeat !== "once").length,
      once: list.filter((s) => s.repeat === "once").length,
      armed: armed.length,
      queued: armed.reduce((n, s) => n + (s.recipientCount || 0), 0),
      next,
      failing: list.filter((s) => s.lastError).length,
      calls: list.filter((s) => s.kind === "call").length,
      whatsapp: list.filter((s) => s.kind === "whatsapp").length,
    };
  }, [items]);

  const shown = useMemo(
    () => (items ?? []).filter((s) => filter === "all" || s.kind === filter),
    [items, filter],
  );

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

  const strip: { label: string; value: React.ReactNode; sub: React.ReactNode; small?: boolean; danger?: boolean }[] = [
    {
      label: "Scheduled",
      value: stats.total.toLocaleString(),
      sub: `${stats.repeating} repeating · ${stats.once} one-off`,
    },
    {
      label: "Next run",
      value: stats.next?.nextRunAt ? istWhen(stats.next.nextRunAt) : "—",
      sub: stats.next?.nextRunAt ? `IST · ${relTime(stats.next.nextRunAt)}` : "Nothing armed",
      small: true,
    },
    {
      label: "Queued recipients",
      value: stats.queued.toLocaleString(),
      sub: `Across ${stats.armed} armed schedule${stats.armed === 1 ? "" : "s"}`,
    },
    {
      label: "Failed last run",
      value: stats.failing.toLocaleString(),
      sub: stats.failing ? "Needs a look" : "None",
      danger: stats.failing > 0,
    },
  ];

  // Divider lines between strip cells: stacked on phones, 2×2 on small
  // screens, one row of four from lg up.
  const cellBorder = [
    "",
    "border-t border-line sm:border-t-0 sm:border-l",
    "border-t border-line lg:border-t-0 lg:border-l",
    "border-t border-line sm:border-l lg:border-t-0",
  ];

  return (
    <Section>
      {/* 4-number summary strip */}
      <Panel>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
          {strip.map((s, i) => (
            <div key={s.label} className={`px-5 py-4 ${cellBorder[i]}`}>
              <div className="text-[13px] font-medium text-muted">{s.label}</div>
              <div
                className={`font-semibold tabular-nums tracking-[-0.035em] ${
                  s.small ? "mt-3 text-[20px] leading-tight" : "mt-1.5 text-[28px] leading-tight"
                } ${s.danger ? "text-danger" : "text-ink"}`}
              >
                {s.value}
              </div>
              <div className="mt-1 text-[12.5px] text-muted">{s.sub}</div>
            </div>
          ))}
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <Seg
            label="Filter by type"
            value={filter}
            onChange={setFilter}
            options={[
              { key: "all", label: "All", count: stats.total },
              { key: "call", label: "Calls", count: stats.calls },
              { key: "whatsapp", label: "WhatsApp", count: stats.whatsapp },
            ]}
          />
          <span className="text-[13px] text-muted sm:ml-auto">
            New schedules are created on Bulk calls or WhatsApp, where the recipient list is.
          </span>
        </div>

        {err ? (
          <div className="py-10 text-center text-sm text-danger">
            Couldn’t load schedules.{" "}
            <button onClick={load} className="text-accent underline">
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
        ) : shown.length === 0 ? (
          <div className="px-5 pb-6 pt-2 text-sm text-muted">
            No {filter === "call" ? "call" : "WhatsApp"} schedules.
          </div>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={TH}>Name</th>
                <th className={TH}>Type</th>
                <th className={`${TH} hidden sm:table-cell`}>Recipients</th>
                <th className={TH}>Next run</th>
                <th className={`${TH} hidden sm:table-cell`}>Repeats</th>
                <th className={TH}>Last run</th>
                <th className={`${TH} w-[90px]`} />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const finished = !s.nextRunAt && !s.enabled && s.runs > 0;
                return (
                  <tr key={s.id} className="transition-colors hover:bg-elev">
                    <td className={TD}>
                      <div className="font-semibold tracking-[-0.01em] text-ink">{s.name}</div>
                      <div className="mt-0.5 text-[12.5px] text-muted">
                        <span className="sm:hidden">
                          {s.recipientCount.toLocaleString()} recipient{s.recipientCount === 1 ? "" : "s"}
                          {s.runs > 0 && " · "}
                        </span>
                        {s.runs > 0 && <>Ran {s.runs}×</>}
                      </div>
                      {s.lastError && (
                        <div className="mt-1 flex items-center gap-1 text-xs text-danger">
                          <AlertCircle size={12} className="shrink-0" /> {s.lastError}
                        </div>
                      )}
                    </td>
                    <td className={TD}>
                      {s.kind === "call" ? (
                        <Badge tone="accent"><Phone size={12} /> Call</Badge>
                      ) : (
                        <Badge tone="ok"><MessageCircle size={12} /> WhatsApp</Badge>
                      )}
                    </td>
                    <td className={`${TD} hidden tabular-nums text-ink2 sm:table-cell`}>
                      {s.recipientCount.toLocaleString()}
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                      {s.enabled && s.nextRunAt ? (
                        <>
                          <div>{istWhen(s.nextRunAt)} <span className="text-muted">IST</span></div>
                          <div className="text-xs text-muted">{relTime(s.nextRunAt)}</div>
                        </>
                      ) : finished ? (
                        <Badge tone="muted">Finished</Badge>
                      ) : !s.enabled ? (
                        <Badge tone="warn">Paused</Badge>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td className={`${TD} hidden text-ink2 sm:table-cell`}>{describe(s)}</td>
                    <td className={TD}>
                      {s.lastError ? (
                        <Badge tone="danger">Last run failed</Badge>
                      ) : s.lastRunAt ? (
                        <Badge tone="ok">Last run OK</Badge>
                      ) : (
                        <Badge tone="muted">Waiting</Badge>
                      )}
                    </td>
                    <td className={TD}>
                      <div className="flex justify-end gap-0.5">
                        {/* A finished one-off has nothing left to fire. */}
                        {!finished && (
                          <IconButton
                            size="sm"
                            icon={s.enabled ? <Pause size={14} /> : <Play size={14} />}
                            title={s.enabled ? "Pause" : "Resume"}
                            onClick={() => toggle(s)}
                          />
                        )}
                        <IconButton
                          size="sm"
                          variant="danger"
                          icon={<Trash2 size={14} />}
                          title="Delete"
                          onClick={() => setConfirmDel(s)}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </Panel>

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
