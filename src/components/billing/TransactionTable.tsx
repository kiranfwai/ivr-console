"use client";

import { useMemo, useState } from "react";
import { Badge, Button } from "../ui";
import type { Transaction, TxnType } from "./types";
import { TXN_TYPE_META, TXN_FILTERS } from "./meta";
import { formatDate, formatCredits, TXN_PAGE_SIZE } from "./config";

export default function TransactionTable({ transactions }: { transactions: Transaction[] }) {
  const [filter, setFilter] = useState<TxnType | null>(null);
  const [visible, setVisible] = useState(TXN_PAGE_SIZE);

  const filtered = useMemo(
    () => (filter ? transactions.filter((t) => t.type === filter) : transactions),
    [transactions, filter],
  );

  function changeFilter(next: TxnType | null) {
    setFilter(next);
    setVisible(TXN_PAGE_SIZE);
  }

  const shown = filtered.slice(0, visible);
  const remaining = filtered.length - shown.length;

  return (
    <div>
      {/* Header: total count + filter tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="text-sm text-muted tabular-nums">
          {transactions.length.toLocaleString("en-IN")} transactions total
        </div>
        <div className="inline-flex p-1 bg-elev/60 border border-line rounded-lg">
          {TXN_FILTERS.map((f) => {
            const active = filter === f.value;
            return (
              <button
                key={f.label}
                onClick={() => changeFilter(f.value)}
                className={`px-2.5 py-1.5 rounded-md text-xs transition-all ${
                  active ? "bg-brand/15 text-brand" : "text-ink2 hover:text-ink"
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="text-sm text-muted py-6 text-center">No transactions of this type.</div>
      ) : (
        <>
          <div className="overflow-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="font-medium py-2 px-1">Date</th>
                  <th className="font-medium px-1">Type</th>
                  <th className="font-medium px-1">Description</th>
                  <th className="font-medium px-1 text-right">Amount</th>
                  <th className="font-medium px-1 text-right">Balance After</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const meta = TXN_TYPE_META[t.type];
                  const positive = t.amount >= 0;
                  return (
                    <tr key={t.id} className="border-t border-line hover:bg-elev/40 transition-colors">
                      <td className="py-2 px-1 whitespace-nowrap text-muted text-xs">{formatDate(t.date)}</td>
                      <td className="px-1">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-1 max-w-[240px] truncate text-ink2">{t.description}</td>
                      <td
                        className={`px-1 text-right font-mono tabular-nums ${
                          positive ? "text-ok" : "text-danger"
                        }`}
                      >
                        {formatCredits(t.amount)}
                      </td>
                      <td className="px-1 text-right font-mono tabular-nums text-ink2">
                        {t.balanceAfter.toLocaleString("en-IN")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {remaining > 0 && (
            <div className="flex justify-center pt-3">
              <Button variant="ghost" size="sm" onClick={() => setVisible((v) => v + TXN_PAGE_SIZE)}>
                Load {Math.min(TXN_PAGE_SIZE, remaining)} more · {remaining} remaining
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
