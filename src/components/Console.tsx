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
import DndTab from "@/components/DndTab";
import NumbersTab from "@/components/NumbersTab";
import GSheetsTab from "@/components/GSheetsTab";
import DashboardTab from "@/components/DashboardTab";
import ScheduledTab from "@/components/ScheduledTab";
import SheetReportsTab from "@/components/SheetReportsTab";
import SidebarWallet from "@/components/SidebarWallet";
import AdminTab, { type AdminView } from "@/components/AdminTab";
import { Spinner, Toaster } from "@/components/ui";
import { Shell, NAV, TabId } from "@/components/Shell";

const META: Record<TabId, { title: string; desc: string }> = {
  dashboard: { title: "Dashboard",       desc: "What ran, how it went, and what needs you" },
  dial:      { title: "Dial",            desc: "Place an outbound IVR call from a campaign" },
  bulk:      { title: "Bulk calls",      desc: "Run a paced batch through a campaign" },
  gsheets:   { title: "Sheet Auto-Dial", desc: "Auto-call new Google Sheet rows within a calling window" },
  whatsapp:  { title: "WhatsApp",        desc: "Send on answer, in bulk, or on a schedule" },
  scheduled: { title: "Scheduled",       desc: "Everything queued to fire — calls and WhatsApp" },
  campaigns: { title: "Campaigns",       desc: "The audio, the message trigger and the caller ID for each campaign" },
  audios:    { title: "Audios",          desc: "The recordings your campaigns play when someone picks up" },
  numbers:   { title: "Phone Numbers",   desc: "The numbers you call from, on your own Plivo account" },
  dnd:       { title: "Do Not Disturb",  desc: "Numbers that are never called or messaged — calls, sheets, trigger API or WhatsApp" },
  reports:   { title: "Call reports",    desc: "Volumes, answer rate, outcomes, export" },
  sheetReports: { title: "Sheet reports", desc: "Every row a sheet produced, and what happened to it" },
  billing:   { title: "Billing & invoices", desc: "Wallet balance, top-ups, transactions and GST invoices" },
  admin:          { title: "Clients",        desc: "Create client logins and set feature permissions" },
  adminReports:   { title: "Client reports", desc: "Client-wise volumes, outcomes and lift" },
  adminCalls:     { title: "Callers",        desc: "Every number dialed — per client, date range and charge" },
  adminFinancials:{ title: "Financials",     desc: "Cost and wallet balance by client" },
  adminPricing:   { title: "Per-call cost",  desc: "Connected-call rate and payment settings" },
};

// Feature tabs that operate on a specific client's data and ARE permission-gated.
// (The grant names are the historic tab ids, so this list must keep using them.)
const DATA_TABS: TabId[] = ["dial", "bulk", "campaigns", "audios", "reports", "whatsapp", "billing"];

/**
 * Tabs every client gets regardless of grants.
 *
 * `gsheets`, `numbers` and `dnd` already behaved this way before the
 * restructure. The three new screens join them rather than inventing new
 * permission names that no existing client would have:
 *   - `dashboard`    — an overview of data the client can already see
 *   - `scheduled`    — a view over the bulk/WhatsApp schedules they already own
 *   - `sheetReports` — the per-sheet report, previously reachable from gsheets
 *
 * NOTE: this widens the existing permission hole rather than fixing it. Closing
 * it properly is a separate job (it needs real grants + a migration).
 */
const ALWAYS_TABS: TabId[] = ["dashboard", "gsheets", "numbers", "dnd", "scheduled", "sheetReports"];

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

// Keep the permitted set in menu order, de-duplicated. This also decides which
// tab someone lands on, since that's `allowedTabs[0]` — so a client with the
// Dashboard lands there, and one without it lands on their first Outreach tab.
const NAV_ORDER: TabId[] = NAV.map((n) => n.id);
function orderTabs(tabs: TabId[]): TabId[] {
  const set = new Set(tabs);
  return NAV_ORDER.filter((t) => set.has(t));
}

export default function Console() {
  const [me, setMe] = useState<Me | null>(null);
  const [meErr, setMeErr] = useState(false);
  const [tab, setTab] = useState<TabId>("dial");
  // False until the starting tab is chosen. Rendering before that briefly
  // mounted the Dial screen on every page load, which fetched the campaign list
  // and recent calls for nothing.
  const [tabReady, setTabReady] = useState(false);

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
    if (m) {
      const val = decodeURIComponent(m[1]);
      // "__main__" is the retired pre-tenancy sentinel (that data is now the real
      // client "Pryank"). Clear a stale cookie so the admin never lands in an
      // empty phantom scope — just return to the normal admin console.
      if (val === "__main__") {
        document.cookie = "ivr_admin_client=; path=/; max-age=0; samesite=lax";
      } else {
        setViewClient(val);
      }
    }
  }, []);

  const isAdmin = me?.role === "admin";

  // The switcher list = the real client accounts (Pryank is now one of them).
  const switcherClients = clients;
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
        const base = perms ? DATA_TABS.filter((t) => perms.includes(t)) : [...DATA_TABS];
        return orderTabs([...base, ...ALWAYS_TABS]);
      }
      return [...ADMIN_TABS];
    }
    return orderTabs([...DATA_TABS.filter((t) => me.perms.includes(t)), ...ALWAYS_TABS]);
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
    setTabReady(true);
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
    // Functional update: on first load this runs in the same commit as the
    // ?tab= pick above, and the closed-over `tab` is still the initial "dial" —
    // which is not an admin tab, so every admin deep link was reset to Clients.
    setTab((cur) => (allowedTabs.includes(cur) ? cur : allowedTabs[0]));
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
  if (!me || !tabReady) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">
        <Spinner size={20} />
      </div>
    );
  }

  // The admin's "viewing as" control. It lives in the SIDEBAR now rather than as
  // a bare <select> in the top-right corner, so it reads as an account picker
  // and doesn't compete with the page's primary action.
  const clientSwitcher = isAdmin ? (
    <div className="rounded-xl border border-line2 bg-white/[0.03] px-2.5 py-2">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-muted">
        <Users2 size={11} className="text-brand" /> Viewing
      </div>
      <select
        value={viewClient}
        onChange={(e) => chooseClient(e.target.value)}
        className="w-full cursor-pointer rounded-lg bg-transparent text-xs text-ink outline-none"
        title="View a client's data"
      >
        <option value="">FWAI admin (no client)</option>
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
  // Only meaningful in a client scope — an admin with no client selected has no
  // single wallet to show.
  const showWallet = !isAdmin || !!viewClient;
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
        accountPicker={clientSwitcher}
        wallet={showWallet ? <SidebarWallet key={viewClient} /> : undefined}
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
              <span className="text-muted"> · calls and messages you start here use their wallet</span>
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
            {tab === "dashboard" && <DashboardTab onGo={changeTab} />}
            {tab === "dial" && <DialTab />}
            {tab === "bulk" && <BulkTab />}
            {tab === "gsheets" && <GSheetsTab />}
            {tab === "campaigns" && <CampaignsTab onCreated={onCampaignCreated} />}
            {tab === "audios" && <AudiosTab />}
            {tab === "reports" && <ReportsTab />}
            {tab === "whatsapp" && <WhatsAppTab />}
            {tab === "billing" && <BillingTab />}
            {tab === "numbers" && <NumbersTab />}
            {tab === "dnd" && <DndTab />}
            {tab === "scheduled" && <ScheduledTab />}
            {tab === "sheetReports" && <SheetReportsTab />}
          </div>
        )}
      </Shell>
      <Toaster />
    </>
  );
}
