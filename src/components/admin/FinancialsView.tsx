"use client";

import { useEffect, useState } from "react";
import { Wallet, Phone, Clock, SlidersHorizontal, ExternalLink, Plus } from "lucide-react";
import {
  Card,
  Section,
  Button,
  Input,
  Label,
  Badge,
  KPI,
  Modal,
  Spinner,
  EmptyState,
  toast,
} from "../ui";
import { api } from "../useData";
import { fmtMoney, currencySymbol, istToday, istDaysAgo } from "./money";
import { useAnalytics, RangeControl, viewAsClient, type AnalyticsRow, type Pricing } from "./shared";

export default function FinancialsView() {
  const [from, setFrom] = useState(istDaysAgo(29));
  const [to, setTo] = useState(istToday());
  const { data, err, loading, reload } = useAnalytics(from, to);
  const [editing, setEditing] = useState<AnalyticsRow | null>(null);
  const [funding, setFunding] = useState<AnalyticsRow | null>(null);

  const currency = data?.currency || "INR";

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

      {/* Totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPI
          label="Total cost"
          value={fmtMoney(data?.totals.cost ?? 0, currency)}
          sub="across all clients"
          icon={<Wallet size={18} />}
          tone="accent"
        />
        <KPI
          label="Calls placed"
          value={(data?.totals.total ?? 0).toLocaleString()}
          sub={`${(data?.totals.connected ?? 0).toLocaleString()} connected`}
          icon={<Phone size={18} />}
        />
        <KPI
          label="Connected minutes"
          value={(data?.totals.minutes ?? 0).toLocaleString()}
          sub="billed talk time"
          icon={<Clock size={18} />}
        />
      </div>

      <Card
        title="Cost & wallets by client"
        description="Cost = connected calls × per-connected-call rate. Balance is the live wallet."
      >
        {!data ? (
          <div className="flex items-center gap-2 text-muted text-sm py-6 justify-center">
            <Spinner size={16} /> Loading…
          </div>
        ) : data.rows.length === 0 ? (
          <EmptyState
            icon={<Wallet size={20} />}
            title="No clients yet"
            description="Create client logins to see their costs here."
          />
        ) : (
          <div className="overflow-auto -mx-1">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="font-medium py-2 px-2">Client</th>
                  <th className="font-medium px-2 text-right">Calls</th>
                  <th className="font-medium px-2 text-right">Connected</th>
                  <th className="font-medium px-2 text-right">Rate/call</th>
                  <th className="font-medium px-2 text-right">Cost</th>
                  <th className="font-medium px-2 text-right">Wallet</th>
                  <th className="font-medium px-2 text-right">Actions</th>
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
                    <td className="px-2 text-right tabular-nums">{r.connected.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">
                      <RateCell value={r.effPerConnectedCall} overridden={r.perConnectedCallOverride != null} currency={currency} />
                    </td>
                    <td className="px-2 text-right tabular-nums font-medium text-ink">
                      {fmtMoney(r.cost, currency)}
                    </td>
                    <td className={`px-2 text-right tabular-nums font-medium ${r.balance <= 0 ? "text-danger" : "text-ink"}`}>
                      {fmtMoney(r.balance, currency)}
                    </td>
                    <td className="px-2 text-right whitespace-nowrap">
                      <button
                        onClick={() => setFunding(r)}
                        className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-ink px-2 py-1 rounded-md hover:bg-elev"
                        title="Add funds / adjust wallet"
                      >
                        <Plus size={12} /> Funds
                      </button>
                      <button
                        onClick={() => setEditing(r)}
                        className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-ink px-2 py-1 rounded-md hover:bg-elev"
                        title="Set per-client rate override"
                      >
                        <SlidersHorizontal size={12} /> Rate
                      </button>
                      <button
                        onClick={() => viewAsClient(r.id, "billing")}
                        className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand/80 px-2 py-1 rounded-md hover:bg-brand/10"
                        title="Open this client's console"
                      >
                        <ExternalLink size={12} /> Open
                      </button>
                    </td>
                  </tr>
                ))}
                {data.legacy && (
                  <tr className="border-t border-line text-muted">
                    <td className="py-2.5 px-2 italic">Unassigned (legacy)</td>
                    <td className="px-2 text-right tabular-nums">{data.legacy.total.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">{data.legacy.connected.toLocaleString()}</td>
                    <td className="px-2 text-right tabular-nums">—</td>
                    <td className="px-2 text-right tabular-nums">{fmtMoney(data.legacy.cost, currency)}</td>
                    <td className="px-2 text-right tabular-nums">—</td>
                    <td />
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line2 font-medium text-ink">
                  <td className="py-2.5 px-2">Total</td>
                  <td className="px-2 text-right tabular-nums">{data.totals.total.toLocaleString()}</td>
                  <td className="px-2 text-right tabular-nums">{data.totals.connected.toLocaleString()}</td>
                  <td />
                  <td className="px-2 text-right tabular-nums">{fmtMoney(data.totals.cost, currency)}</td>
                  <td />
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      <RateOverrideModal
        row={editing}
        currency={currency}
        globalPricing={data?.pricing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />

      <AddFundsModal
        row={funding}
        currency={currency}
        onClose={() => setFunding(null)}
        onSaved={() => {
          setFunding(null);
          reload();
        }}
      />
    </Section>
  );
}

function RateCell({ value, overridden, currency }: { value: number; overridden: boolean; currency: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      {fmtMoney(value, currency)}
      {overridden && (
        <span className="text-[9px] uppercase tracking-wider text-brand" title="Client-specific override">
          •
        </span>
      )}
    </span>
  );
}

/** Set/clear a single client's per-connected-call rate override. */
function RateOverrideModal({
  row,
  currency,
  globalPricing,
  onClose,
  onSaved,
}: {
  row: AnalyticsRow | null;
  currency: string;
  globalPricing?: Pricing;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) return;
    setRate(row.perConnectedCallOverride == null ? "" : String(row.perConnectedCallOverride));
  }, [row]);

  async function save() {
    if (!row) return;
    setBusy(true);
    try {
      await api(`/api/admin/clients/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          // Empty clears the override (null) → falls back to the global default.
          perConnectedCall: rate.trim() === "" ? null : Number(rate),
        }),
      });
      toast("Client rate updated", "ok");
      onSaved();
    } catch (e: any) {
      toast(String(e?.message || e), "danger");
    }
    setBusy(false);
  }

  const sym = currencySymbol(currency);
  const gRate = globalPricing ? fmtMoney(globalPricing.perConnectedCall, currency) : "—";

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title={`Rate — ${row?.name || row?.email || ""}`}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save rate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Charged per connected (answered) call. Leave blank to use the global default.
        </p>
        <div>
          <Label hint={`default ${gRate}`}>Per connected call ({sym})</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder={`default ${gRate}`}
          />
        </div>
      </div>
    </Modal>
  );
}

/** Admin: manually credit or adjust a client's wallet balance. */
function AddFundsModal({
  row,
  currency,
  onClose,
  onSaved,
}: {
  row: AnalyticsRow | null;
  currency: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) return;
    setAmount("");
    setNote("");
  }, [row]);

  async function submit(mode: "credit" | "debit") {
    if (!row) return;
    const amt = Number(amount);
    if (!(amt > 0)) {
      toast("Enter a positive amount", "danger");
      return;
    }
    setBusy(true);
    try {
      const body =
        mode === "credit"
          ? { credit: amt, description: note || "Manual top-up (admin)" }
          : { amount: -amt, description: note || "Manual debit (admin)" };
      const r = await api<{ balance: number }>(`/api/admin/clients/${row.id}/wallet`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      toast(`Wallet updated — new balance ${fmtMoney(r.balance, currency)}`, "ok");
      onSaved();
    } catch (e: any) {
      toast(String(e?.message || e), "danger");
    }
    setBusy(false);
  }

  const sym = currencySymbol(currency);

  return (
    <Modal
      open={!!row}
      onClose={onClose}
      title={`Wallet — ${row?.name || row?.email || ""}`}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="ghost" onClick={() => submit("debit")} loading={busy}>
            Debit
          </Button>
          <Button onClick={() => submit("credit")} loading={busy}>
            Credit
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Current balance: <span className="text-ink font-medium">{fmtMoney(row?.balance ?? 0, currency)}</span>.
          Credit adds funds (e.g. cash/bank received); Debit removes them (correction).
        </p>
        <div>
          <Label>Amount ({sym})</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div>
          <Label hint="shown on the client's ledger">Note</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason / reference" />
        </div>
      </div>
    </Modal>
  );
}
