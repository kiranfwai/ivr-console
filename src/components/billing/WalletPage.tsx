"use client";

import { ArrowLeft, Wallet, Plus } from "lucide-react";
import { Card, Button, Badge, EmptyState, Section } from "../ui";
import type { WalletTxn } from "./types";
import { MOCK_WALLET_BALANCE_INR, MOCK_WALLET_TXNS } from "./mock";
import { formatINR, formatDate } from "./config";

export default function WalletPage({ onBack }: { onBack: () => void }) {
  const balance = MOCK_WALLET_BALANCE_INR;
  const txns: WalletTxn[] = MOCK_WALLET_TXNS;

  function handleTopUp() {
    // Wallet top-up flow not wired up yet (mock).
    // (Kept as a stub so the button is functional without a gateway.)
  }

  return (
    <Section>
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-ink transition-colors"
      >
        <ArrowLeft size={13} />
        Back to Billing
      </button>

      {/* Balance card */}
      <Card>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="shrink-0 w-14 h-14 rounded-2xl bg-elev border border-line flex items-center justify-center text-brand">
              <Wallet size={24} strokeWidth={2.25} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">Current balance</div>
              <div className="text-4xl font-semibold tabular-nums leading-tight mt-0.5">
                {formatINR(balance)}
              </div>
            </div>
          </div>
          <Button leftIcon={<Plus size={14} />} onClick={handleTopUp}>
            Top Up
          </Button>
        </div>
      </Card>

      {/* Wallet transaction history */}
      <Card title="Transaction History" description="Wallet top-ups and charges">
        {txns.length === 0 ? (
          <EmptyState
            icon={<Wallet size={20} />}
            title="No transactions yet"
            description="Your wallet top-ups and charges will show up here."
          />
        ) : (
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
                {txns.map((t) => {
                  const positive = t.amount >= 0;
                  return (
                    <tr key={t.id} className="border-t border-line hover:bg-elev/40 transition-colors">
                      <td className="py-2 px-1 whitespace-nowrap text-muted text-xs">{formatDate(t.date)}</td>
                      <td className="px-1">
                        <Badge tone={positive ? "ok" : "danger"}>
                          {t.type === "topup" ? "Top-up" : "Charge"}
                        </Badge>
                      </td>
                      <td className="px-1 max-w-[240px] truncate text-ink2">{t.description}</td>
                      <td
                        className={`px-1 text-right font-mono tabular-nums ${
                          positive ? "text-ok" : "text-danger"
                        }`}
                      >
                        {positive ? "+" : "−"}
                        {formatINR(Math.abs(t.amount))}
                      </td>
                      <td className="px-1 text-right font-mono tabular-nums text-ink2">
                        {formatINR(t.balanceAfter)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </Section>
  );
}
