"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, ChevronDown, Check } from "lucide-react";
import { Section, Card, EmptyState, Spinner, Badge } from "./ui";
import { useFetch } from "./useData";
import SheetReportPanel from "./SheetReportPanel";
import { Popover, TRIGGER } from "./ReportsTabUi";
import type { GSheetConn } from "@/lib/gsheets";
import type { Campaign } from "@/lib/models";

/**
 * The per-sheet report, given a home of its own.
 *
 * Nothing new is built here. This report already existed and already exported
 * to CSV and XLSX — but the only way to reach it was a button on one of the
 * sheet cards inside Sheet Auto-Dial, so you had to remember it was there.
 *
 * The picker below replaces "whichever card you happened to click", and the
 * screen sits next to Call reports where you'd look for it.
 */
export default function SheetReportsTab() {
  const { data: cdata, loading: loadingConns } = useFetch<{ connections: GSheetConn[] }>(
    "/api/gsheets/config",
  );
  const { data: campData } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");

  // Active sheets first, then the most recently synced — so the screen opens on
  // the sheet you are most likely running, not on whichever was connected first.
  const conns = useMemo(() => {
    const list = [...(cdata?.connections ?? [])];
    const t = (c: GSheetConn) => (c.lastSyncedAt ? new Date(c.lastSyncedAt).getTime() : 0);
    return list.sort((a, b) => Number(b.enabled) - Number(a.enabled) || t(b) - t(a));
  }, [cdata]);
  const campaigns = campData?.campaigns ?? [];
  const [connId, setConnId] = useState("");

  // Default to the first (= most relevant, see sort above) connection once they
  // load, so the screen opens on a report instead of an empty picker.
  useEffect(() => {
    if (!connId && conns.length) setConnId(conns[0].id);
  }, [conns, connId]);

  const conn = conns.find((c) => c.id === connId) ?? null;
  const campaignName =
    campaigns.find((c) => c.id === conn?.campaignId)?.name || "this campaign";

  if (loadingConns && !cdata) {
    return (
      <Section>
        <div className="flex justify-center py-16 text-muted">
          <Spinner size={18} />
        </div>
      </Section>
    );
  }

  if (!conns.length) {
    return (
      <Section>
        <Card>
          <EmptyState
            icon={<FileSpreadsheet size={20} />}
            title="No sheets connected yet"
            description="Connect a Google Sheet under Sheet auto-dial and its report will appear here — every row it produced, and what happened to each one."
          />
        </Card>
      </Section>
    );
  }

  const lead = (
    <>
      <SheetPicker conns={conns} value={connId} onChange={setConnId} />
      {conn && (
        <>
          <Badge tone={conn.enabled ? "ok" : "warn"}>{conn.enabled ? "Active" : "Paused"}</Badge>
          {conn.lastError && <Badge tone="danger">Last sync failed</Badge>}
        </>
      )}
    </>
  );

  return (
    <Section>
      {conn && (
        // key forces a clean refetch when the sheet changes, so filters and
        // paging don't carry over from the previous sheet's report.
        <SheetReportPanel key={conn.id} conn={conn} campaignName={campaignName} toolbarLead={lead} />
      )}
    </Section>
  );
}

function SheetPicker({
  conns,
  value,
  onChange,
}: {
  conns: GSheetConn[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const cur = conns.find((c) => c.id === value);
  const label = (c: GSheetConn) => c.connName || c.tabName;

  return (
    <Popover
      open={open}
      onClose={close}
      trigger={
        <button type="button" className={TRIGGER} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <FileSpreadsheet size={15} className="text-muted" />
          <span className="max-w-[240px] truncate">{cur ? label(cur) : "Pick a sheet"}</span>
          <ChevronDown size={14} className="text-muted" />
        </button>
      }
    >
      <div className="max-h-[360px] w-[min(320px,calc(100vw-2rem))] overflow-auto">
        {[true, false].map((on) => {
          const group = conns.filter((c) => c.enabled === on);
          if (!group.length) return null;
          return (
            <div key={String(on)}>
              <div className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted">
                {on ? "Active" : "Paused"} · {group.length}
              </div>
              {group.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onChange(c.id);
                    close();
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13.5px] transition-colors hover:bg-ink/[0.05] ${
                    c.id === value ? "text-ink" : "text-ink2"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.lastError ? "bg-danger" : on ? "bg-ok" : "bg-muted"}`} />
                  <span className="min-w-0 flex-1 truncate">{label(c)}</span>
                  {c.id === value && <Check size={14} className="shrink-0 text-accent" />}
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
