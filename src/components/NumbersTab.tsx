"use client";

import { formatPhone, digitsOnly } from "@/lib/phone";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone, Download, Search, Link2, Star, Plus } from "lucide-react";
import {
  Button,
  Card,
  Section,
  Input,
  Label,
  Select,
  Spinner,
  EmptyState,
  Loading,
  Kebab,
  ConfirmDialog,
  DataTable,
  TH,
  TD,
  toast,
} from "@/components/ui";
import { api, useFetch } from "@/components/useData";
import type { Campaign } from "@/lib/models";
import { Drawer, SearchField } from "./CampaignsKit";

interface ClientNumber {
  number: string;
  e164: string;
  numberType: string;
  country: string;
  region: string;
  voiceEnabled: boolean;
  smsEnabled: boolean;
  monthlyRentalRate: string;
  addedOn: string;
  isDefault: boolean;
}

interface NumbersResp {
  connected: boolean;
  numbers: ClientNumber[];
  total: number;
  defaultFrom: string;
}

interface PlivoConfig {
  connected: boolean;
  authId: string;
  tokenMasked: string;
  fromNumber: string;
}

/** Plivo's number types, in words people use. */
function typeLabel(t: string): string {
  const v = (t || "").toLowerCase();
  if (v === "tollfree" || v === "toll-free" || v === "toll_free") return "Toll-free";
  if (v === "mobile") return "Mobile";
  if (v === "fixed" || v === "local" || v === "landline") return "Local";
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "—";
}

function TypePill({ t }: { t: string }) {
  const label = typeLabel(t);
  const cls =
    label === "Toll-free"
      ? "bg-brand2/[0.09] text-brand2 border-brand2/25"
      : label === "Mobile"
      ? "bg-info/[0.09] text-info border-info/25"
      : label === "Local"
      ? "bg-accent/[0.09] text-accent border-accent/25"
      : "bg-elev text-muted border-line";
  return (
    <span className={`inline-flex h-[22px] items-center whitespace-nowrap rounded-full border px-2 text-xs font-medium ${cls}`}>
      {label}
    </span>
  );
}

/** Last 10 digits — enough to match "+91 80…" against "0800…" style variants. */
const tail = (n: string) => digitsOnly(n || "").slice(-10);

/**
 * Per-client phone numbers. Each client connects their OWN Plivo account here
 * (Auth ID + Auth Token); their numbers + calls then run through it. Read-only
 * against Plivo — connecting only stores the client's credentials.
 */
export default function NumbersTab() {
  const [config, setConfig] = useState<PlivoConfig | null>(null);
  const [data, setData] = useState<NumbersResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [buyOpen, setBuyOpen] = useState(false);
  // Read-only: which campaigns call from each number ("Used by").
  const { data: campData } = useFetch<{ campaigns: Campaign[] }>("/api/campaigns");

  const loadConfig = useCallback(async () => {
    const c = await api<PlivoConfig>("/api/plivo-config").catch(() => null);
    setConfig(c);
    return c;
  }, []);

  const loadNumbers = useCallback(async () => {
    const n = await api<NumbersResp>("/api/numbers").catch(() => null);
    setData(n);
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    const c = await loadConfig();
    if (c?.connected) await loadNumbers();
    else setData(null);
    setLoading(false);
  }, [loadConfig, loadNumbers]);

  useEffect(() => {
    reload();
  }, [reload]);

  const numbers = data?.numbers ?? [];
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return numbers;
    const nd = needle.replace(/\D+/g, "");
    return numbers.filter(
      (n) =>
        n.e164.toLowerCase().includes(needle) ||
        (nd && digitsOnly(n.e164).includes(nd)) ||
        (n.region || "").toLowerCase().includes(needle),
    );
  }, [numbers, q]);

  // Campaigns with their own from-number use that one; blank ones use the default.
  const usedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of campData?.campaigns ?? []) {
      const key = c.fromNumber ? tail(c.fromNumber) : "__default";
      m.set(key, (m.get(key) ?? 0) + 1);
    }
    return m;
  }, [campData]);
  const usedCount = (n: ClientNumber) => (usedBy.get(tail(n.e164)) ?? 0) + (n.isDefault ? usedBy.get("__default") ?? 0 : 0);

  async function setDefault(e164: string) {
    try {
      await api("/api/plivo-config", { method: "PATCH", body: JSON.stringify({ fromNumber: e164 }) });
      toast("Default caller ID updated.", "ok");
      reload();
    } catch (e: any) {
      toast(e.message || "Could not set default", "danger");
    }
  }

  return (
    <Section>
      <PlivoConnectCard config={config} loading={loading && !config} onChanged={reload} />

      {config?.connected && (
        <div className="relative overflow-hidden rounded-xl border border-line bg-panel shadow-card">
          <div className="flex flex-wrap items-center gap-2.5 px-5 py-4">
            <div className="min-w-0">
              <div className="text-[15px] font-semibold tracking-[-0.015em]">Your numbers</div>
              <div className="mt-0.5 text-[13px] text-muted">
                {numbers.length} on your Plivo account · star one to make it the default caller ID
              </div>
            </div>
            <div className="ml-auto flex w-full flex-wrap items-center gap-2 sm:w-auto">
              {numbers.length > 0 && (
                <SearchField value={q} onChange={setQ} placeholder="Search numbers" className="min-w-0 flex-1 sm:w-[220px] sm:flex-none" />
              )}
              <Button
                variant="ghost"
                leftIcon={<Download size={14} />}
                onClick={() => window.open("/api/numbers/csv", "_blank")}
                disabled={!numbers.length}
              >
                Export CSV
              </Button>
              <Button leftIcon={<Plus size={14} />} onClick={() => setBuyOpen(true)}>
                Buy a number
              </Button>
            </div>
          </div>

          {loading ? (
            <Loading py="py-10" />
          ) : numbers.length === 0 ? (
            <EmptyState
              icon={<Phone size={20} />}
              title="No numbers on this account"
              description="Your connected Plivo account has no rented numbers yet. Buy one here, or rent one in the Plivo console and refresh."
              action={<Button leftIcon={<Plus size={14} />} onClick={() => setBuyOpen(true)}>Buy a number</Button>}
            />
          ) : filtered.length === 0 ? (
            <div className="border-t border-line py-10 text-center text-sm text-muted">No numbers match “{q}”.</div>
          ) : (
            <DataTable>
              <thead>
                <tr>
                  <th className={`${TH} w-[44px] !pr-0`} aria-label="Default caller ID" />
                  <th className={TH}>Number</th>
                  <th className={`${TH} hidden md:table-cell`}>Region</th>
                  <th className={TH}>Type</th>
                  <th className={`${TH} hidden sm:table-cell`}>Used by</th>
                  <th className={`${TH} hidden text-right md:table-cell`}>Monthly</th>
                  <th className={`${TH} w-[52px]`} />
                </tr>
              </thead>
              <tbody>
                {filtered.map((n) => {
                  const used = usedCount(n);
                  return (
                    <tr key={n.number} className="transition-colors hover:bg-ink/[0.022]">
                      <td className={`${TD} !pr-0`}>
                        <button
                          type="button"
                          disabled={n.isDefault}
                          onClick={() => setDefault(n.e164)}
                          title={n.isDefault ? "Default caller ID" : "Make default caller ID"}
                          aria-label={n.isDefault ? "Default caller ID" : `Make ${n.e164} the default caller ID`}
                          className={`grid h-7 w-7 place-items-center rounded-[8px] transition-colors ${
                            n.isDefault ? "cursor-default text-warn2" : "text-muted hover:bg-ink/[0.05] hover:text-warn2"
                          }`}
                        >
                          <Star size={15} className={n.isDefault ? "fill-current" : ""} />
                        </button>
                      </td>
                      <td className={TD}>
                        <div className="whitespace-nowrap font-medium text-ink tabular-nums">{formatPhone(n.e164)}</div>
                        <div className="mt-0.5 text-[12.5px] text-muted">
                          {n.isDefault ? "Default caller ID" : [n.voiceEnabled ? "Voice" : "No voice", n.smsEnabled ? "SMS" : null].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className={`${TD} hidden max-w-[200px] truncate text-ink2 md:table-cell`} title={n.region}>
                        {titleCase(n.region || n.country || "") || "—"}
                      </td>
                      <td className={TD}>
                        <TypePill t={n.numberType} />
                      </td>
                      <td className={`${TD} hidden whitespace-nowrap sm:table-cell ${used ? "text-ink2" : "text-warn"}`}>
                        {campData ? (used ? `${used} campaign${used === 1 ? "" : "s"}` : "Not used") : "—"}
                      </td>
                      <td
                        className={`${TD} hidden whitespace-nowrap text-right text-ink2 tabular-nums md:table-cell`}
                        title="Per month, in your Plivo account's currency"
                      >
                        {n.monthlyRentalRate ? Number(n.monthlyRentalRate).toFixed(2) : "—"}
                      </td>
                      <td className={TD}>
                        {!n.isDefault && (
                          <Kebab items={[{ label: "Make default", icon: <Star size={13} />, onClick: () => setDefault(n.e164) }]} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          )}
        </div>
      )}

      <BuyNumberDrawer open={buyOpen} onClose={() => setBuyOpen(false)} onBought={reload} />
    </Section>
  );
}

interface AvailableNumber {
  number: string;
  e164: string;
  country: string;
  region: string;
  numberType: string;
  monthlyRentalRate: string;
  setupRate: string;
  voiceEnabled: boolean;
  smsEnabled: boolean;
}

const BUY_COUNTRIES = [
  { iso: "IN", label: "India" },
  { iso: "US", label: "United States" },
  { iso: "GB", label: "United Kingdom" },
  { iso: "CA", label: "Canada" },
  { iso: "AU", label: "Australia" },
  { iso: "SG", label: "Singapore" },
  { iso: "AE", label: "UAE" },
];

/** Search Plivo numbers available to buy on the client's account, and rent one. */
function BuyNumberDrawer({ open, onClose, onBought }: { open: boolean; onClose: () => void; onBought: () => void }) {
  const [country, setCountry] = useState("IN");
  const [type, setType] = useState("");
  const [pattern, setPattern] = useState("");
  const [results, setResults] = useState<AvailableNumber[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [buying, setBuying] = useState("");
  // Renting a number charges the client's own Plivo balance, so it gets a real
  // confirmation dialog.
  const [confirmBuy, setConfirmBuy] = useState<AvailableNumber | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function search() {
    setSearching(true);
    setErr(null);
    setResults(null);
    try {
      const qs = new URLSearchParams({ country });
      if (type) qs.set("type", type);
      if (pattern.trim()) qs.set("pattern", pattern.trim());
      const r = await api<{ connected: boolean; numbers: AvailableNumber[] }>(`/api/numbers/search?${qs.toString()}`);
      if (!r.connected) {
        setErr("Connect your Plivo account first.");
      } else {
        setResults(r.numbers);
      }
    } catch (e: any) {
      setErr(e.message || "Search failed");
    }
    setSearching(false);
  }

  async function buy(n: AvailableNumber) {
    setBuying(n.number);
    try {
      await api("/api/numbers/buy", { method: "POST", body: JSON.stringify({ number: n.number }) });
      toast(`Bought ${n.e164}.`, "ok");
      setResults((cur) => (cur ? cur.filter((x) => x.number !== n.number) : cur));
      onBought();
    } catch (e: any) {
      toast(e.message || "Purchase failed", "danger");
    }
    setBuying("");
    setConfirmBuy(null);
  }

  return (
    <>
    <Drawer
      open={open}
      onClose={onClose}
      title="Buy a number"
      description="Rented on your own Plivo account."
      footer={
        <>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Country</Label>
            <Select value={country} onChange={(e) => setCountry(e.target.value)}>
              {BUY_COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label>Type</Label>
            <Select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="">Any</option>
              <option value="fixed">Local / landline</option>
              <option value="mobile">Mobile</option>
              <option value="tollfree">Toll-free</option>
            </Select>
          </div>
        </div>
        <div>
          <Label hint="optional">Starts with</Label>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") search();
            }}
            placeholder="e.g. 80"
          />
        </div>
        <Button variant="ghost" onClick={search} loading={searching} leftIcon={<Search size={14} />}>
          Search
        </Button>

        {country === "IN" && (
          <div className="rounded-[10px] border border-warn/25 bg-warn/[0.07] px-3 py-2 text-xs text-warn">
            India numbers need completed KYC / address verification on your Plivo account. If a purchase is blocked,
            finish verification in the Plivo console, then try again.
          </div>
        )}

        {err && <div className="text-sm text-danger">{err}</div>}
      </div>

      {searching && <Loading py="py-8" />}

      {results &&
        (results.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted">No available numbers for this search.</div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-xl border border-line">
            <DataTable>
              <thead>
                <tr>
                  <th className={TH}>Number</th>
                  <th className={TH}>Monthly</th>
                  <th className={`${TH} w-[90px]`} />
                </tr>
              </thead>
              <tbody>
                {results.map((n) => (
                  <tr key={n.number} className="transition-colors hover:bg-ink/[0.022]">
                    <td className={TD}>
                      <div className="whitespace-nowrap font-medium tabular-nums">{n.e164}</div>
                      <div className="mt-0.5 truncate text-[12px] text-muted">
                        {[typeLabel(n.numberType), titleCase(n.region || n.country || "")].filter(Boolean).join(" · ")}
                        {n.setupRate && n.setupRate !== "0" && n.setupRate !== "0.00000" ? ` · setup ${n.setupRate}` : ""}
                      </div>
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>{n.monthlyRentalRate || "—"}</td>
                    <td className={`${TD} text-right`}>
                      <Button size="sm" variant="ghost" loading={buying === n.number} onClick={() => setConfirmBuy(n)}>
                        Rent
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        ))}
    </Drawer>

      <ConfirmDialog
        open={!!confirmBuy}
        title="Rent this number"
        confirmLabel="Rent it"
        tone="primary"
        busy={!!buying}
        body={
          <>
            Rent <span className="font-mono text-ink">{confirmBuy?.e164}</span> for{" "}
            <span className="font-medium text-ink">{confirmBuy?.monthlyRentalRate || "?"}</span> per month?
            This charges <span className="font-medium text-ink">your own Plivo balance</span>, not your wallet
            here, and it recurs monthly until you release the number in the Plivo console.
          </>
        }
        onConfirm={() => confirmBuy && buy(confirmBuy)}
        onClose={() => setConfirmBuy(null)}
      />
    </>
  );
}

/** Connect / disconnect the client's own Plivo account. */
function PlivoConnectCard({
  config,
  loading,
  onChanged,
}: {
  config: PlivoConfig | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const [authId, setAuthId] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  async function connect() {
    setErr(null);
    if (!authId.trim() || !authToken.trim()) {
      setErr("Enter both your Plivo Auth ID and Auth Token.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/plivo-config", {
        method: "POST",
        body: JSON.stringify({ authId: authId.trim(), authToken: authToken.trim() }),
      });
      toast("Plivo account connected.", "ok");
      setAuthId("");
      setAuthToken("");
      onChanged();
    } catch (e: any) {
      setErr(e.message || "Could not connect");
    }
    setBusy(false);
  }

  async function disconnect() {
    setBusy(true);
    try {
      await api("/api/plivo-config", { method: "DELETE" });
      toast("Plivo account disconnected.", "info");
      setConfirmDisconnect(false);
      onChanged();
    } catch (e: any) {
      toast(e.message || "Could not disconnect", "danger");
    }
    setBusy(false);
  }

  if (loading) {
    return (
      <Card>
        <div className="flex justify-center py-4 text-muted">
          <Spinner size={18} />
        </div>
      </Card>
    );
  }

  if (config?.connected) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-5 py-4 shadow-card">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] border border-ok/25 bg-ok/10 text-ok">
          <Link2 size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold tracking-[-0.015em]">Plivo account connected</div>
          <div className="mt-0.5 text-[13px] text-muted">
            {/* Only the tail: enough to tell accounts apart, not enough to copy. */}
            Auth ID ending <span className="font-mono tabular-nums">••••{config.authId.slice(-4)}</span>
            {" · "}
            Default caller ID{" "}
            <span className="text-ink2 tabular-nums">
              {config.fromNumber ? formatPhone(config.fromNumber) : "none — each campaign uses its own"}
            </span>
          </div>
        </div>
        <span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-ok/25 bg-ok/[0.09] px-2 text-xs font-medium text-ok">
          <span className="h-1.5 w-1.5 rounded-full bg-ok2" />
          Connected
        </span>
        <Button variant="subtle" size="sm" onClick={() => setConfirmDisconnect(true)}>
          Disconnect
        </Button>
        <ConfirmDialog
          open={confirmDisconnect}
          title="Disconnect your Plivo account"
          confirmLabel="Disconnect"
          busy={busy}
          body={
            <>
              Your numbers and outbound calls will fall back to the shared account. Nothing already dialled is
              affected, and you can reconnect at any time with the same credentials.
            </>
          }
          onConfirm={disconnect}
          onClose={() => setConfirmDisconnect(false)}
        />
      </div>
    );
  }

  return (
    <Card>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] border border-line bg-elev text-muted">
          <Link2 size={18} />
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-[-0.015em]">Connect your Plivo account</div>
          <div className="mt-0.5 text-[13px] text-muted">
            Enter your Plivo Auth ID and Auth Token (from your Plivo console home page). Your numbers and calls will
            run through your own account.
          </div>
        </div>
      </div>
      <div className="mt-4 max-w-lg space-y-3.5">
        {err && <div className="text-sm text-danger">{err}</div>}
        <div>
          <Label required>Plivo Auth ID</Label>
          <Input value={authId} onChange={(e) => setAuthId(e.target.value)} placeholder="MAXXXXXXXXXXXXXXXXXX" />
        </div>
        <div>
          <Label required>Plivo Auth Token</Label>
          <Input
            type="password"
            value={authToken}
            onChange={(e) => setAuthToken(e.target.value)}
            placeholder="Your Plivo Auth Token"
          />
        </div>
        <Button leftIcon={<Link2 size={14} />} onClick={connect} loading={busy} disabled={!authId || !authToken}>
          Connect &amp; verify
        </Button>
        <p className="text-xs text-muted">
          We verify the credentials with Plivo before saving. Until you connect, your calls use the shared account as before.
        </p>
      </div>
    </Card>
  );
}

/** "Bangalore, INDIA" → "Bangalore, India" (Plivo returns countries in capitals). */
function titleCase(s: string): string {
  return s.replace(/([A-Z])([A-Z]+)/g, (_, a: string, b: string) => a + b.toLowerCase());
}
