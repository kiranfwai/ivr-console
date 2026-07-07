"use client";

import { ArrowLeft, Hash, Plus } from "lucide-react";
import { Card, Button, Badge, Section, toast } from "../ui";
import type { OwnedNumber } from "./types";
import { MOCK_OWNED_NUMBERS } from "./mock";
import { formatINR0, formatDate } from "./config";

export default function PhoneNumbersPage({ onBack }: { onBack: () => void }) {
  const numbers: OwnedNumber[] = MOCK_OWNED_NUMBERS;

  // Every owned number bills once per monthly cycle, so the coming 30 days
  // incur one charge per number — the summary is just the sum of monthly costs.
  const next30Total = numbers.reduce((sum, n) => sum + n.monthlyCostInr, 0);

  function handleRelease(n: OwnedNumber) {
    // Releasing a number is a destructive backend action — stubbed for now.
    toast(`Release ${n.number} — this will be wired up with the numbers API.`, "info");
  }

  function handleBuy() {
    toast("Buying new numbers will open the number search — coming soon.", "info");
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

      {/* Summary bar */}
      <Card>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="shrink-0 w-11 h-11 rounded-xl bg-elev border border-line flex items-center justify-center text-brand">
              <Hash size={20} />
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-muted">Next 30 days</div>
              <div className="text-lg font-semibold mt-0.5">
                <span className="tabular-nums">{formatINR0(next30Total)}</span>
                <span className="text-muted font-normal text-sm">
                  {" "}across {numbers.length} number{numbers.length === 1 ? "" : "s"}
                </span>
              </div>
            </div>
          </div>
          <Button leftIcon={<Plus size={14} />} onClick={handleBuy}>
            Buy new number
          </Button>
        </div>
      </Card>

      {/* Owned numbers table */}
      <Card title="Owned Numbers">
        <div className="overflow-auto -mx-1">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="font-medium py-2 px-1">Number</th>
                <th className="font-medium px-1">Status</th>
                <th className="font-medium px-1">Next Charge</th>
                <th className="font-medium px-1 text-right">Monthly cost</th>
                <th className="font-medium px-1 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {numbers.map((n) => (
                <tr key={n.id} className="border-t border-line hover:bg-elev/40 transition-colors">
                  <td className="py-2 px-1 font-mono text-xs">{n.number}</td>
                  <td className="px-1">
                    <Badge tone={n.active ? "ok" : "muted"} dot={n.active}>
                      {n.active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-1 whitespace-nowrap text-muted text-xs">{formatDate(n.nextCharge)}</td>
                  <td className="px-1 text-right font-mono tabular-nums">{formatINR0(n.monthlyCostInr)}</td>
                  <td className="px-1 text-right">
                    <button
                      onClick={() => handleRelease(n)}
                      className="text-xs text-danger hover:text-danger2 hover:underline transition-colors"
                    >
                      Release
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </Section>
  );
}
