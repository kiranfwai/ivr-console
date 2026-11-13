"use client";
import { fmtDate } from "@/lib/format";

import { useCallback, useEffect, useState } from "react";
import { FileText, AlertCircle, CheckCircle2, Download } from "lucide-react";
import { Card, Button, Input, Label, Select, Badge, Spinner, toast } from "../ui";
import BillingIdentityFields, { BillingIdentity, EMPTY_IDENTITY } from "../BillingIdentityFields";
import { api } from "../useData";

interface Seller {
  enabled: boolean;
  legalName: string; gstin: string; pan: string;
  address: string; line1: string; line2: string; city: string; pincode: string;
  state: string; stateCode: string;
  email: string; phone: string;
  seriesPrefix: string; gstRate: number; taxMode: "inclusive" | "exclusive";
  sacCode: string; description: string;
}

/**
 * Our own details use the same block the customer fills in — with no shipping
 * address, because we are the one sending, and always enforced, because an
 * invoice cannot be issued until every required field is there.
 */
function sellerToIdentity(f: Seller): BillingIdentity {
  return {
    ...EMPTY_IDENTITY,
    legalName: f.legalName, gstin: f.gstin, pan: f.pan || "",
    billingEmail: f.email, phone: f.phone,
    line1: f.line1 || "", line2: f.line2 || "", city: f.city || "",
    state: f.state, stateCode: f.stateCode, pincode: f.pincode || "",
  };
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
  // The seller details are set once and rarely touched; show them as a summary
  // and open the form only on purpose, so a stray edit can't reach live invoices.
  const [editing, setEditing] = useState<boolean | null>(null);

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

  async function save(next?: Partial<Seller>): Promise<boolean> {
    if (!f) return false;
    const body = { ...f, ...next };
    setSaving(true);
    try {
      const c = await api<Cfg>("/api/admin/invoicing", { method: "PUT", body: JSON.stringify(body) });
      setCfg(c); setF({ ...c.settings });
      toast(c.issuing ? "Saved — invoices are being issued." : "Saved.", "ok");
      setSaving(false);
      return true;
    } catch (e: any) {
      toast(e?.message || "Could not save", "danger");
    }
    setSaving(false);
    return false;
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
  // Open the form straight away only while invoicing isn't set up yet.
  const isEditing = editing ?? !cfg.issuing;

  return (
    <Card
      title={<span className="flex items-center gap-2"><FileText size={16} className="text-accent" /> Tax invoices</span>}
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

      {!isEditing ? (
        <div className="rounded-lg border border-line px-3 py-2.5 text-sm grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <div><span className="text-muted">Legal name · </span>{f.legalName || "—"}</div>
          <div><span className="text-muted">GSTIN · </span>{f.gstin || "—"}</div>
          <div><span className="text-muted">State · </span>{f.state || "—"}</div>
          <div><span className="text-muted">Numbering · </span>{f.seriesPrefix}/… · GST {f.gstRate}% · SAC {f.sacCode}</div>
          <div className="sm:col-span-2"><span className="text-muted">Tax · </span>
            {f.taxMode === "inclusive" ? "Already included in what the customer pays" : "Added on top at checkout"}</div>
        </div>
      ) : (<>
      <BillingIdentityFields
        value={sellerToIdentity(f)}
        onChange={(n) => setF({
          ...f,
          legalName: n.legalName, gstin: n.gstin, pan: n.pan,
          email: n.billingEmail, phone: n.phone,
          line1: n.line1, line2: n.line2, city: n.city, pincode: n.pincode,
          state: n.state, stateCode: n.stateCode,
        })}
        enforce
        legalNamePlaceholder="Freedom With AI Technologies Private Limited"
      />

      <div className="grid gap-3 sm:grid-cols-2 mt-3 pt-3 border-t border-line">
        <div className="sm:col-span-2 text-sm font-medium text-ink">How invoices are raised</div>
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
      </>)}

      <div className="flex flex-wrap items-center gap-2 mt-4 pt-4 border-t border-line">
        {isEditing ? (
          <>
            <Button onClick={async () => { if (await save()) setEditing(false); }} loading={saving}>Save details</Button>
            {cfg.issuing && <Button variant="ghost" onClick={() => { void load(); setEditing(false); }}>Cancel</Button>}
          </>
        ) : (
          <Button variant="ghost" onClick={() => setEditing(true)}>Edit details</Button>
        )}
        <Button
          variant={f.enabled ? "ghost" : "primary"}
          onClick={() => {
            if (f.enabled && !window.confirm("Stop issuing invoices? Top-ups taken while it is off will have no invoice until you issue the missing ones.")) return;
            void save({ enabled: !f.enabled });
          }}
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
                <th className="py-2 pr-3 font-medium">Date</th>
                <th className="py-2 pr-3 font-medium">Customer</th>
                <th className="py-2 pr-3 font-medium">GSTIN</th>
                <th className="py-2 pr-3 font-medium text-right">Total</th>
                <th className="py-2 pr-3"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id} className="border-b border-line/60 hover:bg-elev/50">
                  <td className="py-2 pr-3 tabular-nums whitespace-nowrap">
                    {i.invoiceNo}
                    {/* ₹1 / ₹10 top-ups were tests; flag them so they're easy to spot. */}
                    {i.totals.totalP < 10000 && <span className="ml-2 text-[11px] text-warn" title="Under ₹100 — probably a test top-up">test?</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted whitespace-nowrap">{fmtDate(i.issuedAt)}</td>
                  <td className="py-2 pr-3">{i.buyer.legalName || i.buyer.name || i.clientId}</td>
                  <td className="py-2 pr-3 text-muted text-xs">{i.buyer.gstin || "Unregistered"}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">₹{money(i.totals.totalP)}</td>
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
