"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Wallet, Plus, Download, RefreshCw } from "lucide-react";
import { Card, Section, Button, Input, Label, Badge, EmptyState, Spinner, Modal, toast } from "./ui";
import { api } from "./useData";
import { formatINR, formatDate } from "./billing/config";
import { startCheckout } from "./billing/cashfreeCheckout";

interface WalletTxnApi {
  id: number;
  type: "topup" | "charge" | "adjustment" | "refund";
  amount: number;
  balanceAfter: number;
  description: string;
  ref: string | null;
  createdAt: string;
}

const TXN_LABEL: Record<WalletTxnApi["type"], { label: string; tone: "ok" | "danger" | "accent" | "muted" }> = {
  topup: { label: "Top-up", tone: "ok" },
  charge: { label: "Call charge", tone: "danger" },
  adjustment: { label: "Adjustment", tone: "accent" },
  refund: { label: "Refund", tone: "ok" },
};

export default function BillingTab() {
  const [balance, setBalance] = useState<number | null>(null);
  const [currency, setCurrency] = useState("INR");
  const [txns, setTxns] = useState<WalletTxnApi[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [topupOpen, setTopupOpen] = useState(false);
  const [success, setSuccess] = useState<{ amount: number | null } | null>(null);
  const verifiedRef = useRef(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const [w, t] = await Promise.all([
        api<{ balance: number; currency: string }>("/api/wallet"),
        api<{ transactions: WalletTxnApi[] }>("/api/wallet/transactions?limit=200"),
      ]);
      setBalance(w.balance);
      setCurrency(w.currency || "INR");
      setTxns(t.transactions);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Coming back from Cashfree checkout: verify the order, then clean the URL.
  useEffect(() => {
    if (verifiedRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const orderId = params.get("cf_order");
    if (!orderId) return;
    verifiedRef.current = true;
    (async () => {
      try {
        const r = await api<{ paid: boolean; balance: number; amount?: number }>(
          `/api/wallet/verify?order_id=${encodeURIComponent(orderId)}`,
        );
        if (r.paid) {
          setSuccess({ amount: typeof r.amount === "number" ? r.amount : null });
        } else {
          toast("Payment not completed. If you were charged, it'll reflect shortly.", "info");
        }
      } catch {
        toast("Couldn't confirm the payment. Refresh to see your balance.", "danger");
      } finally {
        const url = new URL(window.location.href);
        url.searchParams.delete("cf_order");
        window.history.replaceState(null, "", url);
        load();
      }
    })();
  }, [load]);

  return (
    <Section>
      {err && <div className="text-sm text-danger">{err}</div>}

      {/* Balance */}
      <Card className="overflow-hidden">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="shrink-0 w-14 h-14 rounded-2xl bg-gradient-to-br from-brand to-brand2 flex items-center justify-center text-bg shadow-glow">
              <Wallet size={26} strokeWidth={2.25} />
            </div>
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-muted">Wallet balance</div>
              <div className="text-4xl font-semibold tabular-nums leading-tight mt-0.5">
                {balance === null ? <span className="text-muted text-2xl">—</span> : formatINR(balance)}
              </div>
              <div className="text-xs text-muted mt-1">Charged per connected call</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button leftIcon={<Plus size={14} />} onClick={() => setTopupOpen(true)}>
              Add money
            </Button>
          </div>
        </div>
      </Card>

      {/* History */}
      <Card
        title="Transaction History"
        description="Wallet top-ups and per-call charges"
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={load}
              className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-ink px-2 py-1 rounded-md hover:bg-elev"
              title="Refresh"
            >
              <RefreshCw size={13} /> Refresh
            </button>
            <a
              href="/api/wallet/transactions/csv"
              className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-ink px-2 py-1 rounded-md hover:bg-elev"
            >
              <Download size={13} /> Export CSV
            </a>
          </div>
        }
      >
        {txns === null ? (
          <div className="flex items-center gap-2 text-muted text-sm py-6 justify-center">
            <Spinner size={16} /> Loading…
          </div>
        ) : txns.length === 0 ? (
          <EmptyState
            icon={<Wallet size={20} />}
            title="No transactions yet"
            description="Top up your wallet to start — charges from connected calls will appear here."
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
                  <th className="font-medium px-1 text-right">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => {
                  const positive = t.amount >= 0;
                  const meta = TXN_LABEL[t.type];
                  return (
                    <tr key={t.id} className="border-t border-line hover:bg-elev/40 transition-colors">
                      <td className="py-2 px-1 whitespace-nowrap text-muted text-xs">{formatDate(t.createdAt)}</td>
                      <td className="px-1">
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                      </td>
                      <td className="px-1 max-w-[240px] truncate text-ink2">{t.description}</td>
                      <td className={`px-1 text-right font-mono tabular-nums ${positive ? "text-ok" : "text-danger"}`}>
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

      <TopUpModal open={topupOpen} onClose={() => setTopupOpen(false)} currency={currency} />

      {success && (
        <PaymentSuccess amount={success.amount} balance={balance} onClose={() => setSuccess(null)} />
      )}
    </Section>
  );
}

/**
 * Full-screen celebratory overlay shown after a top-up is confirmed paid.
 * Animated tick (ring pop → checkmark draw → expanding glow), the amount just
 * added, and the new balance. Auto-dismisses after a few seconds; also click /
 * Esc / Done to close.
 */
function PaymentSuccess({
  amount,
  balance,
  onClose,
}: {
  amount: number | null;
  balance: number | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onClose, 4200);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Payment successful"
    >
      <div
        className="w-full max-w-sm bg-panel border border-line rounded-2xl shadow-elev px-8 py-9 text-center animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Animated tick */}
        <div className="relative mx-auto w-24 h-24 flex items-center justify-center">
          <span className="absolute inset-0 rounded-full bg-ok/25 animate-ring-out" />
          <span className="absolute inset-0 rounded-full bg-ok/10 animate-ring-out [animation-delay:0.35s]" />
          <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-ok to-ok2 flex items-center justify-center shadow-[0_0_0_1px_rgba(34,197,94,0.4),0_0_40px_rgba(34,197,94,0.35)] animate-check-pop">
            <svg width="46" height="46" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M4.5 12.5l5 5 10-11"
                stroke="#0a0c10"
                strokeWidth="2.75"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{ strokeDasharray: 48 }}
                className="animate-check-draw"
              />
            </svg>
          </div>
        </div>

        <div className="mt-6 animate-pop-in">
          <div className="text-xl font-semibold text-ink">Payment successful</div>
          {amount != null && (
            <div className="mt-2 inline-flex items-baseline gap-1.5 text-ok">
              <span className="text-3xl font-semibold tabular-nums">+{formatINR(amount)}</span>
              <span className="text-sm text-ink2">added to wallet</span>
            </div>
          )}
          {balance != null && (
            <div className="mt-3 text-sm text-muted">
              New balance <span className="text-ink font-medium tabular-nums">{formatINR(balance)}</span>
            </div>
          )}
        </div>

        <Button className="mt-7 w-full" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  );
}

const QUICK = [100, 500, 1000, 2000];
const MIN_TOPUP = 1;
const MAX_TOPUP = 100_000;

function TopUpModal({ open, onClose, currency }: { open: boolean; onClose: () => void; currency: string }) {
  const [amount, setAmount] = useState("500");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const amt = Number(amount);
  const valid = Number.isFinite(amt) && amt >= MIN_TOPUP && amt <= MAX_TOPUP;

  async function pay() {
    if (!valid) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await api<{ paymentSessionId: string; env: "sandbox" | "production" }>("/api/wallet/topup", {
        method: "POST",
        body: JSON.stringify({ amount: amt }),
      });
      // Redirects to Cashfree hosted checkout; we return to ?tab=billing&cf_order=…
      await startCheckout(r.paymentSessionId, r.env);
    } catch (e: any) {
      setErr(String(e?.message || e));
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title="Add money to wallet"
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={pay} loading={busy} disabled={!valid}>
            Pay {valid ? formatINR(amt) : ""}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="text-sm text-danger">{err}</div>}
        <div>
          <Label hint={`₹${MIN_TOPUP}–₹${MAX_TOPUP.toLocaleString("en-IN")}`}>Amount ({currency})</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={MIN_TOPUP}
            max={MAX_TOPUP}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="500"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => setAmount(String(q))}
              className="px-3 py-1.5 rounded-lg text-sm border border-line text-ink2 hover:bg-elev/60 hover:text-ink transition-colors"
            >
              {formatINR(q)}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          You'll be redirected to Cashfree to pay securely. Your balance updates automatically once payment completes.
        </p>
      </div>
    </Modal>
  );
}
