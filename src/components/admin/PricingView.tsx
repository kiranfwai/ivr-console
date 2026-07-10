"use client";

import { useCallback, useEffect, useState } from "react";
import { Coins, Save, CreditCard, ShieldCheck, Trash2 } from "lucide-react";
import { Card, Section, Button, Input, Label, Badge, Spinner, toast } from "../ui";
import { api } from "../useData";
import { currencySymbol } from "./money";
import type { Pricing } from "./shared";

const CURRENCIES = ["INR", "USD"];

interface CashfreeConfig {
  env: "sandbox" | "production";
  appId: string;
  secretSet: boolean;
  configured: boolean;
}

/** "Per-call cost" admin tab: the flat per-connected-call rate that debits every
 *  client's wallet, plus the Cashfree payment credentials clients top up through. */
export default function PricingView() {
  return (
    <Section>
      <ConnectedRateCard />
      <CashfreeCard />
      <Card title="How billing works" description="The live wallet model">
        <div className="flex items-start gap-3 text-sm text-ink2">
          <Coins size={18} className="text-muted mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p>
              Every <span className="text-ink font-medium">connected</span> call (answered or
              press-1) debits the client's wallet by the rate above. Busy / no-answer / failed
              calls are free.
            </p>
            <p className="text-muted text-xs">
              A per-client override (set from the Financials tab) replaces this rate for that
              client. Clients top up their wallet via Cashfree from their own login.
            </p>
          </div>
        </div>
      </Card>
    </Section>
  );
}

function ConnectedRateCard() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [rate, setRate] = useState("");
  const [currency, setCurrency] = useState("INR");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ pricing: Pricing }>("/api/admin/pricing");
      setPricing(r.pricing);
      setRate(String(r.pricing.perConnectedCall));
      setCurrency(r.pricing.currency);
    } catch (e: any) {
      toast(String(e?.message || e), "danger");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      await api("/api/admin/pricing", {
        method: "PUT",
        body: JSON.stringify({
          // Preserve the legacy fields; only change what this card controls.
          perCall: pricing?.perCall ?? 0,
          perMinute: pricing?.perMinute ?? 0,
          perConnectedCall: Number(rate) || 0,
          currency,
        }),
      });
      toast("Per-connected-call rate saved", "ok");
      load();
    } catch (e: any) {
      toast(String(e?.message || e), "danger");
    }
    setBusy(false);
  }

  const sym = currencySymbol(currency);

  return (
    <Card
      title="Per-connected-call rate"
      description="Charged to a client's wallet for each answered call (default ₹0.81)"
    >
      {loading ? (
        <div className="flex items-center gap-2 text-muted text-sm py-4">
          <Spinner size={16} /> Loading…
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
          <div>
            <Label>Per connected call ({sym})</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              placeholder="0.81"
            />
          </div>
          <div>
            <Label>Currency</Label>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className="w-full bg-bg/60 border border-line hover:border-line2 focus:border-brand/60 rounded-lg px-3 py-2 text-sm outline-none"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={save} loading={busy} leftIcon={<Save size={14} />}>
            Save rate
          </Button>
        </div>
      )}
    </Card>
  );
}

function CashfreeCard() {
  const [cfg, setCfg] = useState<CashfreeConfig | null>(null);
  const [env, setEnv] = useState<"sandbox" | "production">("sandbox");
  const [appId, setAppId] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<{ config: CashfreeConfig }>("/api/admin/cashfree");
      setCfg(r.config);
      setEnv(r.config.env);
      setAppId(r.config.appId);
      setSecret("");
    } catch (e: any) {
      toast(String(e?.message || e), "danger");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function save() {
    setBusy(true);
    try {
      const r = await api<{ config: CashfreeConfig }>("/api/admin/cashfree", {
        method: "PUT",
        // Blank secret keeps the stored one.
        body: JSON.stringify({ env, appId, ...(secret ? { secretKey: secret } : {}) }),
      });
      setCfg(r.config);
      setSecret("");
      toast("Cashfree settings saved", "ok");
    } catch (e: any) {
      toast(String(e?.message || e), "danger");
    }
    setBusy(false);
  }

  async function clear() {
    setClearing(true);
    try {
      const r = await api<{ config: CashfreeConfig }>("/api/admin/cashfree", { method: "DELETE" });
      setCfg(r.config);
      setEnv(r.config.env);
      setAppId("");
      setSecret("");
      setConfirmClear(false);
      toast("Cashfree credentials cleared — you can add new ones now.", "ok");
    } catch (e: any) {
      toast(String(e?.message || e), "danger");
    }
    setClearing(false);
  }

  return (
    <Card
      title="Cashfree payment gateway"
      description="Credentials clients use to top up their wallet (one shared merchant account)"
      action={
        cfg ? (
          cfg.configured ? (
            <Badge tone="ok" dot>
              {cfg.env === "production" ? "Live" : "Sandbox"} · connected
            </Badge>
          ) : (
            <Badge tone="muted">Not configured</Badge>
          )
        ) : undefined
      }
    >
      {loading ? (
        <div className="flex items-center gap-2 text-muted text-sm py-4">
          <Spinner size={16} /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Environment</Label>
              <select
                value={env}
                onChange={(e) => setEnv(e.target.value as "sandbox" | "production")}
                className="w-full bg-bg/60 border border-line hover:border-line2 focus:border-brand/60 rounded-lg px-3 py-2 text-sm outline-none"
              >
                <option value="sandbox">Sandbox (test)</option>
                <option value="production">Production (live)</option>
              </select>
            </div>
            <div>
              <Label>App ID (x-client-id)</Label>
              <Input value={appId} onChange={(e) => setAppId(e.target.value)} placeholder="CF..." />
            </div>
          </div>
          <div>
            <Label hint={cfg?.secretSet ? "leave blank to keep existing" : "required"}>
              Secret key (x-client-secret)
            </Label>
            <Input
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={cfg?.secretSet ? "•••••••• (stored)" : "cfsk_..."}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <ShieldCheck size={13} /> Secret is stored server-side and never shown again.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={save} loading={busy} leftIcon={<CreditCard size={14} />}>
              Save Cashfree settings
            </Button>
            {cfg?.configured && !confirmClear && (
              <Button variant="danger" onClick={() => setConfirmClear(true)} leftIcon={<Trash2 size={14} />}>
                Clear credentials
              </Button>
            )}
            {confirmClear && (
              <span className="inline-flex items-center gap-2 text-sm">
                <span className="text-ink2">Remove the saved App ID &amp; secret?</span>
                <Button variant="danger" onClick={clear} loading={clearing}>
                  Yes, clear
                </Button>
                <Button variant="subtle" onClick={() => setConfirmClear(false)} disabled={clearing}>
                  Cancel
                </Button>
              </span>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
