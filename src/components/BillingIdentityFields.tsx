"use client";

import { ReactNode } from "react";
import { Input, Label, Select } from "./ui";
import {
  SELECTABLE_STATES, isValidGstin, isValidPan, isValidPincode,
  panFromGstin, stateFromGstin,
} from "@/lib/gst-states";

/**
 * The billing identity block — the same fields, laid out the same way, whether
 * it is the customer describing themselves or us describing ourselves. Both end
 * up printed on the same tax invoice, so neither should be the one with the
 * worse form.
 */
export interface BillingIdentity {
  legalName: string;
  gstin: string;
  pan: string;
  billingEmail: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  stateCode: string;
  pincode: string;
  shipSame: boolean;
  shipLine1: string;
  shipLine2: string;
  shipCity: string;
  shipState: string;
  shipPincode: string;
}

export const EMPTY_IDENTITY: BillingIdentity = {
  legalName: "", gstin: "", pan: "", billingEmail: "", phone: "",
  line1: "", line2: "", city: "", state: "", stateCode: "", pincode: "",
  shipSame: true, shipLine1: "", shipLine2: "", shipCity: "", shipState: "", shipPincode: "",
};

/* -------------------- Switch -------------------- */
function Switch({
  checked, onChange, label,
}: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2.5 text-sm text-ink"
    >
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? "bg-brand" : "bg-line2"
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-panel shadow-xs transition-all ${
            checked ? "left-[1.125rem]" : "left-0.5"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

/* -------------------- One address -------------------- */
/**
 * `prefix` is "" for the billing address and "ship" for the shipping one, so a
 * single block can drive either half of the same flat object.
 */
function AddressBlock({
  line1, line2, city, state, pincode, onPatch, enforce, stateLocked, stateHint, prefix,
}: {
  line1: string; line2: string; city: string; state: string; pincode: string;
  onPatch: (patch: Record<string, string>) => void;
  enforce: boolean;
  stateLocked?: boolean;
  stateHint?: string;
  prefix: "" | "ship";
}) {
  const key = (k: string) => (prefix ? prefix + k[0].toUpperCase() + k.slice(1) : k);
  const req = (v: string) => enforce && !v.trim();
  // A state saved before this list existed still has to be selectable.
  const known = SELECTABLE_STATES.some((s) => s.name === state);
  const options = !known && state ? [{ code: "", name: state }, ...SELECTABLE_STATES] : SELECTABLE_STATES;

  return (
    <>
      <div className="sm:col-span-2">
        <Label required>Address line 1</Label>
        <Input
          value={line1}
          onChange={(e) => onPatch({ [key("line1")]: e.target.value })}
          placeholder="Flat, building, street"
          invalid={req(line1)}
        />
      </div>
      <div className="sm:col-span-2">
        <Label>Address line 2</Label>
        <Input
          value={line2}
          onChange={(e) => onPatch({ [key("line2")]: e.target.value })}
          placeholder="Area, landmark"
        />
      </div>
      <div>
        <Label required>City</Label>
        <Input
          value={city}
          onChange={(e) => onPatch({ [key("city")]: e.target.value })}
          placeholder="Bengaluru"
          invalid={req(city)}
        />
      </div>
      <div>
        <Label required>State</Label>
        <Select
          value={state}
          disabled={stateLocked}
          onChange={(e) => {
            const picked = SELECTABLE_STATES.find((x) => x.name === e.target.value);
            onPatch(
              prefix
                ? { [key("state")]: e.target.value }
                : { state: e.target.value, stateCode: picked?.code ?? "" },
            );
          }}
          invalid={req(state)}
          hint={stateHint}
        >
          <option value="">Select a state</option>
          {options.map((s) => (
            <option key={s.code || s.name} value={s.name}>{s.name}</option>
          ))}
        </Select>
      </div>
      <div>
        <Label required>PIN code</Label>
        <Input
          value={pincode}
          inputMode="numeric"
          maxLength={6}
          onChange={(e) => onPatch({ [key("pincode")]: e.target.value.replace(/\D/g, "").slice(0, 6) })}
          placeholder="e.g. 560103"
          error={pincode && !isValidPincode(pincode) ? "A PIN code is six digits." : undefined}
          invalid={req(pincode)}
        />
      </div>
      <div>
        <Label>Country</Label>
        <Input value="India" readOnly disabled hint="GST invoices are issued in India only." />
      </div>
    </>
  );
}

/* -------------------- The block -------------------- */
export default function BillingIdentityFields({
  value, onChange, showShipping = false, enforce = false,
  legalNamePlaceholder = "Acme Private Limited",
}: {
  value: BillingIdentity;
  onChange: (next: BillingIdentity) => void;
  /** Customers can have a delivery address that is not their billing address. */
  showShipping?: boolean;
  /**
   * Mark the required fields while they are empty. Always on for our own
   * details, which cannot issue an invoice until they are complete; on for a
   * customer only once they have started filling an address in, because a
   * customer is allowed to leave the whole block blank.
   */
  enforce?: boolean;
  legalNamePlaceholder?: string;
}) {
  const patch = (p: Partial<BillingIdentity>) => onChange({ ...value, ...p });

  // The first two digits of a GSTIN ARE the state code, so once one is entered
  // the state is a fact rather than a choice — fill it in and stop asking.
  function setGstin(raw: string) {
    const gstin = raw.toUpperCase().replace(/\s/g, "").slice(0, 15);
    const st = stateFromGstin(gstin);
    const p: Partial<BillingIdentity> = { gstin };
    if (st) { p.state = st.name; p.stateCode = st.code; }
    // A GSTIN carries its holder's PAN in characters 3-12. Offer it, never
    // overwrite one that was typed by hand.
    if (!value.pan.trim()) {
      const pan = panFromGstin(gstin);
      if (pan) p.pan = pan;
    }
    patch(p);
  }

  const gstinState = stateFromGstin(value.gstin);
  const enforceBilling =
    enforce || [value.line1, value.line2, value.city, value.pincode].some((v) => v.trim());

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label>Legal name</Label>
        <Input
          value={value.legalName}
          onChange={(e) => patch({ legalName: e.target.value })}
          placeholder={legalNamePlaceholder}
        />
      </div>

      <div>
        <Label required={enforce}>GSTIN</Label>
        <Input
          value={value.gstin}
          onChange={(e) => setGstin(e.target.value)}
          placeholder="e.g. 29AABCF1234M1Z7"
          className="font-mono"
          error={
            value.gstin && !isValidGstin(value.gstin)
              ? "15 characters — state code, PAN, entity digit, Z, check digit."
              : undefined
          }
          invalid={enforce && !value.gstin}
          hint={!value.gstin && !enforce ? "Leave blank if you are not registered." : undefined}
        />
      </div>
      <div>
        <Label>PAN</Label>
        <Input
          value={value.pan}
          onChange={(e) => patch({ pan: e.target.value.toUpperCase().replace(/\s/g, "").slice(0, 10) })}
          placeholder="e.g. AABCF1234M"
          className="font-mono"
          error={value.pan && !isValidPan(value.pan) ? "10 characters, e.g. AABCF1234M." : undefined}
        />
      </div>

      <div>
        <Label>Billing email</Label>
        <Input
          type="email"
          value={value.billingEmail}
          onChange={(e) => patch({ billingEmail: e.target.value })}
          placeholder="accounts@example.com"
        />
      </div>
      <div>
        <Label>Phone</Label>
        <Input
          value={value.phone}
          onChange={(e) => patch({ phone: e.target.value })}
          placeholder="Optional · e.g. 98765 43210"
        />
      </div>

      <div className="sm:col-span-2 pt-1">
        <div className="border-t border-line pt-3 text-[13.5px] font-semibold text-ink">Billing address</div>
      </div>

      <AddressBlock
        prefix=""
        line1={value.line1} line2={value.line2} city={value.city}
        state={value.state} pincode={value.pincode}
        onPatch={(p) => patch(p as Partial<BillingIdentity>)}
        enforce={enforceBilling}
        stateLocked={!!gstinState}
        stateHint={gstinState ? "Taken from your GSTIN." : "Derived from your GSTIN when one is provided."}
      />

      {showShipping && (
        <>
          <div className="sm:col-span-2 pt-1">
            <Switch
              checked={value.shipSame}
              onChange={(v) => patch({ shipSame: v })}
              label="Shipping address same as billing"
            />
          </div>
          {!value.shipSame && (
            <>
              <div className="sm:col-span-2">
                <div className="text-[13.5px] font-semibold text-ink">Shipping address</div>
                <div className="text-xs text-muted mt-0.5">
                  Kept on your account. Invoices are still addressed to the billing address
                  above, and the tax is still worked out from its state.
                </div>
              </div>
              <AddressBlock
                prefix="ship"
                line1={value.shipLine1} line2={value.shipLine2} city={value.shipCity}
                state={value.shipState} pincode={value.shipPincode}
                onPatch={(p) => patch(p as Partial<BillingIdentity>)}
                enforce
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
