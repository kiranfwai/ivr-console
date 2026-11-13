"use client";

import { useCallback, useEffect, useState } from "react";
import { Save, ShieldCheck, Trash2, Info, Wallet, Eye, EyeOff } from "lucide-react";
import { Section, Button, Input, Label, Select, Badge, Loading, toast } from "../ui";
import { api } from "../useData";
import { currencySymbol } from "./money";
import type { Pricing } from "./shared";
import { Panel, Callout } from "../AdminTabKit";

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
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start">
        <ConnectedRateCard />
        <CashfreeCard />
      </div>
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
    <Panel title="Call rate" sub="Applied to every client unless they have their own rate." bordered>
      <div className="px-5 py-5">
        {loading ? (
          <Loading py="py-6" />
        ) : (
          <>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div>
                <Label>Connected-call rate</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-sm text-muted">{sym}</span>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder="0.81"
                    className="pl-7 tabular-nums"
                  />
                </div>
                <div className="mt-1 text-xs text-muted">Per answered call. Busy, no-answer and failed calls are free.</div>
              </div>
              <div>
                <Label>Currency</Label>
                <Select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="mt-4">
              <Callout tone="info" icon={<Info size={15} />}>
                Every connected call (answered or press 1) debits the client’s wallet by this rate. A per-client rate,
                set from Financials, replaces it for that client. Clients top up through Cashfree from their own login.
              </Callout>
            </div>
            <Button className="mt-[18px]" onClick={save} loading={busy} leftIcon={<Save size={14} />}>
              Save changes
            </Button>
          </>
        )}
      </div>
    </Panel>
  );
}

function CashfreeCard() {
  const [cfg, setCfg] = useState<CashfreeConfig | null>(null);
  const [env, setEnv] = useState<"sandbox" | "production">("sandbox");
  const [appId, setAppId] = useState("");
  // Hidden by default like the secret; shown only on purpose (screen shares, demos).
  const [showAppId, setShowAppId] = useState(false);
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
    <Panel title="Payments" bordered>
      <div className="grid gap-3.5 px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 flex-none place-items-center rounded-[11px] bg-ok/10 text-ok">
            <Wallet size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <b className="font-semibold text-ink">Cashfree</b>
            <div className="text-[12.5px] text-muted">One shared merchant account for client top-ups</div>
          </div>
          {cfg &&
            (cfg.configured ? (
              <Badge tone="ok" dot>
                {cfg.env === "production" ? "Live" : "Sandbox"} · connected
              </Badge>
            ) : (
              <Badge tone="muted">Not configured</Badge>
            ))}
        </div>

        {loading ? (
          <Loading py="py-6" />
        ) : (
          <>
            <div>
              <Label>Environment</Label>
              <Select value={env} onChange={(e) => setEnv(e.target.value as "sandbox" | "production")}>
                <option value="sandbox">Sandbox (test)</option>
                <option value="production">Production (live)</option>
              </Select>
            </div>
            <div>
              <Label>App ID (x-client-id)</Label>
              <div className="relative">
                <Input
                  type={showAppId ? "text" : "password"}
                  autoComplete="off"
                  value={appId}
                  onChange={(e) => setAppId(e.target.value)}
                  placeholder="CF..."
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowAppId((v) => !v)}
                  aria-label={showAppId ? "Hide App ID" : "Show App ID"}
                  title={showAppId ? "Hide" : "Show"}
                  className="absolute right-1.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-muted hover:bg-ink/[0.05] hover:text-ink"
                >
                  {showAppId ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
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
              <ShieldCheck size={13} className="text-ok" /> Secret is stored server-side and never shown again.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={save} loading={busy} leftIcon={<Save size={14} />}>
                Save payment settings
              </Button>
              {cfg?.configured && !confirmClear && (
                <Button variant="danger" onClick={() => setConfirmClear(true)} leftIcon={<Trash2 size={14} />}>
                  Clear credentials
                </Button>
              )}
            </div>
            {confirmClear && (
              <Callout tone="danger">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-auto">Remove the saved App ID and secret?</span>
                  <Button size="sm" variant="danger" onClick={clear} loading={clearing}>
                    Yes, clear
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmClear(false)} disabled={clearing}>
                    Cancel
                  </Button>
                </div>
              </Callout>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}
