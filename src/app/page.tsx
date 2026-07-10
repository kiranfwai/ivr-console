"use client";

import { useEffect, useMemo, useState } from "react";
import { Users2, Eye, X } from "lucide-react";
import DialTab from "@/components/DialTab";
import BulkTab from "@/components/BulkTab";
import CampaignsTab from "@/components/CampaignsTab";
import AudiosTab from "@/components/AudiosTab";
import ReportsTab from "@/components/ReportsTab";
import WhatsAppTab from "@/components/WhatsAppTab";
import BillingTab from "@/components/BillingTab";
import AdminTab, { type AdminView } from "@/components/AdminTab";
import { Spinner, Toaster } from "@/components/ui";
import { Shell, TabId } from "@/components/Shell";

const META: Record<TabId, { title: string; desc: string }> = {
  dial:      { title: "Single call",     desc: "Place an outbound IVR call from a campaign" },
  bulk:      { title: "Bulk calls",      desc: "Run a paced batch through a campaign" },
  campaigns: { title: "Campaigns",       desc: "Audio, prompt, webhook, and from-number per campaign" },
  audios:    { title: "Audio library",   desc: "Upload or link MP3s used by campaigns" },
  reports:   { title: "Reports",         desc: "Volumes, lift rate, outcomes, CSV export" },
  whatsapp:  { title: "WhatsApp",        desc: "Direct Pabbly fire — single or bulk" },
  billing:   { title: "Billing",         desc: "Wallet balance, top-ups, transactions and phone numbers" },
  admin:          { title: "Clients",       desc: "Create client logins and set feature permissions" },
  adminReports:   { title: "Reports",       desc: "Client-wise volumes, outcomes and lift" },
  adminCalls:     { title: "Callers",       desc: "Every number dialed — per client, date range and charge" },
  adminFinancials:{ title: "Financials",    desc: "Cost and wallet balance by client" },
  adminPricing:   { title: "Per-call cost",  desc: "Connected-call rate and payment settings" },
};

// Feature tabs that operate on a specific client's data.
const DATA_TABS: TabId[] = ["dial", "bulk", "campaigns", "audios", "reports", "whatsapp", "billing"];

// Virtual "client" representing the admin's own pre-tenancy data (everything
// created before client accounts existed lives in the tenant-less scope). The
// middleware maps this sentinel back to that scope, so selecting it lets the
// admin browse existing campaigns / calls / reports without changing any data.
const MAIN_ACCOUNT = "__main__";

// Admin-only surfaces (shown when the admin isn't viewing a specific client).
const ADMIN_TABS: TabId[] = ["admin", "adminReports", "adminCalls", "adminFinancials", "adminPricing"];

// Which AdminTab sub-view each admin tab renders.
const ADMIN_VIEW: Partial<Record<TabId, AdminView>> = {
  admin: "clients",
  adminReports: "reports",
  adminCalls: "calls",
  adminFinancials: "financials",
  adminPricing: "pricing",
};

interface Me {
  role: "admin" | "client";
  email?: string | null;
  name?: string | null;
  perms: string[];
}
interface ClientOpt {
  id: string;
  name: string;
  email: string;
  active: boolean;
  perms: string[];
}

function isTabId(v: string | null): v is TabId {
  return v !== null && (Object.keys(META) as string[]).includes(v);
}

export default function Page() {
  const [me, setMe] = useState<Me | null>(null);
  const [meErr, setMeErr] = useState(false);
  const [tab, setTab] = useState<TabId>("dial");

  // Admin-only: which client's data the admin is currently viewing.
  const [clients, setClients] = useState<ClientOpt[]>([]);
  const [viewClient, setViewClient] = useState<string>("");

  useEffect(() => {
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((m: Me) => setMe(m))
      .catch(() => setMeErr(true));
    // Read any previously-selected admin client from the cookie.
    const m = document.cookie.match(/(?:^|;\s*)ivr_admin_client=([^;]+)/);
    if (m) setViewClient(decodeURIComponent(m[1]));
  }, []);

  const isAdmin = me?.role === "admin";

  // The switcher list = the real client accounts plus the virtual "Main account"
  // (existing pre-tenancy data), which gets all data tabs.
  const switcherClients = useMemo<ClientOpt[]>(
    () => [
      { id: MAIN_ACCOUNT, name: "Main account (existing data)", email: "", active: true, perms: [...DATA_TABS] },
      ...clients,
    ],
    [clients],
  );
  const selectedClient = useMemo(
    () => switcherClients.find((c) => c.id === viewClient) ?? null,
    [switcherClients, viewClient],
  );

  // The tabs this user may see.
  //  - A client sees only its granted feature tabs.
  //  - An admin viewing a specific client sees exactly that client's feature
  //    tabs (a faithful "view as client") — the "Viewing as… Exit" banner is how
  //    they return, so the admin surfaces are intentionally hidden here.
  //  - An admin with no client selected sees ONLY the admin surfaces
  //    (Clients / Reports / Financials / Per-call cost) — no data tabs.
  const allowedTabs = useMemo<TabId[]>(() => {
    if (!me) return [];
    if (isAdmin) {
      if (viewClient) {
        // In client view. Until the client list loads (perms unknown), show the
        // full data-tab set optimistically; narrow to the client's grants once known.
        const perms = selectedClient?.perms;
        return perms ? DATA_TABS.filter((t) => perms.includes(t)) : [...DATA_TABS];
      }
      return [...ADMIN_TABS];
    }
    return DATA_TABS.filter((t) => me.perms.includes(t));
  }, [me, isAdmin, viewClient, selectedClient]);

  // Load the client list for the admin's "viewing as" switcher.
  useEffect(() => {
    if (!isAdmin) return;
    fetch("/api/admin/clients")
      .then((r) => (r.ok ? r.json() : { clients: [] }))
      .then((d: { clients: ClientOpt[] }) => setClients(d.clients || []))
      .catch(() => {});
  }, [isAdmin]);

  // Pick a sensible starting tab once we know who this is (and honor ?tab=).
  useEffect(() => {
    if (!me) return;
    const fromUrl = new URLSearchParams(window.location.search).get("tab");
    const initial = isTabId(fromUrl) && allowedTabs.includes(fromUrl)
      ? fromUrl
      : allowedTabs[0] ?? "admin";
    setTab(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  function changeTab(t: TabId) {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    window.history.replaceState(null, "", url);
  }

  // If the current tab is no longer permitted (e.g. admin switched to a client
  // that lacks this feature), fall back to the first allowed tab.
  useEffect(() => {
    if (!me || !allowedTabs.length) return;
    if (!allowedTabs.includes(tab)) setTab(allowedTabs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowedTabs]);

  function chooseClient(id: string) {
    // Persist as a cookie so every subsequent API request is scoped to this
    // client (middleware reads it). Remount data tabs to refetch (see key below).
    document.cookie = `ivr_admin_client=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 30}; samesite=lax`;
    setViewClient(id);
  }

  // Leave "view as client" mode and return to the admin console.
  function exitViewAs() {
    document.cookie = `ivr_admin_client=; path=/; max-age=0; samesite=lax`;
    setViewClient("");
    changeTab("admin");
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  function onCampaignCreated(id: string) {
    try {
      window.localStorage.setItem("ivr.bulk.campaignId", JSON.stringify(id));
    } catch {
      /* storage blocked — non-fatal, user can pick it manually */
    }
    changeTab("bulk");
  }

  // --- loading / error gates ---
  if (meErr) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 text-center">
        <div>
          <div className="text-sm text-danger mb-2">Couldn’t load your account.</div>
          <button onClick={() => location.reload()} className="text-xs text-brand underline">
            Retry
          </button>
        </div>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        <Spinner size={20} />
      </div>
    );
  }

  const clientSwitcher = isAdmin ? (
    <div className="flex items-center gap-2">
      <Users2 size={14} className="text-muted" />
      <select
        value={viewClient}
        onChange={(e) => chooseClient(e.target.value)}
        className="bg-bg/60 border border-line hover:border-line2 focus:border-brand/60 rounded-lg px-2.5 py-1.5 text-xs outline-none cursor-pointer max-w-[220px]"
        title="View a client's data"
      >
        <option value="">Select client…</option>
        {switcherClients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name || c.email}
            {c.active ? "" : " (disabled)"}
          </option>
        ))}
      </select>
    </div>
  ) : undefined;

  const isAdminTab = ADMIN_TABS.includes(tab);
  const userLabel = isAdmin ? `${me.email} · Admin` : me.email;

  return (
    <>
      <Shell
        tab={tab}
        setTab={changeTab}
        title={META[tab].title}
        description={META[tab].desc}
        onLogout={logout}
        allowedTabs={allowedTabs}
        userLabel={userLabel}
        action={isAdmin ? clientSwitcher : undefined}
      >
        {isAdmin && viewClient && !isAdminTab && (
          <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-brand/25 bg-brand/10 px-3 py-2 text-sm">
            <Eye size={15} className="text-brand shrink-0" />
            <span className="text-ink2 min-w-0 truncate">
              Viewing as{" "}
              <span className="font-medium text-ink">
                {selectedClient?.name || selectedClient?.email || viewClient}
              </span>
              {selectedClient && !selectedClient.active && (
                <span className="text-muted"> (disabled)</span>
              )}
            </span>
            <button
              onClick={exitViewAs}
              className="ml-auto inline-flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs text-ink2 hover:text-ink hover:bg-elev/60 transition-colors"
            >
              <X size={12} /> Exit
            </button>
          </div>
        )}

        {isAdminTab ? (
          <AdminTab view={ADMIN_VIEW[tab] ?? "clients"} />
        ) : (
          // Remount data tabs when the admin switches client so they refetch
          // under the new tenant scope.
          <div key={viewClient}>
            {tab === "dial" && <DialTab />}
            {tab === "bulk" && <BulkTab />}
            {tab === "campaigns" && <CampaignsTab onCreated={onCampaignCreated} />}
            {tab === "audios" && <AudiosTab />}
            {tab === "reports" && <ReportsTab />}
            {tab === "whatsapp" && <WhatsAppTab />}
            {tab === "billing" && <BillingTab />}
          </div>
        )}
      </Shell>
      <Toaster />
    </>
  );
}
