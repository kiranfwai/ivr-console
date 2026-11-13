"use client";

import { useEffect, useState } from "react";
import { Wallet, Phone, Clock, SlidersHorizontal, Plus, Coins } from "lucide-react";
import {
  Section,
  Button,
  Input,
  Label,
  Badge,
  Modal,
  Spinner,
  EmptyState,
  Loading,
  DataTable,
  TH,
  TD,
  Kebab,
  toast,
} from "../ui";
import { Avatar, KpiCard, Panel } from "../AdminTabKit";
import { api } from "../useData";
import { fmtMoney, currencySymbol, istToday, istDaysAgo } from "./money";
import { useAnalytics, RangeControl, viewAsClient, type AnalyticsRow, type Pricing } from "./shared";
import InvoicingCard from "./InvoicingCard";

export default function FinancialsView() {
  const [from, setFrom] = useState(istDaysAgo(29));
  const [to, setTo] = useState(istToday());
  const { data, err, loading, reload } = useAnalytics(from, to);
  const [editing, setEditing] = useState<AnalyticsRow | null>(null);
  const [funding, setFunding] = useState<AnalyticsRow | null>(null);

  const currency = data?.currency || "INR";
  const walletTotal = data ? data.rows.reduce((n, r) => n + (r.balance || 0), 0) : 0;
  const clientCount = data?.rows.length ?? 0;

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
      </div>

      {err && <div className="text-sm text-danger">{err}</div>}

      {/* Totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={<Wallet size={15} />}
          tone="accent"
          label="Wallet balances"
          value={data ? fmtMoney(walletTotal, currency) : "—"}
          foot={`live · across ${clientCount} client${clientCount === 1 ? "" : "s"}`}
        />
        <KpiCard
          icon={<Coins size={15} />}
          tone="ok"
          label="Client spend"
          value={data ? fmtMoney(data.totals.cost, currency) : "—"}
          foot="estimated usage in range"
        />
        <KpiCard
          icon={<Phone size={15} />}
          tone="warn"
          label="Calls placed"
          value={data ? data.totals.total.toLocaleString("en-IN") : "—"}
          foot={`${(data?.totals.connected ?? 0).toLocaleString("en-IN")} connected`}
        />
        <KpiCard
          icon={<Clock size={15} />}
          tone="info"
          label="Connected minutes"
          value={data ? data.totals.minutes.toLocaleString("en-IN") : "—"}
          foot="billed talk time"
        />
      </div>

      <Panel
        title="Cost and wallets by client"
        sub="Spend is the estimated usage for the range (connected calls × rate). Wallet is the live balance."
      >
        {!data ? (
          <Loading label="Loading financials…" />
        ) : data.rows.length === 0 ? (
          <EmptyState
            icon={<Wallet size={20} />}
            title="No data yet"
            description="Create client logins, or run calls, to see costs here."
          />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={TH}>Client</th>
                <th className={`${TH} text-right`}>Wallet</th>
                <th className={`${TH} hidden text-right sm:table-cell`}>Calls</th>
                <th className={`${TH} hidden text-right md:table-cell`}>Connected</th>
                <th className={`${TH} hidden text-right md:table-cell`}>Rate / call</th>
                <th className={`${TH} text-right`}>Spend</th>
                <th className={`${TH} w-[120px]`}></th>
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
                  <td
                    className={`${TD} whitespace-nowrap text-right font-semibold tabular-nums ${
                      r.balance <= 0 ? "text-danger" : "text-ink"
                    }`}
                  >
                    {fmtMoney(r.balance, currency)}
                  </td>
                  <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>{r.total.toLocaleString("en-IN")}</td>
                  <td className={`${TD} hidden text-right tabular-nums md:table-cell`}>{r.connected.toLocaleString("en-IN")}</td>
                  <td className={`${TD} hidden text-right tabular-nums md:table-cell`}>
                    <RateCell value={r.effPerConnectedCall} overridden={r.perConnectedCallOverride != null} currency={currency} />
                  </td>
                  <td className={`${TD} whitespace-nowrap text-right font-semibold tabular-nums text-ok`}>
                    {fmtMoney(r.cost, currency)}
                  </td>
                  <td className={TD}>
                    <div className="flex items-center justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => viewAsClient(r.id, "billing")} title="Open this client's console">
                        Open
                      </Button>
                      <Kebab
                        label={`Actions for ${r.name || r.email}`}
                        items={[
                          { label: "Add or remove funds", icon: <Plus size={14} />, onClick: () => setFunding(r) },
                          { label: "Set client rate", icon: <SlidersHorizontal size={14} />, onClick: () => setEditing(r) },
                        ]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-elev font-semibold text-ink">
                <td className={TD}>Total</td>
                <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{fmtMoney(walletTotal, currency)}</td>
                <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>{data.totals.total.toLocaleString("en-IN")}</td>
                <td className={`${TD} hidden text-right tabular-nums md:table-cell`}>{data.totals.connected.toLocaleString("en-IN")}</td>
                <td className={`${TD} hidden md:table-cell`} />
                <td className={`${TD} whitespace-nowrap text-right tabular-nums`}>{fmtMoney(data.totals.cost, currency)}</td>
                <td className={TD} />
              </tr>
            </tfoot>
          </DataTable>
        )}
      </Panel>

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

      <InvoicingCard />

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
    <span className="inline-flex items-center gap-1.5">
      {fmtMoney(value, currency)}
      {overridden && (
        <span className="rounded-full border border-accent/25 bg-accent/10 px-1.5 text-[11px] font-medium text-accent" title="Client-specific rate">
          custom
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
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            Save rate
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="m-0 text-[13px] text-muted">
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
          <Button variant="ghost" onClick={onClose} disabled={busy}>
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
        <p className="m-0 text-[13px] text-muted">
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
