"use client";

import { ReactNode, useEffect, useState } from "react";
import {
  Phone,
  Users,
  Megaphone,
  Music,
  BarChart3,
  MessageCircle,
  LogOut,
  Menu,
  X,
  Circle,
} from "lucide-react";
import { IconButton } from "./ui";

export type TabId = "dial" | "bulk" | "campaigns" | "audios" | "reports" | "whatsapp";

const NAV: { id: TabId; label: string; icon: ReactNode; group: string }[] = [
  { id: "dial",       label: "Dial",       icon: <Phone size={16} />,        group: "Call" },
  { id: "bulk",       label: "Bulk calls", icon: <Users size={16} />,        group: "Call" },
  { id: "campaigns",  label: "Campaigns",  icon: <Megaphone size={16} />,    group: "Manage" },
  { id: "audios",     label: "Audios",     icon: <Music size={16} />,        group: "Manage" },
  { id: "reports",    label: "Reports",    icon: <BarChart3 size={16} />,    group: "Insights" },
  { id: "whatsapp",   label: "WhatsApp",   icon: <MessageCircle size={16} />, group: "Insights" },
];

export function Shell({
  tab,
  setTab,
  title,
  description,
  action,
  children,
  onLogout,
}: {
  tab: TabId;
  setTab: (t: TabId) => void;
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  onLogout: () => void;
}) {
  const [mobileOpen, setMobileOpen] = useState(false);
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

  const groups = Array.from(new Set(NAV.map((n) => n.group)));

  const sidebar = (
    <div className="flex flex-col h-full w-60 bg-panel/80 border-r border-line backdrop-blur">
      {/* Brand */}
      <div className="px-4 h-14 flex items-center gap-2.5 border-b border-line">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-brand to-brand2 flex items-center justify-center text-bg shadow-glow">
          <Phone size={15} strokeWidth={2.5} />
        </div>
        <div className="min-w-0">
          <div className="font-semibold text-sm leading-tight">IVR Console</div>
          <div className="text-[10px] uppercase tracking-widest text-muted">FWAI</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {groups.map((g) => (
          <div key={g}>
            <div className="px-2 mb-1 text-[10px] uppercase tracking-widest text-muted font-medium">
              {g}
            </div>
            <div className="space-y-0.5">
              {NAV.filter((n) => n.group === g).map((item) => {
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
                        ? "bg-brand/10 text-brand border border-brand/25"
                        : "text-ink2 hover:text-ink hover:bg-elev/60 border border-transparent"
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

      {/* Status + Logout */}
      <div className="border-t border-line p-3 space-y-2">
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
        <header className="sticky top-0 z-30 h-14 px-4 lg:px-6 flex items-center gap-3 bg-bg/80 backdrop-blur border-b border-line">
          <IconButton
            icon={<Menu size={18} />}
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
          />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{title}</div>
            {description && (
              <div className="text-xs text-muted truncate -mt-0.5">{description}</div>
            )}
          </div>
          {action}
        </header>
        <main className="flex-1 p-4 lg:p-6 max-w-6xl w-full mx-auto">{children}</main>
      </div>
    </div>
  );
}

export { NAV };
