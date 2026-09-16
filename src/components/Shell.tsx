"use client";

import { ReactNode, useEffect, useState } from "react";
import {
  Phone,
  PhoneCall,
  Users,
  Megaphone,
  Music,
  BarChart3,
  MessageCircle,
  Wallet,
  ShieldCheck,
  Coins,
  Ban,
  LogOut,
  Menu,
  X,
  Circle,
  FileSpreadsheet,
  LayoutDashboard,
  CalendarClock,
} from "lucide-react";
import { IconButton } from "./ui";

export type TabId =
  | "dashboard"
  | "dial"
  | "bulk"
  | "gsheets"
  | "whatsapp"
  | "scheduled"
  | "campaigns"
  | "audios"
  | "numbers"
  | "dnd"
  | "reports"
  | "sheetReports"
  | "billing"
  | "admin"
  | "adminReports"
  | "adminCalls"
  | "adminFinancials"
  | "adminPricing";

/**
 * Grouped by what you're trying to DO, not by what kind of object it is.
 *
 * Two things that had no home of their own now have one:
 *  - "Scheduled" — the schedule card was mounted inside Bulk calls AND again
 *    inside WhatsApp, so there was no way to answer "what fires tonight?".
 *  - "Sheet reports" — was reachable only from a button on a sheet card.
 *
 * And "WhatsApp" moved out of Insights (it sends, it isn't a report) while the
 * admin's "Reports" became "Client reports" so two screens no longer share a name.
 */
const NAV: { id: TabId; label: string; icon: ReactNode; group: string }[] = [
  { id: "dashboard",  label: "Dashboard",       icon: <LayoutDashboard size={16} />,  group: "Overview" },

  { id: "dial",       label: "Dial",            icon: <Phone size={16} />,            group: "Outreach" },
  { id: "bulk",       label: "Bulk calls",      icon: <Users size={16} />,            group: "Outreach" },
  { id: "gsheets",    label: "Sheet Auto-Dial", icon: <FileSpreadsheet size={16} />,  group: "Outreach" },
  { id: "whatsapp",   label: "WhatsApp",        icon: <MessageCircle size={16} />,    group: "Outreach" },
  { id: "scheduled",  label: "Scheduled",       icon: <CalendarClock size={16} />,    group: "Outreach" },

  { id: "campaigns",  label: "Campaigns",       icon: <Megaphone size={16} />,        group: "Setup" },
  { id: "audios",     label: "Audios",          icon: <Music size={16} />,            group: "Setup" },
  { id: "numbers",    label: "Phone Numbers",   icon: <PhoneCall size={16} />,        group: "Setup" },
  { id: "dnd",        label: "Do Not Disturb",  icon: <Ban size={16} />,              group: "Setup" },

  { id: "reports",      label: "Call reports",  icon: <BarChart3 size={16} />,        group: "Reports" },
  { id: "sheetReports", label: "Sheet reports", icon: <FileSpreadsheet size={16} />,  group: "Reports" },

  { id: "billing",    label: "Billing & invoices", icon: <Wallet size={16} />,        group: "Account" },

  // Admin-only surfaces (shown only when no client is being viewed).
  { id: "admin",           label: "Clients",        icon: <ShieldCheck size={16} />,  group: "Admin" },
  { id: "adminReports",    label: "Client reports", icon: <BarChart3 size={16} />,    group: "Admin" },
  { id: "adminCalls",      label: "Callers",        icon: <PhoneCall size={16} />,    group: "Admin" },
  { id: "adminFinancials", label: "Financials",     icon: <Wallet size={16} />,       group: "Admin" },
  { id: "adminPricing",    label: "Per-call cost",  icon: <Coins size={16} />,        group: "Admin" },
];

export function Shell({
  tab,
  setTab,
  title,
  description,
  action,
  children,
  onLogout,
  allowedTabs,
  userLabel,
  wallet,
  accountPicker,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  onLogout: () => void;
  allowedTabs?: TabId[];
  userLabel?: ReactNode;
  /** Wallet balance card, pinned in the sidebar so it's visible from every screen. */
  wallet?: ReactNode;
  /** Admin's "viewing as" client picker — a proper control in the sidebar, not a bare select in the corner. */
  accountPicker?: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Only render the nav entries this user is allowed to see.
  const nav = allowedTabs ? NAV.filter((n) => allowedTabs.includes(n.id)) : NAV;
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);

  useEffect(() => {
    let alive = true;
    async function ping() {
      try {
        const r = await fetch("/api/campaigns", { method: "GET" });
        if (!alive) return;
        setHealth(r.ok ? "ok" : "down");
      } catch {
        if (alive) setHealth("down");
      } finally {
        if (alive) setCheckedAt(new Date());
      }
    }
    ping();
    const id = setInterval(ping, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const statusMeta = {
    checking: { color: "text-muted", label: "Checking…" },
    ok: { color: "text-ok", label: "All systems normal" },
    down: { color: "text-danger", label: "Connection issue" },
  }[health];
  const checkedLabel = checkedAt
    ? checkedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : null;

  const groups = Array.from(new Set(nav.map((n) => n.group)));

  const sidebar = (
    <div className="flex flex-col h-full w-60 bg-panel/80 border-r border-line backdrop-blur">
      {/* Brand — the real FWAI mark, same lockup as the landing and sign-in pages. */}
      <div className="px-4 h-14 flex items-center gap-2.5 border-b border-line">
        <span className="block h-[30px] w-[30px] flex-none overflow-hidden rounded-[9px] shadow-[0_4px_14px_-4px_rgba(0,0,0,0.7),inset_0_0_0_1px_rgba(255,255,255,0.09)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/fwai-logo.png" alt="Freedom With AI" className="h-full w-full object-cover" />
        </span>
        <div className="min-w-0">
          <div className="font-bold text-sm leading-tight tracking-[-0.02em]">IVR Console</div>
          <div className="text-[10px] uppercase tracking-widest text-muted">FWAI</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {groups.map((g) => (
          <div key={g}>
            <div className="px-2 mb-1 text-[10px] uppercase tracking-widest text-muted font-bold">
              {g}
            </div>
            <div className="space-y-0.5">
              {nav.filter((n) => n.group === g).map((item) => {
                const active = item.id === tab;
                return (
                  <button
                    key={item.id}
                    aria-current={active ? "page" : undefined}
                    onClick={() => {
                      setTab(item.id);
                      setMobileOpen(false);
                    }}
                    className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-sm transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 ${
                      active
                        ? "bg-brand/10 text-brand shadow-[inset_0_0_0_1px_rgba(94,234,212,0.25)]"
                        : "text-ink2 hover:text-ink hover:bg-white/[0.04]"
                    }`}
                  >
                    <span className={active ? "text-brand" : "text-muted"}>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Account picker + wallet + status + logout */}
      <div className="border-t border-line p-3 space-y-2">
        {accountPicker}
        {wallet}
        {userLabel && (
          <div className="px-2 py-1 text-xs text-muted truncate" title="Signed in as">
            {userLabel}
          </div>
        )}
        <div
          className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-elev/50 text-xs"
          title={checkedLabel ? `Last checked ${checkedLabel}` : undefined}
        >
          <Circle
            size={8}
            fill="currentColor"
            className={`${statusMeta.color} ${health === "checking" ? "animate-pulse" : ""}`}
          />
          <span className="text-ink2">{statusMeta.label}</span>
          {checkedLabel && health !== "checking" && (
            <span className="text-muted ml-auto tabular-nums">{checkedLabel}</span>
          )}
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm text-ink2 hover:text-ink hover:bg-elev/60 transition-colors"
        >
          <LogOut size={14} />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden lg:block sticky top-0 h-screen">{sidebar}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-40 animate-fade-in"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="lg:hidden fixed left-0 top-0 h-screen z-50 animate-slide-up">{sidebar}</aside>
        </>
      )}

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 min-h-[60px] py-2.5 px-4 lg:px-6 flex items-center gap-3 bg-bg/80 backdrop-blur border-b border-line [padding-top:max(0.625rem,env(safe-area-inset-top))]">
          <IconButton
            icon={<Menu size={18} />}
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-bold tracking-[-0.02em] truncate">{title}</div>
            {description && (
              <div className="text-xs text-muted truncate mt-0.5">{description}</div>
            )}
          </div>
          {/* The page's primary action lives here and stays put, instead of
              sitting below a long scrolling list. */}
          {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
        </header>
        <main className="flex-1 p-4 lg:p-6 max-w-6xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

export { NAV };
