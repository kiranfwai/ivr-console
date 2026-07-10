"use client";

import { useState } from "react";
import { BarChart3, Phone, TrendingUp, ExternalLink } from "lucide-react";
import { Card, Section, Badge, KPI, Spinner, EmptyState } from "../ui";
import { istToday, istDaysAgo } from "./money";
import { useAnalytics, RangeControl, viewAsClient } from "./shared";

export default function ReportsByClientView() {
  const [from, setFrom] = useState(istDaysAgo(29));
  const [to, setTo] = useState(istToday());
  const { data, err, loading } = useAnalytics(from, to);

  const totalLift = data && data.totals.total ? Math.round((data.totals.connected / data.totals.total) * 100) : 0;

  return (
    <Section>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <RangeControl
          from={from}
          to={to}
          onChange={(f, t) => {
            setFrom(f);
            setTo(t);
          }}
        />
        {loading && <Spinner size={16} />}
      </div>

      {err && <div className="text-sm text-danger">{err}</div>}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPI
          label="Calls placed"
          value={(data?.totals.total ?? 0).toLocaleString()}
          sub="all clients"
          icon={<Phone size={18} />}
        />
        <KPI
          label="Connected"
          value={(data?.totals.connected ?? 0).toLocaleString()}
          sub={`${(data?.totals.press1 ?? 0).toLocaleString()} pressed 1`}
          icon={<BarChart3 size={18} />}
          tone="accent"
        />
        <KPI
          label="Lift rate"
          value={`${totalLift}%`}
          sub="connected ÷ placed"
          icon={<TrendingUp size={18} />}
          tone="ok"
        />
      </div>

      <Card title="Reports by client" description="Call volumes and outcomes per client over the selected range">
        {!data ? (
          <div className="flex items-center gap-2 text-muted text-sm py-6 justify-center">
            <Spinner size={16} /> Loading…
          </div>
        ) : data.rows.length === 0 && !data.legacy ? (
          <EmptyState
            icon={<BarChart3 size={20} />}
            title="No data yet"
            description="Create client logins, or run calls, to see reports here."
          />
        ) : (
          <div className="overflow-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="font-medium py-2 px-2">Client</th>
                  <th className="font-medium px-2 text-right">Placed</th>
                  <th className="font-medium px-2 text-right">Connected</th>
                  <th className="font-medium px-2 text-right">Press 1</th>
                  <th className="font-medium px-2 text-right">Busy</th>
                  <th className="font-medium px-2 text-right">No-ans</th>
                  <th className="font-medium px-2 text-right">Failed</th>
                  <th className="font-medium px-2 text-right">Lift</th>
                  <th className="font-medium px-2 text-right"></th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.id} className="border-t border-line hover:bg-elev/40">
                    <td className="py-2.5 px-2">
                      <div className="font-medium text-ink flex items-center gap-2">
                        {r.name || r.email}
                        {!r.active && <Badge tone="muted">Disabled</Badge>}
                      </div>
                      <div className="text-xs text-muted">{r.email}</div>
                    </td>
                    <td className="px-2 text-right tabular-nums">{r.total.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums text-ink">{r.connected.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{r.press1.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{r.busy.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{r.noAnswer.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{r.failed.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">
                      <Badge tone={r.liftRate >= 30 ? "ok" : r.liftRate >= 10 ? "warn" : "muted"}>
                        {r.liftRate}%
                      </Badge>
                    </td>
                    <td className="px-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => viewAsClient(r.id, "reports")}
                        className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand/80 px-2 py-1 rounded-md hover:bg-brand/10"
                        title="Open this client's full reports"
                      >
                        <ExternalLink size={12} /> Open
                      </button>
                    </td>
                  </tr>
                ))}
                {data.legacy && (
                  <tr className="border-t border-line text-muted">
                    <td className="py-2.5 px-2 italic">Main account (existing)</td>
                    <td className="px-2 text-right tabular-nums">{data.legacy.total.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{data.legacy.connected.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{data.legacy.press1.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{data.legacy.busy.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{data.legacy.noAnswer.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{data.legacy.failed.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{data.legacy.liftRate}%</td>
                    <td />
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line2 font-medium text-ink">
                  <td className="py-2.5 px-2">Total</td>
                  <td className="px-2 text-right tabular-nums">{data.totals.total.toLocaleString()}</td>
                  <td className="px-2 text-right tabular-nums">{data.totals.connected.toLocaleString()}</td>
                  <td className="px-2 text-right tabular-nums">{data.totals.press1.toLocaleString()}</td>
                  <td colSpan={3} />
                  <td className="px-2 text-right tabular-nums">{totalLift}%</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </Section>
  );
}
