"use client";

import { useEffect, useState } from "react";
import { Wallet } from "lucide-react";
import { api } from "./useData";

/**
 * Wallet balance, pinned in the top bar.
 *
 * Before the restructure the balance lived only inside Billing, so "can I still
 * dial?" meant leaving whatever you were doing. It's the one number worth
 * carrying on every screen.
 */
export default function SidebarWallet({ onOpen }: { onOpen?: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const w = await api<{ balance: number }>("/api/wallet");
        if (alive) {
          setBalance(w.balance);
          setFailed(false);
        }
      } catch {
        if (alive) setFailed(true);
      }
    }
    load();
    // Slow refresh: it moves as calls connect, but it isn't worth polling hard.
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (failed && balance === null) return null;

  // A compact button in the top bar: always visible, opens Billing.
  return (
    <button
      type="button"
      onClick={onOpen}
      title="Wallet balance — add money"
      className="flex h-[34px] items-center gap-2 rounded-[9px] border border-line bg-panel px-2.5 text-[13px] font-semibold shadow-xs transition-colors hover:border-line2"
    >
      <Wallet size={15} className="text-muted" />
      <span className="tabular-nums">
        {balance === null
          ? "…"
          : `₹${balance.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`}
      </span>
      {balance !== null && balance < 1000 && (
        <span className="border-l border-line pl-2 text-[11.5px] font-medium text-warn">Low</span>
      )}
    </button>
  );
}
