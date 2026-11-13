"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Download, RefreshCw, Save, Receipt, Pencil, AlertCircle } from "lucide-react";
import { Button, EmptyState, Loading, Modal, DataTable, TH, TD, IconButton, toast } from "../ui";
import { Panel, IconAvatar, Callout } from "../AdminTabKit";
import { api } from "../useData";
import { formatDate } from "./config";
import BillingIdentityFields, { BillingIdentity, EMPTY_IDENTITY } from "../BillingIdentityFields";

export interface InvoiceApi {
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
export default function InvoicesCard({ onLoaded }: { onLoaded?: (invoices: InvoiceApi[]) => void } = {}) {
  const [invoices, setInvoices] = useState<InvoiceApi[] | null>(null);
  const [details, setDetails] = useState<BillingDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  // Keep the latest callback without making `load` depend on it.
  const onLoadedRef = useRef(onLoaded);
  onLoadedRef.current = onLoaded;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [inv, det] = await Promise.all([
        api<{ invoices: InvoiceApi[] }>("/api/wallet/invoices"),
        api<{ details: BillingDetails }>("/api/wallet/billing-details"),
      ]);
      setInvoices(inv.invoices);
      setDetails(det.details);
      onLoadedRef.current?.(inv.invoices);
    } catch (e: any) {
      toast(e?.message || "Could not load invoices", "danger");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const hasDetails = !!(details && (details.gstin || details.address));

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <Panel
          title="Tax invoices"
          sub="A GST invoice is issued automatically for every top-up."
          right={
            <IconButton
              icon={<RefreshCw size={14} className={loading ? "animate-spin" : ""} />}
              title="Refresh"
              onClick={load}
            />
          }
        >
          {invoices === null ? (
            <Loading py="py-8" />
          ) : invoices.length === 0 ? (
            <EmptyState
              icon={<FileText size={20} />}
              title="No invoices yet"
              description="One will appear here as soon as your first top-up is paid."
            />
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th className={TH}>Invoice</th>
                  <th className={TH}>Date</th>
                  <th className={`${TH} hidden text-right sm:table-cell`}>Taxable</th>
                  <th className={`${TH} hidden text-right sm:table-cell`}>GST</th>
                  <th className={`${TH} text-right`}>Total</th>
                  <th className={TH}></th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((i) => {
                  const tax = i.totals.cgstP + i.totals.sgstP + i.totals.igstP;
                  return (
                    <tr key={i.id} className="transition-colors hover:bg-elev">
                      <td className={TD}>
                        <div className="flex items-center gap-3">
                          <IconAvatar icon={<Receipt size={15} />} tone="accent" />
                          <span className="font-semibold text-ink tabular-nums">{i.invoiceNo}</span>
                        </div>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-muted`}>{formatDate(i.issuedAt)}</td>
                      <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>₹{money(i.totals.taxableP)}</td>
                      <td className={`${TD} hidden whitespace-nowrap text-right tabular-nums sm:table-cell`}>
                        ₹{money(tax)}
                        <span className="ml-1 text-xs text-muted">{i.totals.interState ? "IGST" : "CGST+SGST"}</span>
                      </td>
                      <td className={`${TD} whitespace-nowrap text-right font-semibold tabular-nums`}>₹{money(i.totals.totalP)}</td>
                      <td className={`${TD} text-right`}>
                        <a
                          href={`/api/wallet/invoices/${i.id}/pdf`}
                          className="inline-flex h-[30px] items-center gap-1.5 rounded-[9px] border border-line bg-panel px-2.5 text-[12.5px] font-semibold text-ink shadow-xs transition-colors hover:bg-elev"
                        >
                          <Download size={13} /> PDF
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </Panel>

        <Panel
          title="Billing details"
          sub="Printed on your tax invoices."
          right={
            <Button size="sm" variant="ghost" leftIcon={<Pencil size={13} />} onClick={() => setEditing(true)}>
              Edit
            </Button>
          }
          bordered
        >
          <div className="px-5 py-4">
            {details !== null && !hasDetails && (
              <div className="mb-3">
                <Callout tone="warn" icon={<AlertCircle size={15} />}>
                  <b className="font-semibold">Add your GST number and address</b>
                  <div className="mt-0.5 text-[12.5px] opacity-90">
                    Without them your invoices are issued to an unregistered buyer, and you cannot claim input
                    credit. Invoices already issued keep the details they were raised with.
                  </div>
                </Callout>
              </div>
            )}
            {details === null ? (
              <Loading py="py-6" />
            ) : (
              <dl className="m-0 grid gap-y-2.5 text-[13.5px]">
                <DetailRow k="Legal name" v={details.legalName} />
                <DetailRow k="GSTIN" v={details.gstin} mono />
                <DetailRow k="Billing email" v={details.billingEmail} />
                <DetailRow
                  k="Address"
                  v={
                    [details.line1, details.line2, details.city, details.state, details.pincode]
                      .filter((x) => x && String(x).trim())
                      .join(", ") || details.address
                  }
                />
              </dl>
            )}
          </div>
        </Panel>
      </div>

      <BillingDetailsModal
        open={editing}
        details={details}
        onClose={() => setEditing(false)}
        onSaved={(d) => { setDetails(d); setEditing(false); }}
      />
    </>
  );
}

function DetailRow({ k, v, mono }: { k: string; v?: string; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className={`m-0 break-words text-ink ${mono ? "font-mono text-[13px]" : ""}`}>
        {v && v.trim() ? v : <span className="text-muted">Not added</span>}
      </dd>
    </div>
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
        <p className="m-0 text-[13px] text-muted">
          These appear on your tax invoices. Changing them affects future invoices only — the ones already
          issued keep what they were raised with. All of it is optional; leaving it blank simply means your
          invoices are issued to an unregistered buyer.
        </p>

        <BillingIdentityFields value={f} onChange={setF} showShipping />

        <p className="m-0 text-[12.5px] text-muted">
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
