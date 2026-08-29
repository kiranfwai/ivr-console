"use client";

import { useEffect, useState } from "react";
import { api } from "./useData";

/**
 * Wallet balance, pinned in the sidebar.
 *
 * Before the restructure the balance lived only inside Billing, so "can I still
 * dial?" meant leaving whatever you were doing. It's the one number worth
 * carrying on every screen.
 */
export default function SidebarWallet() {
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

  return (
    <div className="rounded-xl border border-brand/20 bg-gradient-to-b from-brand/[0.07] to-brand/[0.02] px-3 py-2.5">
      <div className="text-[9.5px] font-bold uppercase tracking-[0.14em] text-muted">Wallet balance</div>
      <div className="mt-0.5 text-[17px] font-extrabold tracking-[-0.035em] tabular-nums">
        {balance === null ? (
          <span className="text-muted">…</span>
        ) : (
          `₹ ${balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        )}
      </div>
    </div>
  );
}
