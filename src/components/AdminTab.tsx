"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { UserPlus, Pencil, Trash2, Copy, KeyRound, Users, Wand2 } from "lucide-react";
import {
  Section,
  Button,
  Input,
  Label,
  Badge,
  DataTable,
  TH,
  TD,
  Kebab,
  ConfirmDialog,
  EmptyState,
  Loading,
  toast,
} from "./ui";
import { api } from "./useData";
import FinancialsView from "./admin/FinancialsView";
import ReportsByClientView from "./admin/ReportsByClientView";
import CallersView from "./admin/CallersView";
import PricingView from "./admin/PricingView";
import { viewAsClient, useAnalytics } from "./admin/shared";
import { fmtMoney, istToday, istDaysAgo } from "./admin/money";
import { Seg, Avatar, Perm, SearchBox, Drawer, Chip } from "./AdminTabKit";

/** Data-tab ids in sidebar order — used to pick which tab to land on when an
 *  admin opens a client's console (their first granted feature). */
const DATA_TAB_ORDER = ["dial", "bulk", "campaigns", "audios", "reports", "whatsapp", "billing"];

/** Feature tabs an admin can grant, with display labels (order = sidebar order). */
const FEATURES: { id: string; label: string }[] = [
  { id: "dial", label: "Dial" },
  { id: "bulk", label: "Bulk calls" },
  { id: "campaigns", label: "Campaigns" },
  { id: "audios", label: "Audios" },
  { id: "reports", label: "Reports" },
  { id: "whatsapp", label: "WhatsApp" },
  { id: "billing", label: "Billing" },
];

interface Client {
  id: string;
  name: string;
  email: string;
  perms: string[];
  active: boolean;
  createdAt: string;
}

export type AdminView = "clients" | "reports" | "calls" | "financials" | "pricing";

/** Admin area: manage client logins, define call cost + see financials, and view
 *  client-wise reports. Which sub-view shows is driven by the sidebar (page.tsx). */
export default function AdminTab({ view = "clients" }: { view?: AdminView }) {
  return (
    <div className="space-y-4">
      {view === "clients" && <ClientsView />}
      {view === "reports" && <ReportsByClientView />}
      {view === "calls" && <CallersView />}
      {view === "financials" && <FinancialsView />}
      {view === "pricing" && <PricingView />}
    </div>
  );
}

type StatusFilter = "all" | "active" | "disabled";

function ClientsView() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [deleting, setDeleting] = useState<Client | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [q, setQ] = useState("");

  // Wallet + last-30-day call volume per client (read-only, same source as Financials).
  const [from] = useState(istDaysAgo(29));
  const [to] = useState(istToday());
  const { data: analytics } = useAnalytics(from, to);
  const stats = useMemo(() => new Map((analytics?.rows ?? []).map((r) => [r.id, r])), [analytics]);
  const currency = analytics?.currency || "INR";

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await api<{ clients: Client[] }>("/api/admin/clients");
      setClients(r.clients);
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const all: Client[] = clients ?? [];
  const counts = {
    all: all.length,
    active: all.filter((c) => c.active).length,
    disabled: all.filter((c) => !c.active).length,
  };
  const needle = q.trim().toLowerCase();
  const rows = all.filter(
    (c) =>
      (status === "all" || (status === "active" ? c.active : !c.active)) &&
      (!needle || `${c.name} ${c.email}`.toLowerCase().includes(needle)),
  );

  // Enter a client's console (view-as-client), landing on their first granted
  // feature tab. Middleware scopes all data to this client via the cookie set
  // in viewAsClient; page.tsx shows the "Viewing as …" banner + exit.
  function openClientConsole(c: Client) {
    const firstTab = DATA_TAB_ORDER.find((t) => c.perms.includes(t)) ?? "reports";
    viewAsClient(c.id, firstTab);
  }

  function copyId(id: string) {
    navigator.clipboard?.writeText(id).then(
      () => toast("Client ID copied", "ok"),
      () => toast("Couldn't copy the client ID", "danger"),
    );
  }

  async function del() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await api(`/api/admin/clients/${deleting.id}`, { method: "DELETE" });
      toast(`Deleted ${deleting.email}`, "info");
      setDeleting(null);
      load();
    } catch (e: any) {
      toast(String(e?.message || e), "danger");
    }
    setDeleteBusy(false);
  }

  return (
    <Section>
      <div className="flex justify-end">
        <Button leftIcon={<UserPlus size={15} />} onClick={() => setCreateOpen(true)}>
          New client
        </Button>
      </div>

      <div className="relative overflow-hidden rounded-xl border border-line bg-panel shadow-card">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <Seg
            value={status}
            onChange={setStatus}
            options={[
              { id: "all", label: "All", count: counts.all },
              { id: "active", label: "Active", count: counts.active },
              { id: "disabled", label: "Disabled", count: counts.disabled },
            ]}
          />
          <span className="flex-1" />
          <SearchBox value={q} onChange={setQ} placeholder="Search clients" className="w-full sm:w-[240px]" />
        </div>

        {err && <div className="px-5 pb-3 text-sm text-danger">{err}</div>}

        {clients === null ? (
          <Loading label="Loading clients…" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Users size={20} />}
            title={all.length === 0 ? "No client logins yet" : "No clients match"}
            description={
              all.length === 0
                ? "Create one with New client to onboard a client."
                : "Try a different search or status."
            }
          />
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th className={TH}>Client</th>
                <th className={`${TH} hidden md:table-cell`}>Can use</th>
                <th className={`${TH} text-right`}>Wallet</th>
                <th className={`${TH} hidden text-right sm:table-cell`}>Calls · 30d</th>
                <th className={TH}>Status</th>
                <th className={`${TH} w-[130px]`}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const s = stats.get(c.id);
                return (
                  <tr
                    key={c.id}
                    onClick={() => openClientConsole(c)}
                    className="cursor-pointer transition-colors hover:bg-elev"
                    title={`Open ${c.name || c.email}'s console`}
                  >
                    <td className={TD}>
                      <div className="flex items-center gap-3">
                        <Avatar name={c.name || c.email} />
                        <div className="min-w-0">
                          <div className="truncate font-semibold tracking-[-0.01em] text-ink">{c.name || c.email}</div>
                          <div className="truncate text-[12.5px] text-muted">{c.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className={`${TD} hidden md:table-cell`}>
                      <div className="flex max-w-[300px] flex-wrap">
                        {c.perms.length === 0 ? (
                          <span className="text-xs text-muted">No access</span>
                        ) : (
                          // Menu order, so every client's chips line up the same way.
                          FEATURES.filter((f) => c.perms.includes(f.id)).map((f) => <Perm key={f.id}>{f.label}</Perm>)
                        )}
                      </div>
                    </td>
                    <td
                      className={`${TD} whitespace-nowrap text-right tabular-nums ${
                        s && s.balance <= 0 ? "font-semibold text-warn" : "text-ink"
                      }`}
                    >
                      {s ? fmtMoney(s.balance, currency) : "—"}
                    </td>
                    <td className={`${TD} hidden text-right tabular-nums sm:table-cell`}>
                      {s ? s.total.toLocaleString("en-IN") : "—"}
                    </td>
                    <td className={TD}>
                      <Badge tone={c.active ? "ok" : "muted"} dot={c.active}>
                        {c.active ? "Active" : "Disabled"}
                      </Badge>
                    </td>
                    <td className={TD} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openClientConsole(c)}>
                          Open
                        </Button>
                        <Kebab
                          label={`Actions for ${c.name || c.email}`}
                          items={[
                            { label: "Edit access", icon: <Pencil size={14} />, onClick: () => setEditing(c) },
                            { label: "Reset password", icon: <KeyRound size={14} />, onClick: () => setEditing(c) },
                            { label: "Copy client ID", icon: <Copy size={14} />, onClick: () => copyId(c.id) },
                            { label: "Delete client", icon: <Trash2 size={14} />, danger: true, onClick: () => setDeleting(c) },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        )}
      </div>

      <ClientDrawer
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          load();
        }}
      />
      <ClientDrawer
        open={!!editing}
        client={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        title="Delete this client?"
        body={
          <>
            This removes the login for <b className="text-ink">{deleting?.email}</b>. They won’t be able to sign in
            again. You can’t undo it.
          </>
        }
        confirmLabel="Yes, delete"
        busy={deleteBusy}
        onConfirm={del}
        onClose={() => (deleteBusy ? undefined : setDeleting(null))}
      />
    </Section>
  );
}

/** A readable random password to paste into the form (admin can still type their own). */
function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const buf = new Uint32Array(12);
  crypto.getRandomValues(buf);
  const s = Array.from(buf, (n) => chars[n % chars.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** Create (no client prop) or Edit (client prop) a client login. */
function ClientDrawer({
  open,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  client?: Client;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!client;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [perms, setPerms] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reset fields whenever the target changes / drawer reopens.
  useEffect(() => {
    if (!open) return;
    setErr(null);
    setPassword("");
    setName(client?.name ?? "");
    setEmail(client?.email ?? "");
    setPerms(client?.perms ?? []);
    setActive(client?.active ?? true);
  }, [open, client]);

  function toggle(id: string) {
    setPerms((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  }

  async function save() {
    setErr(null);
    if (!name.trim()) return setErr("Name is required.");
    if (!isEdit && !email.trim()) return setErr("Email is required.");
    if (!isEdit && password.length < 6) return setErr("Password must be at least 6 characters.");
    if (isEdit && password && password.length < 6) return setErr("Password must be at least 6 characters.");

    setBusy(true);
    try {
      if (isEdit) {
        await api(`/api/admin/clients/${client!.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name, perms, active, ...(password ? { password } : {}) }),
        });
        toast("Client updated", "ok");
      } else {
        await api("/api/admin/clients", {
          method: "POST",
          body: JSON.stringify({ name, email, password, perms }),
        });
        toast("Client created", "ok");
      }
      onSaved();
    } catch (e: any) {
      setErr(String(e?.message || e));
    }
    setBusy(false);
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit client" : "New client"}
      sub={isEdit ? client?.email : "They’ll get a login and only see their own data."}
      footer={
        <>
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={busy}>
            {isEdit ? "Save changes" : "Create client"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {err && <div className="text-sm text-danger">{err}</div>}
        <div>
          <Label required>Company name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bright Minds Coaching" />
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <div>
            <Label required={!isEdit}>Login email</Label>
            <Input
              type="email"
              value={email}
              disabled={isEdit}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ops@company.com"
              hint={isEdit ? "Email can't be changed" : undefined}
            />
          </div>
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="text-[13px] font-medium text-ink2">
                {isEdit ? "Reset password" : "Password"}
                {!isEdit && <span className="ml-0.5 text-danger" aria-hidden="true">*</span>}
              </span>
              <button
                type="button"
                onClick={() => setPassword(generatePassword())}
                className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
              >
                <Wand2 size={12} /> Generate
              </button>
            </div>
            <Input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "New password" : "Initial password"}
              className="font-mono"
              hint={isEdit ? "Leave blank to keep the current one." : "At least 6 characters."}
            />
          </div>
        </div>

        <div>
          <Label>Can use</Label>
          <div className="flex flex-wrap gap-1.5">
            {FEATURES.map((f) => (
              <Chip key={f.id} on={perms.includes(f.id)} onClick={() => toggle(f.id)}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>

        {isEdit && (
          <label className="flex cursor-pointer items-start gap-3 rounded-[11px] border border-line px-3.5 py-3">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--c-accent))]"
            />
            <span>
              <b className="font-semibold text-ink">Account active</b>
              <span className="mt-0.5 block text-[12.5px] text-muted">Turn off to block this client from signing in.</span>
            </span>
          </label>
        )}
      </div>
    </Drawer>
  );
}
