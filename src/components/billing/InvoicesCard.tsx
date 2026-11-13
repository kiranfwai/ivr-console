"use client";

import { useCallback, useEffect, useState } from "react";
import { FileText, Download, Building2, RefreshCw, Save } from "lucide-react";
import { Card, Button, Badge, EmptyState, Spinner, Modal, toast } from "../ui";
import { api } from "../useData";
import { formatDate } from "./config";
import BillingIdentityFields, { BillingIdentity, EMPTY_IDENTITY } from "../BillingIdentityFields";

interface InvoiceApi {
  id: number;
  invoiceNo: string;
  orderId: string;
  issuedAt: string;
  creditP: number;
  totals: {
    taxableP: number; cgstP: number; sgstP: number; igstP: number; totalP: number;
    gstRate: number; taxMode: "inclusive" | "exclusive"; interState: boolean;
  };
  buyer: { legalName: string; gstin: string };
}

interface BillingDetails {
  legalName: string; gstin: string; address: string; state: string; stateCode: string;
  pan?: string; line1?: string; line2?: string; city?: string; pincode?: string;
  billingEmail?: string; phone?: string;
  shipping?: { same: boolean; line1: string; line2: string; city: string; state: string; pincode: string };
}

/** API shape -> form shape. Everything the API may omit becomes "". */
function toIdentity(d: BillingDetails | null): BillingIdentity {
  if (!d) return { ...EMPTY_IDENTITY };
  return {
    legalName: d.legalName || "",
    gstin: d.gstin || "",
    pan: d.pan || "",
    billingEmail: d.billingEmail || "",
    phone: d.phone || "",
    line1: d.line1 || "",
    line2: d.line2 || "",
    city: d.city || "",
    state: d.state || "",
    stateCode: d.stateCode || "",
    pincode: d.pincode || "",
    shipSame: d.shipping ? d.shipping.same : true,
    shipLine1: d.shipping?.line1 || "",
    shipLine2: d.shipping?.line2 || "",
    shipCity: d.shipping?.city || "",
    shipState: d.shipping?.state || "",
    shipPincode: d.shipping?.pincode || "",
  };
}

/** Paise -> "1,23,456.78" (Indian grouping). */
function money(p: number): string {
  const s = (Math.abs(p) / 100).toFixed(2);
  const [w, f] = s.split(".");
  const last3 = w.slice(-3);
  const rest = w.slice(0, -3);
  return (rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3) + "." + f;
}

/**
 * The customer's own tax invoices — one per top-up — plus the billing identity
 * that gets printed on them.
 *
 * Editing the details never rewrites an invoice already issued: each one keeps
 * the name, GSTIN and address as they were on the day it was raised, which is
 * what a tax document is supposed to do.
 */
export default function InvoicesCard() {
  const [invoices, setInvoices] = useState<InvoiceApi[] | null>(null);
  const [details, setDetails] = useState<BillingDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, det] = await Promise.all([
        api<{ invoices: InvoiceApi[] }>("/api/wallet/invoices"),
        api<{ details: BillingDetails }>("/api/wallet/billing-details"),
      ]);
      setInvoices(inv.invoices);
      setDetails(det.details);
    } catch (e: any) {
      toast(e?.message || "Could not load invoices", "danger");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasDetails = !!(details && (details.gstin || details.address));

  return (
    <>
      <Card
        title={<span className="flex items-center gap-2"><FileText size={16} className="text-accent" /> Tax Invoices</span>}
        description="A GST invoice is issued automatically for every top-up"
        action={
          <div className="flex items-center gap-1.5">
            <button
              onClick={load}
              className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-ink px-2 py-1 rounded-md hover:bg-elev"
              title="Refresh"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <Button size="sm" variant="ghost" leftIcon={<Building2 size={13} />} onClick={() => setEditing(true)}>
              Billing details
            </Button>
          </div>
        }
      >
        {!hasDetails && (
          <div className="mb-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-sm">
            <b className="font-medium">Add your GST number and address</b>
            <div className="text-xs text-muted mt-0.5">
              Without them your invoices are issued to an unregistered buyer, and you cannot claim input credit.
              Invoices already issued keep the details they were raised with.
            </div>
          </div>
        )}

        {invoices === null ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : invoices.length === 0 ? (
          <EmptyState
            icon={<FileText size={20} />}
            title="No invoices yet"
            description="One will appear here as soon as your first top-up is paid."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted border-b border-line">
                  <th className="py-2 pr-3 font-medium">Invoice</th>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium text-right">Taxable</th>
                  <th className="py-2 pr-3 font-medium text-right">GST</th>
                  <th className="py-2 pr-3 font-medium text-right">Total</th>
                  <th className="py-2 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const tax = i.totals.cgstP + i.totals.sgstP + i.totals.igstP;
                  return (
                    <tr key={i.id} className="border-b border-line/60 hover:bg-elev/50">
                      <td className="py-2 pr-3 tabular-nums">{i.invoiceNo}</td>
                      <td className="py-2 pr-3 text-ink2">{formatDate(i.issuedAt)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">₹{money(i.totals.taxableP)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {money(tax)}
                        <span className="text-muted text-xs ml-1">
                          {i.totals.interState ? "IGST" : "CGST+SGST"}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums font-medium">₹{money(i.totals.totalP)}</td>
                      <td className="py-2 pr-3 text-right">
                        <a
                          href={`/api/wallet/invoices/${i.id}/pdf`}
                          className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-ink px-2 py-1 rounded-md hover:bg-elev"
                        >
                          <Download size={13} /> PDF
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <BillingDetailsModal
        open={editing}
        details={details}
        onClose={() => setEditing(false)}
        onSaved={(d) => { setDetails(d); setEditing(false); }}
      />
    </>
  );
}

function BillingDetailsModal({
  open, details, onClose, onSaved,
}: {
  open: boolean;
  details: BillingDetails | null;
  onClose: () => void;
  onSaved: (d: BillingDetails) => void;
}) {
  const [f, setF] = useState<BillingIdentity>(EMPTY_IDENTITY);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setF(toIdentity(details));
  }, [open, details]);

  async function save() {
    setSaving(true);
    try {
      const r = await api<{ details: BillingDetails }>("/api/wallet/billing-details", {
        method: "PUT",
        body: JSON.stringify(f),
      });
      toast("Billing details saved.", "ok");
      onSaved(r.details);
    } catch (e: any) {
      toast(e?.message || "Could not save", "danger");
    }
    setSaving(false);
  }

  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Billing details" size="lg">
      <div className="grid gap-3">
        <p className="text-xs text-muted">
          These appear on your tax invoices. Changing them affects future invoices only — the ones already
          issued keep what they were raised with. All of it is optional; leaving it blank simply means your
          invoices are issued to an unregistered buyer.
        </p>

        <BillingIdentityFields value={f} onChange={setF} showShipping />

        <p className="text-xs text-muted">
          The state on your billing address decides whether you are charged CGST + SGST or IGST.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving} leftIcon={<Save size={14} />}>Save billing details</Button>
        </div>
      </div>
    </Modal>
  );
}
