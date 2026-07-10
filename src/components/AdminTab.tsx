"use client";

import { useCallback, useEffect, useState } from "react";
import { UserPlus, Pencil, Trash2, ShieldCheck, Copy, Check, ExternalLink } from "lucide-react";
import {
  Card,
  Section,
  Button,
  Input,
  Label,
  Badge,
  Modal,
  Spinner,
  toast,
} from "./ui";
import { api } from "./useData";
import FinancialsView from "./admin/FinancialsView";
import ReportsByClientView from "./admin/ReportsByClientView";
import CallersView from "./admin/CallersView";
import PricingView from "./admin/PricingView";
import { viewAsClient } from "./admin/shared";

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

function ClientsView() {
  const [clients, setClients] = useState<Client[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);

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

  // The virtual "Main account" — the admin's own pre-tenancy data. It behaves
  // like a client (browse its data, shows in financials/reports) but has no
  // login and can't be edited/deleted. Backed by the tenant-less scope (the
  // "__main__" sentinel the middleware maps to it); no data is migrated.
  const mainAccount: Client = {
    id: "__main__",
    name: "Main account (existing data)",
    email: "your existing campaigns & calls",
    perms: FEATURES.map((f) => f.id),
    active: true,
    createdAt: "",
  };
  const rows: Client[] = [mainAccount, ...(clients ?? [])];

  // Enter a client's console (view-as-client), landing on their first granted
  // feature tab. Middleware scopes all data to this client via the cookie set
  // in viewAsClient; page.tsx shows the "Viewing as …" banner + exit.
  function openClientConsole(c: Client) {
    const firstTab =
      c.id === "__main__" ? "reports" : DATA_TAB_ORDER.find((t) => c.perms.includes(t)) ?? "reports";
    viewAsClient(c.id, firstTab);
  }

  return (
    <Section>
      <Card
        title="Client accounts"
        description="Click a client to open their console · create logins, grant access, reset passwords"
        action={
          <Button leftIcon={<UserPlus size={14} />} onClick={() => setCreateOpen(true)}>
            New client
          </Button>
        }
      >
        {err && <div className="text-sm text-danger mb-3">{err}</div>}
        {clients === null ? (
          <div className="flex items-center gap-2 text-muted text-sm py-6 justify-center">
            <Spinner size={16} /> Loading…
          </div>
        ) : (
          <div className="overflow-auto -mx-1">
            {clients.length === 0 && (
              <div className="mb-3 text-xs text-muted">
                No separate client logins yet. Your existing data lives under <span className="text-ink2">Main account</span> below — create a client with <span className="text-ink2">New client</span> to onboard others.
              </div>
            )}
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                  <th className="font-medium py-2 px-1">Client</th>
                  <th className="font-medium px-1">Status</th>
                  <th className="font-medium px-1">Access</th>
                  <th className="font-medium px-1 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => {
                  const isMain = c.id === "__main__";
                  return (
                  <tr
                    key={c.id}
                    onClick={() => openClientConsole(c)}
                    className="border-t border-line align-top hover:bg-elev/40 cursor-pointer"
                    title={`Open ${c.name || c.email}${isMain ? "" : "'s"} console`}
                  >
                    <td className="py-2.5 px-1">
                      <div className="font-medium text-ink flex items-center gap-1.5">
                        {c.name}
                        <ExternalLink size={12} className="text-muted" />
                      </div>
                      <div className="text-xs text-muted">{c.email}</div>
                      {isMain ? (
                        <div className="mt-0.5 text-[10px] text-muted italic">no login · you access it as admin</div>
                      ) : (
                        <ClientId id={c.id} />
                      )}
                    </td>
                    <td className="px-1 py-2.5">
                      {isMain ? (
                        <Badge tone="accent">Your data</Badge>
                      ) : (
                        <Badge tone={c.active ? "ok" : "muted"} dot={c.active}>
                          {c.active ? "Active" : "Disabled"}
                        </Badge>
                      )}
                    </td>
                    <td className="px-1 py-2.5">
                      <div className="flex flex-wrap gap-1 max-w-[280px]">
                        {c.perms.length === 0 ? (
                          <span className="text-xs text-muted">No access</span>
                        ) : (
                          c.perms.map((p) => (
                            <Badge key={p} tone="accent">
                              {FEATURES.find((f) => f.id === p)?.label ?? p}
                            </Badge>
                          ))
                        )}
                      </div>
                    </td>
                    <td
                      className="px-1 py-2.5 text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {isMain ? (
                        <button
                          onClick={() => openClientConsole(c)}
                          className="inline-flex items-center gap-1 text-xs text-brand hover:text-brand/80 px-2 py-1 rounded-md hover:bg-brand/10"
                        >
                          <ExternalLink size={12} /> Open
                        </button>
                      ) : (
                        <>
                          <button
                            onClick={() => setEditing(c)}
                            className="inline-flex items-center gap-1 text-xs text-ink2 hover:text-ink px-2 py-1 rounded-md hover:bg-elev"
                          >
                            <Pencil size={12} /> Edit
                          </button>
                          <DeleteButton client={c} onDone={load} />
                        </>
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ClientModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onSaved={() => {
          setCreateOpen(false);
          load();
        }}
      />
      <ClientModal
        open={!!editing}
        client={editing ?? undefined}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    </Section>
  );
}

function ClientId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(id).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          },
          () => {},
        );
      }}
      className="mt-0.5 inline-flex items-center gap-1 text-[10px] font-mono text-muted hover:text-ink2"
      title="Copy client id (use as the `client` field for /api/trigger-call)"
    >
      {copied ? <Check size={10} /> : <Copy size={10} />}
      {id}
    </button>
  );
}

function DeleteButton({ client, onDone }: { client: Client; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    try {
      await api(`/api/admin/clients/${client.id}`, { method: "DELETE" });
      toast(`Deleted ${client.email}`, "info");
      onDone();
    } catch (e: any) {
      toast(String(e?.message || e), "danger");
    }
    setBusy(false);
    setConfirming(false);
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1 text-xs text-danger hover:text-danger2 px-2 py-1 rounded-md hover:bg-danger/10"
      >
        <Trash2 size={12} /> Delete
      </button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1">
      <button
        onClick={del}
        disabled={busy}
        className="text-xs text-danger font-medium px-2 py-1 rounded-md hover:bg-danger/10 disabled:opacity-50"
      >
        {busy ? "…" : "Confirm"}
      </button>
      <button
        onClick={() => setConfirming(false)}
        className="text-xs text-muted px-1 py-1 rounded-md hover:bg-elev"
      >
        Cancel
      </button>
    </span>
  );
}

/** Create (no client prop) or Edit (client prop) a client login. */
function ClientModal({
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

  // Reset fields whenever the target changes / modal reopens.
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
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? "Edit client" : "New client"}
      size="sm"
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
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
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Corp" />
        </div>
        <div>
          <Label required={!isEdit}>Email</Label>
          <Input
            type="email"
            value={email}
            disabled={isEdit}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="client@company.com"
            hint={isEdit ? "Email can't be changed" : undefined}
          />
        </div>
        <div>
          <Label required={!isEdit} hint={isEdit ? "leave blank to keep" : "min 6 chars"}>
            {isEdit ? "Reset password" : "Password"}
          </Label>
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isEdit ? "New password" : "Initial password"}
          />
        </div>

        <div>
          <Label>Feature access</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {FEATURES.map((f) => {
              const on = perms.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => toggle(f.id)}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm border transition-colors text-left ${
                    on
                      ? "bg-brand/10 text-brand border-brand/25"
                      : "text-ink2 border-line hover:bg-elev/60"
                  }`}
                >
                  <span
                    className={`w-3.5 h-3.5 rounded flex items-center justify-center border ${
                      on ? "bg-brand border-brand text-bg" : "border-line2"
                    }`}
                  >
                    {on && <Check size={10} />}
                  </span>
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm text-ink2 cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="accent-brand"
            />
            Account active (uncheck to block sign-in)
          </label>
        )}
      </div>
    </Modal>
  );
}
