"use client";

import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { Section, Card, Select, Label, EmptyState, Spinner, Badge } from "./ui";
import { useFetch } from "./useData";
import SheetReportPanel from "./SheetReportPanel";
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
            description="Connect a Google Sheet under Sheet Auto-Dial and its report will appear here — every row it produced, and what happened to each one."
          />
        </Card>
      </Section>
    );
  }

  return (
    <Section>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[260px] flex-1">
            <Label hint={`${conns.length} connected`}>Sheet</Label>
            <Select value={connId} onChange={(e) => setConnId(e.target.value)}>
              {[true, false].map((on) => {
                const group = conns.filter((c) => c.enabled === on);
                if (!group.length) return null;
                return (
                  <optgroup key={String(on)} label={on ? "Active" : "Paused"}>
                    {group.map((c) => (
                      <option key={c.id} value={c.id}>{c.connName || c.tabName}</option>
                    ))}
                  </optgroup>
                );
              })}
            </Select>
          </div>
          {conn && (
            <div className="flex items-center gap-2 pb-1">
              <Badge tone={conn.enabled ? "ok" : "warn"}>
                {conn.enabled ? "Active" : "Paused"}
              </Badge>
              {conn.lastError && <Badge tone="danger">Last sync failed</Badge>}
            </div>
          )}
        </div>
      </Card>

      {conn && (
        // key forces a clean refetch when the sheet changes, so filters and
        // paging don't carry over from the previous sheet's report.
        <SheetReportPanel key={conn.id} conn={conn} campaignName={campaignName} />
      )}
    </Section>
  );
}
