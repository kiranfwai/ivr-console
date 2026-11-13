"use client";

import { useState } from "react";
import { BarChart3, Download } from "lucide-react";
import { Section, Badge, Button, DataTable, TH, TD, EmptyState, Loading, Spinner } from "../ui";
import { fmtMoney, istToday, istDaysAgo } from "./money";
import { useAnalytics, RangeControl, viewAsClient } from "./shared";
import { Avatar, MiniBar } from "../AdminTabKit";

export default function ReportsByClientView() {
  const [from, setFrom] = useState(istDaysAgo(29));
  const [to, setTo] = useState(istToday());
  const { data, err, loading } = useAnalytics(from, to);
  const currency = data?.currency || "INR";

  const totalLift = data && data.totals.total ? Math.round((data.totals.connected / data.totals.total) * 100) : 0;

  function exportCsv() {
    if (!data?.rows.length) return;
    const head = ["Client", "Email", "Placed", "Connected", "Pressed 1", "Busy", "No answer", "Failed", "Answer rate %", `Cost (${currency})`];
    const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = data.rows.map((r) =>
      [r.name, r.email, r.total, r.connected, r.press1, r.busy, r.noAnswer, r.failed, r.liftRate, r.cost].map(esc).join(","),
    );
    const csv = [head.map(esc).join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `client-reports_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <Section>
      <div className="flex flex-wrap items-center gap-3">
        <RangeControl
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
        {loading && <Spinner size={16} />}
        <span className="flex-1" />
        <Button variant="ghost" leftIcon={<Download size={14} />} onClick={exportCsv} disabled={!data?.rows.length}>
          CSV
        </Button>
      </div>

      {err && <div className="text-sm text-danger">{err}</div>}

      <div className="relative overflow-hidden rounded-xl border border-line bg-panel shadow-card">
        {!data ? (
          <Loading label="Loading client reports…" />
        ) : data.rows.length === 0 ? (
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="No data yet"
            description="Create client logins, or run calls, to see reports here."
          />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={TH}>Client</th>
                <th className={`${TH} text-right`}>Calls</th>
                <th className={`${TH} text-right`}>Answer rate</th>
                <th className={`${TH} hidden text-right sm:table-cell`}>Pressed 1</th>
                <th className={`${TH} hidden text-right lg:table-cell`}>Busy</th>
                <th className={`${TH} hidden text-right lg:table-cell`}>No answer</th>
                <th className={`${TH} hidden text-right lg:table-cell`}>Failed</th>
                <th className={`${TH} text-right`}>Spend</th>
                <th className={TH}></th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.id} className="transition-colors hover:bg-elev">
                  <td className={TD}>
                    <div className="flex items-center gap-3">
                      <Avatar name={r.name || r.email} size={30} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 font-semibold tracking-[-0.01em] text-ink">
                          <span className="truncate">{r.name || r.email}</span>
                          {!r.active && <Badge tone="muted">Disabled</Badge>}
                        </div>
                        <div className="truncate text-[12.5px] text-muted">{r.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className={`${TD} text-right tabular-nums`}>{r.total.toLocaleString("en-IN")}</td>
                  <td className={TD}>
                    <MiniBar pct={r.liftRate} />
                  </td>
                  <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>{r.press1.toLocaleString("en-IN")}</td>
                  <td className={`${TD} hidden text-right tabular-nums text-ink2 lg:table-cell`}>{r.busy.toLocaleString("en-IN")}</td>
                  <td className={`${TD} hidden text-right tabular-nums text-ink2 lg:table-cell`}>{r.noAnswer.toLocaleString("en-IN")}</td>
                  <td className={`${TD} hidden text-right tabular-nums text-ink2 lg:table-cell`}>{r.failed.toLocaleString("en-IN")}</td>
                  <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{fmtMoney(r.cost, currency)}</td>
                  <td className={`${TD} text-right`}>
                    <Button size="sm" variant="ghost" onClick={() => viewAsClient(r.id, "reports")} title="Open this client's full reports">
                      Open
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-elev font-semibold text-ink">
                <td className={TD}>Total</td>
                <td className={`${TD} text-right tabular-nums`}>{data.totals.total.toLocaleString("en-IN")}</td>
                <td className={TD}>
                  <MiniBar pct={totalLift} />
                </td>
                <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>{data.totals.press1.toLocaleString("en-IN")}</td>
                {(["busy", "noAnswer", "failed"] as const).map((k) => (
                  <td key={k} className={`${TD} hidden text-right tabular-nums lg:table-cell`}>
                    {data.rows.reduce((n, r) => n + r[k], 0).toLocaleString("en-IN")}
                  </td>
                ))}
                <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{fmtMoney(data.totals.cost, currency)}</td>
                <td className={TD} />
              </tr>
            </tfoot>
          </DataTable>
        )}
      </div>
      {data && data.rows.length > 0 && (
        <p className="m-0 text-[12.5px] text-muted">
          Answer rate = connected ÷ placed. Spend is the estimated usage for the range (connected calls × rate).
        </p>
      )}
    </Section>
  );
}
