"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, AlertCircle, CheckCircle2, Download } from "lucide-react";
import { Card, Button, Input, Label, Select, Badge, Spinner, toast } from "../ui";
import { api } from "../useData";

interface Seller {
  enabled: boolean;
  legalName: string; gstin: string; address: string; state: string; stateCode: string;
  email: string; phone: string;
  seriesPrefix: string; gstRate: number; taxMode: "inclusive" | "exclusive";
  sacCode: string; description: string;
}

interface Cfg { settings: Seller; missing: string[]; issuing: boolean }

interface InvoiceRow {
  id: number; invoiceNo: string; clientId: string; issuedAt: string;
  totals: { totalP: number; interState: boolean };
  buyer: { legalName: string; name: string; gstin: string };
}

function money(p: number): string {
  const s = (Math.abs(p) / 100).toFixed(2);
  const [w, f] = s.split(".");
  const last3 = w.slice(-3), rest = w.slice(0, -3);
  return (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3) + "." + f;
}

/**
 * Your own invoicing identity, and every invoice issued.
 *
 * Nothing here is guessed: until the required fields are filled and invoicing is
 * switched on, no invoice is raised at all. Payments keep working the whole time,
 * and anything taken in the meantime can be issued afterwards with "Issue
 * missing invoices" — so turning this on late costs you nothing.
 */
export default function InvoicingCard() {
  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [f, setF] = useState<Seller | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [filling, setFilling] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, inv] = await Promise.all([
        api<Cfg>("/api/admin/invoicing"),
        api<{ invoices: InvoiceRow[] }>("/api/admin/invoices?limit=50"),
      ]);
      setCfg(c); setF({ ...c.settings }); setInvoices(inv.invoices);
    } catch (e: any) {
      toast(e?.message || "Could not load invoicing settings", "danger");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(next?: Partial<Seller>) {
    if (!f) return;
    const body = { ...f, ...next };
    setSaving(true);
    try {
      const c = await api<Cfg>("/api/admin/invoicing", { method: "PUT", body: JSON.stringify(body) });
      setCfg(c); setF({ ...c.settings });
      toast(c.issuing ? "Saved — invoices are being issued." : "Saved.", "ok");
    } catch (e: any) {
      toast(e?.message || "Could not save", "danger");
    }
    setSaving(false);
  }

  async function backfill() {
    setFilling(true);
    try {
      const r = await api<{ issued: number; skipped: number }>("/api/admin/invoicing", { method: "POST" });
      toast(r.issued ? `Issued ${r.issued} invoice(s).` : "Nothing was missing.", "ok");
      await load();
    } catch (e: any) {
      toast(e?.message || "Could not issue missing invoices", "danger");
    }
    setFilling(false);
  }

  if (!f || !cfg) return <Card title="Tax invoices"><div className="flex justify-center py-8"><Spinner /></div></Card>;

  const set = (k: keyof Seller) => (e: any) => setF({ ...f, [k]: e.target.value });

  return (
    <Card
      title={<span className="flex items-center gap-2"><FileText size={16} className="text-brand" /> Tax invoices</span>}
      description="Your details, printed on every invoice issued to a customer"
      action={
        cfg.issuing
          ? <Badge tone="ok"><CheckCircle2 size={12} /> Issuing</Badge>
          : <Badge tone="muted">Not issuing</Badge>
      }
    >
      {!cfg.issuing && (
        <div className="mb-4 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-warn" />
          <div>
            <b className="font-medium">No invoices are being issued.</b>
            <div className="text-xs text-muted mt-0.5">
              {cfg.missing.length
                ? <>Still needed: {cfg.missing.join(", ")}.</>
                : <>Fill in the details below, then switch invoicing on.</>}{" "}
              Payments are unaffected — anything taken meanwhile can be issued afterwards.
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label required>Registered business name</Label>
          <Input value={f.legalName} onChange={set("legalName")} placeholder="Freedom With AI Technologies Private Limited" />
        </div>
        <div>
          <Label required>GSTIN</Label>
          <Input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} placeholder="29AABCF1234M1Z7" />
        </div>
        <div>
          <Label required hint="Two digits">State code</Label>
          <Input value={f.stateCode} onChange={(e) => setF({ ...f, stateCode: e.target.value.slice(0, 2) })} placeholder="29" />
        </div>
        <div className="sm:col-span-2">
          <Label required>Registered address</Label>
          <Input value={f.address} onChange={set("address")} placeholder="3rd Floor, …, Bengaluru, Karnataka 560103" />
        </div>
        <div>
          <Label required>State</Label>
          <Input value={f.state} onChange={set("state")} placeholder="Karnataka" />
        </div>
        <div>
          <Label>Billing email</Label>
          <Input value={f.email} onChange={set("email")} placeholder="billing@freedomwithai.com" />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={f.phone} onChange={set("phone")} placeholder="+91 80 4718 2200" />
        </div>
        <div>
          <Label hint="e.g. FWAI/26-27/0001">Invoice number prefix</Label>
          <Input value={f.seriesPrefix} onChange={set("seriesPrefix")} placeholder="FWAI" />
        </div>
        <div>
          <Label>GST rate %</Label>
          <Input type="number" value={f.gstRate} onChange={(e) => setF({ ...f, gstRate: Number(e.target.value) })} />
        </div>
        <div>
          <Label>SAC code</Label>
          <Input value={f.sacCode} onChange={set("sacCode")} placeholder="998414" />
        </div>
        <div className="sm:col-span-2">
          <Label>Is tax already inside the amount, or added on top?</Label>
          <Select value={f.taxMode} onChange={(e) => setF({ ...f, taxMode: e.target.value as Seller["taxMode"] })}>
            <option value="inclusive">Already included — customer pays ₹1,000 and gets ₹1,000 of credit</option>
            <option value="exclusive">Added on top — customer pays ₹1,180 for ₹1,000 of credit</option>
          </Select>
          <div className="text-xs text-muted mt-1">
            {f.taxMode === "inclusive"
              ? "Nothing changes for the customer; the tax is carved out of what they already pay."
              : "Warning: this changes the amount charged at checkout, not just the invoice."}
          </div>
        </div>
        <div className="sm:col-span-2">
          <Label>Line-item wording</Label>
          <Input value={f.description} onChange={set("description")} />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-line">
        <Button onClick={() => save()} loading={saving}>Save details</Button>
        <Button
          variant={f.enabled ? "ghost" : "primary"}
          onClick={() => save({ enabled: !f.enabled })}
          loading={saving}
        >
          {f.enabled ? "Stop issuing invoices" : "Start issuing invoices"}
        </Button>
        <Button variant="ghost" onClick={backfill} loading={filling} disabled={!cfg.issuing}>
          Issue missing invoices
        </Button>
      </div>

      {invoices && invoices.length > 0 && (
        <div className="mt-5 pt-4 border-t border-line overflow-x-auto">
          <div className="text-xs uppercase tracking-wider text-muted mb-2">Recent invoices</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-line">
                <th className="py-2 pr-3 font-medium">Invoice</th>
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">GSTIN</th>
                <th className="py-2 pr-3 font-medium text-right">Total</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-b border-line/60 hover:bg-elev/50">
                  <td className="py-2 pr-3 tabular-nums">{i.invoiceNo}</td>
                  <td className="py-2 pr-3">{i.buyer.legalName || i.buyer.name || i.clientId}</td>
                  <td className="py-2 pr-3 text-muted text-xs">{i.buyer.gstin || "Unregistered"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{money(i.totals.totalP)}</td>
                  <td className="py-2 pr-3 text-right">
                    <a
                      href={`/api/admin/invoices/${i.id}/pdf`}
                      className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-ink px-2 py-1 rounded-md hover:bg-elev"
                    >
                      <Download size={13} /> PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
