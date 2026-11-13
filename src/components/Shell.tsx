"use client";

import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
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
  FileSpreadsheet,
  LayoutDashboard,
  CalendarClock,
  ChevronsUpDown,
  ChevronDown,
  ChevronRight,
  Check,
  Search,
  Moon,
  Sun,
  Settings,
  Building2,
} from "lucide-react";
import { IconButton } from "./ui";
import { LogoMark, useTheme } from "./theme";

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
 * Grouped by what you're trying to DO. Dashboard sits on its own above the
 * groups; the admin tools live in their own space ("Admin console") so an
 * admin's sidebar is never the client tools AND the admin tools in one list.
 */
const NAV: { id: TabId; label: string; icon: ReactNode; group: string }[] = [
  { id: "dashboard",  label: "Dashboard",       icon: <LayoutDashboard size={16} />,  group: "" },

  { id: "dial",       label: "Dial",            icon: <Phone size={16} />,            group: "Outreach" },
  { id: "bulk",       label: "Bulk calls",      icon: <Users size={16} />,            group: "Outreach" },
  { id: "gsheets",    label: "Sheet auto-dial", icon: <FileSpreadsheet size={16} />,  group: "Outreach" },
  { id: "whatsapp",   label: "WhatsApp",        icon: <MessageCircle size={16} />,    group: "Outreach" },
  { id: "scheduled",  label: "Scheduled",       icon: <CalendarClock size={16} />,    group: "Outreach" },

  { id: "campaigns",  label: "Campaigns",       icon: <Megaphone size={16} />,        group: "Setup" },
  { id: "audios",     label: "Audios",          icon: <Music size={16} />,            group: "Setup" },
  { id: "numbers",    label: "Phone numbers",   icon: <PhoneCall size={16} />,        group: "Setup" },
  { id: "dnd",        label: "Do not disturb",  icon: <Ban size={16} />,              group: "Setup" },

  { id: "reports",      label: "Call reports",       icon: <BarChart3 size={16} />,       group: "Insights" },
  { id: "sheetReports", label: "Sheet reports",      icon: <FileSpreadsheet size={16} />, group: "Insights" },
  { id: "billing",      label: "Billing & invoices", icon: <Wallet size={16} />,          group: "Insights" },

  // Admin console (shown only when no client is being viewed).
  { id: "admin",           label: "Clients",        icon: <ShieldCheck size={16} />,  group: "Admin" },
  { id: "adminReports",    label: "Client reports", icon: <BarChart3 size={16} />,    group: "Admin" },
  { id: "adminCalls",      label: "Callers",        icon: <PhoneCall size={16} />,    group: "Admin" },
  { id: "adminFinancials", label: "Financials",     icon: <Coins size={16} />,        group: "Admin" },
  { id: "adminPricing",    label: "Per-call cost",  icon: <Settings size={16} />,     group: "Admin" },
];

export interface WorkspaceOption {
  id: string;
  name: string;
  active: boolean;
}

function initials(s: string) {
  const w = s.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? "?") + (w[1]?.[0] ?? "")).toUpperCase();
}

/** Click-outside / Escape closing for the small menus in the shell. */
function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [open]);
  return { open, setOpen, ref };
}

const COLLAPSE_KEY = "ivr.nav.collapsed";

export function Shell({
  tab,
  setTab,
  title,
  description,
  action,
  children,
  onLogout,
  allowedTabs,
  userEmail,
  isAdmin,
  workspaceName,
  clients,
  viewClient,
  onChooseClient,
  onAdminConsole,
  walletPill,
  banner,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  onLogout: () => void;
  allowedTabs?: TabId[];
  userEmail?: string | null;
  isAdmin?: boolean;
  /** Name shown at the top of the sidebar: the client's own name, or the one an admin is viewing. */
  workspaceName: string;
  clients?: WorkspaceOption[];
  viewClient?: string;
  onChooseClient?: (id: string) => void;
  onAdminConsole?: () => void;
  /** Wallet balance button for the top bar (client scope only). */
  walletPill?: ReactNode;
  /** "Viewing as …" strip shown above the page when an admin views a client. */
  banner?: ReactNode;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const nav = allowedTabs ? NAV.filter((n) => allowedTabs.includes(n.id)) : NAV;
  const theme = useTheme();
  const ws = usePopover();
  const me = usePopover();
  const inAdmin = isAdmin && !viewClient;

  const [collapsed, setCollapsed] = useState<string[]>([]);
  useEffect(() => {
    try { setCollapsed(JSON.parse(window.localStorage.getItem(COLLAPSE_KEY) || "[]")); } catch { /* ignore */ }
  }, []);
  function toggleGroup(g: string) {
    setCollapsed((cur) => {
      const next = cur.includes(g) ? cur.filter((x) => x !== g) : [...cur, g];
      try { window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  // System status — a light authenticated ping every minute.
  const [health, setHealth] = useState<"checking" | "ok" | "down">("checking");
  useEffect(() => {
    let alive = true;
    async function ping() {
      try {
        const r = await fetch("/api/me", { method: "GET" });
        if (alive) setHealth(r.ok ? "ok" : "down");
      } catch {
        if (alive) setHealth("down");
      }
    }
    ping();
    const id = setInterval(ping, 60_000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Ctrl/⌘ K opens the quick search from anywhere.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen(true); }
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);

  const groups = Array.from(new Set(nav.map((n) => n.group)));
  const currentGroup = NAV.find((n) => n.id === tab)?.group || "";
  const go = (t: TabId) => { setTab(t); setMobileOpen(false); };

  const sidebar = (
    <div className="ivr-side flex h-full w-[252px] flex-col border-r border-line">
      {/* Workspace — logo + whose data this is. Admins switch client / admin console here. */}
      <div className="relative px-2.5 pt-3" ref={ws.ref}>
        <button
          type="button"
          onClick={() => isAdmin && ws.setOpen((v) => !v)}
          className={`flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left transition-colors ${isAdmin ? "hover:bg-ink/[0.05]" : "cursor-default"}`}
          aria-haspopup={isAdmin ? "menu" : undefined}
          aria-expanded={isAdmin ? ws.open : undefined}
        >
          <LogoMark size={32} />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[14px] font-semibold tracking-[-0.015em]">{inAdmin ? "Admin console" : workspaceName}</span>
            <span className="block truncate text-xs text-muted">{inAdmin ? `${clients?.length ?? 0} clients · all data` : "IVR Console"}</span>
          </span>
          {isAdmin && <ChevronsUpDown size={15} className="shrink-0 text-muted" />}
        </button>
        {isAdmin && ws.open && (
          <div role="menu" className="absolute left-2.5 right-2.5 top-full z-50 mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-pop animate-fade-in">
            <div className="px-2.5 pb-1 pt-2 text-[11.5px] font-medium text-muted">Client workspaces</div>
            {(clients ?? []).map((c) => {
              const on = c.id === viewClient;
              return (
                <button
                  key={c.id}
                  role="menuitem"
                  onClick={() => { ws.setOpen(false); onChooseClient?.(c.id); }}
                  className={`flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-ink/[0.05] ${on ? "bg-ink/[0.05] text-ink" : "text-ink2"}`}
                >
                  <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] bg-accent/10 text-[11px] font-semibold text-accent">{initials(c.name)}</span>
                  <span className="min-w-0 flex-1 truncate">{c.name}{!c.active && <span className="text-muted"> · disabled</span>}</span>
                  {on && <Check size={14} className="shrink-0 text-accent" />}
                </button>
              );
            })}
            <div className="my-1 h-px bg-line" />
            <button
              role="menuitem"
              onClick={() => { ws.setOpen(false); onAdminConsole?.(); }}
              className={`flex w-full items-center gap-2.5 rounded-[8px] px-2 py-1.5 text-left text-[13.5px] transition-colors hover:bg-ink/[0.05] ${inAdmin ? "bg-ink/[0.05] text-ink" : "text-ink2"}`}
            >
              <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[7px] bg-brand text-onbrand"><Building2 size={13} /></span>
              <span className="flex-1">Admin console</span>
              {inAdmin ? <Check size={14} className="text-accent" /> : <span className="text-[11.5px] text-muted">admins only</span>}
            </button>
          </div>
        )}
      </div>

      {/* Nav */}
      <nav className="mt-3 flex-1 overflow-y-auto px-2.5 pb-3">
        {groups.map((g) => {
          const items = nav.filter((n) => n.group === g);
          const isCollapsed = !!g && collapsed.includes(g) && g !== currentGroup;
          return (
            <div key={g || "top"} className={g ? "mt-3" : ""}>
              {g && (
                <button
                  type="button"
                  onClick={() => toggleGroup(g)}
                  className="mb-0.5 flex w-full items-center justify-between rounded-md px-2.5 py-1 text-[11.5px] font-medium text-muted transition-colors hover:text-ink2"
                  aria-expanded={!isCollapsed}
                >
                  <span>{g}</span>
                  <span className="flex items-center gap-1.5">
                    {isCollapsed && <span className="tabular-nums">{items.length}</span>}
                    {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </span>
                </button>
              )}
              {!isCollapsed && (
                <div className="space-y-px">
                  {items.map((item) => {
                    const active = item.id === tab;
                    return (
                      <button
                        key={item.id}
                        aria-current={active ? "page" : undefined}
                        onClick={() => go(item.id)}
                        className={`relative flex h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 text-[13.5px] transition-colors focus-visible:outline-none focus-visible:shadow-glow ${
                          active ? "ivr-nav-on font-semibold text-ink" : "text-ink2 hover:bg-ink/[0.05] hover:text-ink"
                        }`}
                      >
                        <span className={active ? "text-accent" : "text-muted"}>{item.icon}</span>
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {/* Who is signed in — opens a small menu (dark mode, sign out). */}
      <div className="relative px-2.5 pb-2.5" ref={me.ref}>
        {me.open && (
          <div role="menu" className="absolute bottom-full left-2.5 right-2.5 z-50 mb-1 rounded-xl border border-line bg-panel p-1 shadow-pop animate-fade-in">
            <div className="px-2.5 pb-2 pt-2">
              <div className="truncate text-[13px] font-semibold">{userEmail}</div>
              <div className="text-xs text-muted">{isAdmin ? "Admin" : "Client"}</div>
            </div>
            <div className="my-1 h-px bg-line" />
            <button
              role="menuitemcheckbox"
              aria-checked={theme.isDark}
              onClick={theme.toggle}
              className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13.5px] text-ink2 hover:bg-ink/[0.05] hover:text-ink"
            >
              {theme.isDark ? <Sun size={15} className="text-muted" /> : <Moon size={15} className="text-muted" />}
              <span className="flex-1">Dark mode</span>
              <span className={`relative h-5 w-[34px] rounded-full transition-colors ${theme.isDark ? "bg-accent" : "bg-line2"}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${theme.isDark ? "translate-x-[16px]" : "translate-x-0.5"}`} />
              </span>
            </button>
            <button
              role="menuitem"
              onClick={() => { me.setOpen(false); setPaletteOpen(true); }}
              className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13.5px] text-ink2 hover:bg-ink/[0.05] hover:text-ink"
            >
              <Search size={15} className="text-muted" />
              <span className="flex-1">Quick search</span>
              <kbd className="rounded border border-line bg-elev px-1.5 text-[11px] text-muted">Ctrl K</kbd>
            </button>
            <div className="my-1 h-px bg-line" />
            <button
              role="menuitem"
              onClick={onLogout}
              className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13.5px] text-danger hover:bg-danger/[0.08]"
            >
              <LogOut size={15} />
              Sign out
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => me.setOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-[10px] px-2 py-2 text-left transition-colors hover:bg-ink/[0.05]"
          aria-haspopup="menu"
          aria-expanded={me.open}
        >
          <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
            {initials(userEmail || "?")}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[13px] font-semibold">{userEmail}</span>
            <span className="block text-xs text-muted">{isAdmin ? "Admin" : "Client"}</span>
          </span>
          <ChevronsUpDown size={15} className="shrink-0 text-muted" />
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-screen lg:block">{sidebar}</aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div className="fixed inset-0 z-40 bg-scrim/50 backdrop-blur-sm animate-fade-in lg:hidden" onClick={() => setMobileOpen(false)} />
          <aside className="fixed left-0 top-0 z-50 h-screen animate-slide-up lg:hidden">{sidebar}</aside>
        </>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="ivr-top sticky top-0 z-30 flex h-[58px] items-center gap-2.5 border-b border-line px-4 [padding-top:env(safe-area-inset-top)] lg:px-7">
          <IconButton icon={<Menu size={18} />} className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu" />
          <div className="hidden min-w-0 items-center gap-1.5 text-[13px] text-muted sm:flex">
            {currentGroup && (<><span>{currentGroup}</span><ChevronRight size={13} className="text-muted/70" /></>)}
            <span className="truncate font-semibold text-ink">{title}</span>
          </div>
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex h-[34px] items-center gap-2 rounded-[9px] border border-line bg-panel px-2.5 text-[13px] text-muted shadow-xs transition-colors hover:border-line2 md:w-[250px]"
            aria-label="Quick search"
          >
            <Search size={15} />
            <span className="hidden md:inline">Search pages…</span>
            <kbd className="ml-auto hidden rounded border border-line border-b-2 bg-elev px-1.5 text-[11px] font-medium text-muted md:inline">Ctrl K</kbd>
          </button>
          {walletPill}
          <div
            className="hidden h-[30px] items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 text-[12.5px] text-muted md:flex"
            title={health === "ok" ? "The app and its database are answering" : undefined}
          >
            <span className={`h-[7px] w-[7px] rounded-full ${health === "ok" ? "bg-ok2 live-dot" : health === "down" ? "bg-danger2" : "bg-muted animate-pulse"}`} />
            {health === "ok" ? "All systems normal" : health === "down" ? "Connection issue" : "Checking…"}
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1260px] flex-1 px-4 pb-14 pt-6 lg:px-8 lg:pt-8">
          {banner}
          <div className="mb-6 flex flex-wrap items-end gap-4">
            <div className="min-w-0">
              <h1 className="text-[24px] font-semibold leading-tight tracking-[-0.03em] lg:text-[26px]">{title}</h1>
              {description && <p className="mt-1.5 text-sm text-muted">{description}</p>}
            </div>
            {action && <div className="ml-auto flex flex-wrap items-center gap-2">{action}</div>}
          </div>
          {children}
        </main>
      </div>

      {paletteOpen && (
        <CommandPalette
          items={nav}
          onClose={() => setPaletteOpen(false)}
          onPick={(id) => { setPaletteOpen(false); go(id); }}
          extra={[
            { label: theme.isDark ? "Switch to light mode" : "Switch to dark mode", run: () => { theme.toggle(); setPaletteOpen(false); }, icon: theme.isDark ? <Sun size={15} /> : <Moon size={15} /> },
            ...(isAdmin && viewClient ? [{ label: "Go to admin console", run: () => { setPaletteOpen(false); onAdminConsole?.(); }, icon: <Building2 size={15} /> }] : []),
            { label: "Sign out", run: onLogout, icon: <LogOut size={15} /> },
          ]}
        />
      )}
    </div>
  );
}

/** Ctrl K: jump to any page (or run a small action) from anywhere. */
function CommandPalette({
  items,
  extra,
  onPick,
  onClose,
}: {
  items: { id: TabId; label: string; icon: ReactNode; group: string }[];
  extra: { label: string; run: () => void; icon: ReactNode }[];
  onPick: (id: TabId) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const KW: Partial<Record<TabId, string>> = {
    dnd: "dnd block opt-out", reports: "csv export download calls", billing: "wallet invoice gst top-up money",
    numbers: "caller id plivo", gsheets: "google sheet", audios: "recording voice", admin: "clients",
  };
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const pages = items
      .filter((i) => !needle || `${i.label} ${i.group} ${KW[i.id] || ""}`.toLowerCase().includes(needle))
      .map((i) => ({ kind: "page" as const, label: i.label, sub: i.group || "Overview", icon: i.icon, run: () => onPick(i.id) }));
    const acts = extra
      .filter((a) => !needle || a.label.toLowerCase().includes(needle))
      .map((a) => ({ kind: "action" as const, label: a.label, sub: "Action", icon: a.icon, run: a.run }));
    return [...pages, ...acts];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, items, extra]);
  useEffect(() => setIdx(0), [q]);

  return (
    <div className="fixed inset-0 z-[60] bg-scrim/50 backdrop-blur-[3px] animate-fade-in" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Quick search"
        onMouseDown={(e) => e.stopPropagation()}
        className="mx-auto mt-[12vh] w-[min(620px,calc(100%-2rem))] overflow-hidden rounded-2xl border border-line bg-panel shadow-pop animate-slide-up"
      >
        <div className="flex h-14 items-center gap-2.5 border-b border-line px-4">
          <Search size={18} className="text-muted" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setIdx((i) => Math.min(i + 1, rows.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
              if (e.key === "Enter") rows[idx]?.run();
              if (e.key === "Escape") onClose();
            }}
            placeholder="Search pages and actions…"
            className="flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-muted"
          />
          <kbd className="rounded border border-line bg-elev px-1.5 text-[11px] text-muted">Esc</kbd>
        </div>
        <div className="max-h-[380px] overflow-y-auto p-2">
          {rows.length === 0 && <div className="py-8 text-center text-sm text-muted">Nothing found</div>}
          {rows.map((r, i) => (
            <button
              key={r.kind + r.label}
              onMouseEnter={() => setIdx(i)}
              onClick={r.run}
              className={`flex w-full items-center gap-3 rounded-[9px] px-2.5 py-2 text-left text-[13.5px] ${i === idx ? "bg-accent/10 text-ink" : "text-ink2"}`}
            >
              <span className={`grid h-7 w-7 place-items-center rounded-[8px] ${i === idx ? "bg-brand text-onbrand" : "bg-elev text-muted"}`}>{r.icon}</span>
              <span className="flex-1">{r.label}</span>
              <span className="text-xs text-muted">{r.sub}</span>
            </button>
          ))}
        </div>
        <div className="flex gap-4 border-t border-line bg-elev/60 px-4 py-2.5 text-xs text-muted">
          <span>↑ ↓ to move</span><span>Enter to open</span><span className="ml-auto">Works from any screen</span>
        </div>
      </div>
    </div>
  );
}

export { NAV };
