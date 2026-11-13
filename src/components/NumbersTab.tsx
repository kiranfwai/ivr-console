"use client";

import { formatPhone } from "@/lib/phone";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Phone, Download, Search, Link2, Link2Off, CheckCircle2, Star, ShoppingCart } from "lucide-react";
import {
  Button,
  Card,
  Section,
  Input,
  Label,
  Select,
  Modal,
  Badge,
  Spinner,
  EmptyState,
  Kebab,
  ConfirmDialog,
  toast,
} from "@/components/ui";
import { api } from "@/components/useData";

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
    return numbers.filter(
      (n) => n.e164.toLowerCase().includes(needle) || (n.region || "").toLowerCase().includes(needle),
    );
  }, [numbers, q]);

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
        <Card
          title={
            <span className="flex items-center gap-2">
              <Phone size={16} className="text-accent" /> Your numbers
            </span>
          }
          description="Caller-ID numbers on your connected Plivo account. Star one to make it your default caller ID."
          action={
            <div className="flex items-center gap-2">
              <Badge tone="accent">{numbers.length} total</Badge>
              <Button size="sm" leftIcon={<ShoppingCart size={13} />} onClick={() => setBuyOpen(true)}>
                Buy number
              </Button>
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<Download size={13} />}
                onClick={() => window.open("/api/numbers/csv", "_blank")}
                disabled={!numbers.length}
              >
                Export CSV
              </Button>
            </div>
          }
        >
          {numbers.length > 0 && (
            <div className="relative mb-3 max-w-xs">
              <Search size={14} className="absolute left-3 top-2.5 text-muted pointer-events-none" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search your numbers…"
                className="w-full bg-bg/60 border border-line hover:border-line2 focus:border-accent/60 rounded-lg pl-9 pr-3 py-2 text-sm outline-none"
              />
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-10 text-muted"><Spinner size={18} /></div>
          ) : numbers.length === 0 ? (
            <EmptyState
              icon={<Phone size={20} />}
              title="No numbers on this account"
              description="Your connected Plivo account has no rented numbers. Rent one in the Plivo console, then refresh."
            />
          ) : filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-muted">No numbers match “{q}”.</div>
          ) : (
            <div className="overflow-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                    <th className="font-medium py-2 px-1">Number</th>
                    <th className="font-medium px-1">Type</th>
                    <th className="font-medium px-1">Region</th>
                    <th className="font-medium px-1 text-center">Voice / SMS</th>
                    <th className="font-medium px-1 text-right">Rental</th>
                    <th className="font-medium px-1 text-right">Caller ID</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((n) => (
                    <tr key={n.number} className="border-t border-line hover:bg-elev/40">
                      <td className="py-2 px-1 font-mono tabular-nums whitespace-nowrap">
                        {formatPhone(n.e164)}
                        {n.isDefault && <Badge tone="accent" className="ml-2">Default</Badge>}
                      </td>
                      <td className="px-1 text-ink2 capitalize">{n.numberType || "—"}</td>
                      <td className="px-1 text-ink2 truncate max-w-[160px]" title={n.region}>{titleCase(n.region || n.country || "") || "—"}</td>
                      <td className="px-1 text-center">
                        <span className="inline-flex gap-1">
                          <Badge tone={n.voiceEnabled ? "ok" : "muted"}>{n.voiceEnabled ? "Voice" : "No voice"}</Badge>
                          <Badge tone={n.smsEnabled ? "ok" : "muted"}>{n.smsEnabled ? "SMS" : "No SMS"}</Badge>
                        </span>
                      </td>
                      <td className="px-1 text-right text-xs text-muted tabular-nums" title="Per month, in your Plivo account's currency">
                        {n.monthlyRentalRate ? `${Number(n.monthlyRentalRate).toFixed(2)} / mo` : "—"}
                      </td>
                      <td className="px-1 text-right">
                        {n.isDefault ? (
                          <span className="inline-flex items-center gap-1 text-xs text-accent">
                            <Star size={12} className="fill-current" /> Default
                          </span>
                        ) : (
                          <button
                            onClick={() => setDefault(n.e164)}
                            className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-accent px-2 py-1 rounded-md hover:bg-elev"
                            title="Make this the default caller ID"
                          >
                            <Star size={12} /> Set default
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <BuyNumberModal open={buyOpen} onClose={() => setBuyOpen(false)} onBought={reload} />
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
  { iso: "IN", label: "India (IN)" },
  { iso: "US", label: "United States (US)" },
  { iso: "GB", label: "United Kingdom (GB)" },
  { iso: "CA", label: "Canada (CA)" },
  { iso: "AU", label: "Australia (AU)" },
  { iso: "SG", label: "Singapore (SG)" },
  { iso: "AE", label: "UAE (AE)" },
];

/** Search Plivo numbers available to buy on the client's account, and rent one. */
function BuyNumberModal({ open, onClose, onBought }: { open: boolean; onClose: () => void; onBought: () => void }) {
  const [country, setCountry] = useState("IN");
  const [type, setType] = useState("");
  const [pattern, setPattern] = useState("");
  const [results, setResults] = useState<AvailableNumber[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [buying, setBuying] = useState("");
  // Renting a number charges the client's own Plivo balance, so it gets a real
  // dialog rather than the browser's grey popup.
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
    <Modal open={open} onClose={onClose} title="Buy a number" size="md">
      <div className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <div>
            <Label>Country</Label>
            <Select value={country} onChange={(e) => setCountry(e.target.value)}>
              {BUY_COUNTRIES.map((c) => (
                <option key={c.iso} value={c.iso}>{c.label}</option>
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
          <div>
            <Label hint="optional">Starts with</Label>
            <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="e.g. 80" />
          </div>
        </div>
        <Button onClick={search} loading={searching} leftIcon={<Search size={14} />}>Search available</Button>

        {country === "IN" && (
          <div className="text-xs text-warn bg-warn/5 border border-warn/20 rounded-lg px-3 py-2">
            India numbers require completed KYC / address verification on your Plivo account. If a purchase is blocked,
            finish verification in the Plivo console, then try again.
          </div>
        )}

        {err && <div className="text-sm text-danger">{err}</div>}

        {results && (
          results.length === 0 ? (
            <div className="text-sm text-muted py-4 text-center">No available numbers for this search.</div>
          ) : (
            <div className="max-h-72 overflow-auto space-y-1 border border-line rounded-lg p-2">
              {results.map((n) => (
                <div key={n.number} className="flex items-center justify-between gap-2 rounded-lg bg-bg/50 px-3 py-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm tabular-nums">{n.e164}</div>
                    <div className="text-[11px] text-muted truncate">
                      {[n.numberType, n.region || n.country].filter(Boolean).join(" · ")}
                      {n.monthlyRentalRate ? ` · ${n.monthlyRentalRate}/mo` : ""}
                      {n.setupRate && n.setupRate !== "0" && n.setupRate !== "0.00000" ? ` · setup ${n.setupRate}` : ""}
                    </div>
                  </div>
                  <Button size="sm" leftIcon={<ShoppingCart size={13} />} loading={buying === n.number} onClick={() => setConfirmBuy(n)}>
                    Buy
                  </Button>
                </div>
              ))}
            </div>
          )
        )}
      </div>

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
    </Modal>
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
      <Card title="Plivo account">
        <div className="flex justify-center py-6 text-muted"><Spinner size={18} /></div>
      </Card>
    );
  }

  if (config?.connected) {
    // Once connected these three values never change and are never touched, but
    // the old card kept a full panel of them above the numbers table forever.
    // One line carries the same information.
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line2 bg-panel px-4 py-3 text-sm">
        <CheckCircle2 size={15} className="shrink-0 text-ok" />
        <b className="font-semibold">Plivo connected</b>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Account</span>
        {/* Only the tail: enough to tell accounts apart, not enough to copy. */}
        <span className="font-mono text-xs" title="Plivo Auth ID (ending)">••••{config.authId.slice(-4)}</span>
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">Default caller ID</span>
        <span className="text-xs text-ink2">
          {config.fromNumber ? formatPhone(config.fromNumber) : "None — each campaign uses its own"}
        </span>
        <div className="ml-auto">
          <Kebab
            items={[
              {
                label: "Disconnect",
                icon: <Link2Off size={13} />,
                danger: true,
                onClick: () => setConfirmDisconnect(true),
              },
            ]}
          />
        </div>
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
    <Card
      title={
        <span className="flex items-center gap-2">
          <Link2 size={16} className="text-accent" /> Connect your Plivo account
        </span>
      }
      description="Enter your Plivo Auth ID and Auth Token (from your Plivo Console home page). Your numbers and calls will run through your own account."
    >
      <div className="space-y-3 max-w-lg">
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

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-bg/50 border border-line rounded-lg px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`text-sm text-ink truncate ${mono ? "font-mono" : ""}`} title={value}>{value}</div>
    </div>
  );
}

/** "Bangalore, INDIA" → "Bangalore, India" (Plivo returns countries in capitals). */
function titleCase(s: string): string {
  return s.replace(/([A-Z])([A-Z]+)/g, (_, a: string, b: string) => a + b.toLowerCase());
}
