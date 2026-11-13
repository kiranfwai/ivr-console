"use client";

/**
 * Small presentational pieces shared by the Billing and Admin screens
 * (segmented control, initials avatar, KPI card with an icon header, a
 * side drawer, minibar, facts list). Tokens only — they follow the theme.
 */

import { ReactNode, useEffect, useRef } from "react";
import { X, Search } from "lucide-react";
import { IconButton } from "./ui";

/* -------------------- Segmented control -------------------- */
export function Seg<T extends string>({
  value,
  options,
  onChange,
  full,
  size = "md",
}: {
  value: T;
  options: { id: T; label: ReactNode; count?: number }[];
  onChange: (v: T) => void;
  full?: boolean;
  size?: "sm" | "md";
}) {
  return (
    <div
      role="tablist"
      className={`${full ? "flex w-full" : "inline-flex"} max-w-full overflow-x-auto gap-0.5 rounded-[10px] border border-line bg-ink/[0.04] p-[3px]`}
    >
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.id)}
            className={`${full ? "flex-1 justify-center" : ""} inline-flex items-center gap-1.5 whitespace-nowrap rounded-[7px] px-[11px] ${
              size === "sm" ? "h-[26px] text-[12.5px]" : "h-7 text-[13px]"
            } font-medium transition-colors ${
              on ? "bg-panel text-ink shadow-xs" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
            {o.count != null && <span className="text-[11.5px] font-medium text-muted tabular-nums">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------- Initials avatar -------------------- */
const AV_TONES = [
  "bg-accent/10 text-accent",
  "bg-ok/10 text-ok",
  "bg-warn/10 text-warn",
  "bg-info/10 text-info",
  "bg-brand2/10 text-brand2",
  "bg-danger/10 text-danger",
];

export function initials(name: string): string {
  const parts = (name || "?").replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return ((parts[0][0] || "") + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] || "")).toUpperCase();
}

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  let h = 0;
  for (const ch of name || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <div
      className={`grid flex-none place-items-center rounded-[9px] font-semibold ${AV_TONES[h % AV_TONES.length]}`}
      style={{ width: size, height: size, fontSize: size >= 32 ? 12 : 11 }}
      aria-hidden="true"
    >
      {initials(name)}
    </div>
  );
}

/** Icon tile used inside table cells (transactions etc.). */
export function IconAvatar({ icon, tone = "muted" }: { icon: ReactNode; tone?: "ok" | "muted" | "danger" | "accent" | "warn" }) {
  const c = {
    ok: "bg-ok/10 text-ok",
    muted: "bg-ink/[0.05] text-muted",
    danger: "bg-danger/10 text-danger",
    accent: "bg-accent/10 text-accent",
    warn: "bg-warn/10 text-warn",
  }[tone];
  return <div className={`grid h-[34px] w-[34px] flex-none place-items-center rounded-[9px] ${c}`}>{icon}</div>;
}

/* -------------------- KPI card (icon header) -------------------- */
export function KpiCard({
  icon,
  tone = "accent",
  label,
  value,
  unit,
  foot,
  children,
}: {
  icon: ReactNode;
  tone?: "accent" | "ok" | "warn" | "info" | "brand2" | "danger";
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  foot?: ReactNode;
  children?: ReactNode;
}) {
  const ic = {
    accent: "bg-accent/10 text-accent",
    ok: "bg-ok/10 text-ok",
    warn: "bg-warn/10 text-warn",
    info: "bg-info/10 text-info",
    brand2: "bg-brand2/10 text-brand2",
    danger: "bg-danger/10 text-danger",
  }[tone];
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel px-[18px] pt-4 pb-4 shadow-card transition-shadow hover:shadow-pop">
      <div className="flex items-center gap-2 text-[13px] font-medium text-muted">
        <span className={`grid h-7 w-7 place-items-center rounded-lg ${ic}`}>{icon}</span>
        {label}
      </div>
      <div className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.04em] text-ink tabular-nums">
        {value}
        {unit && <small className="ml-1.5 text-[13.5px] font-medium tracking-[-0.01em] text-muted">{unit}</small>}
      </div>
      {foot != null && <div className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted">{foot}</div>}
      {children}
    </div>
  );
}

/* -------------------- Mini bar (rate) -------------------- */
export function MiniBar({ pct }: { pct: number }) {
  const w = Math.max(0, Math.min(100, pct));
  return (
    <div className="flex items-center justify-end gap-2.5">
      <span className="block h-[5px] w-[70px] overflow-hidden rounded-full bg-line">
        <i className="block h-full rounded-full bg-accent" style={{ width: `${w}%` }} />
      </span>
      <b className="w-11 text-right font-medium tabular-nums">{pct}%</b>
    </div>
  );
}

/* -------------------- Facts list -------------------- */
export function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <div className="mt-[18px] overflow-hidden rounded-[10px] border border-line">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-3 border-b border-line/70 px-3 py-2.5 text-[13px] last:border-b-0">
          <span className="text-muted">{k}</span>
          <b className="text-right font-semibold text-ink">{v}</b>
        </div>
      ))}
    </div>
  );
}

/* -------------------- Search box -------------------- */
export function SearchBox({
  value,
  onChange,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <label
      className={`flex h-[34px] items-center gap-2 rounded-[9px] border border-line bg-panel px-2.5 text-[13px] shadow-xs focus-within:border-accent focus-within:shadow-glow ${className}`}
    >
      <Search size={15} className="flex-none text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
      />
    </label>
  );
}

/* -------------------- Drawer -------------------- */
export function Drawer({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>("input, select, textarea, button");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 animate-fade-in">
      <div className="absolute inset-0 bg-scrim/50 backdrop-blur-[2px]" onClick={onClose} />
      <aside
        ref={ref}
        role="dialog"
        aria-modal="true"
        className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-line bg-panel shadow-pop animate-slide-up"
      >
        <div className="flex items-start gap-3 border-b border-line px-6 py-5">
          <div className="min-w-0 flex-1">
            <h2 className="m-0 text-[18px] font-semibold tracking-[-0.025em] text-ink">{title}</h2>
            {sub && <p className="m-0 mt-1 text-[13px] text-muted">{sub}</p>}
          </div>
          <IconButton icon={<X size={16} />} onClick={onClose} aria-label="Close" />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex items-center gap-2 border-t border-line bg-elev/60 px-6 py-3.5">{footer}</div>}
      </aside>
    </div>
  );
}

/* -------------------- Toggle chip (multi-select) -------------------- */
export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`grid h-[30px] min-w-[40px] place-items-center rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors ${
        on ? "border-accent/25 bg-accent/10 text-accent" : "border-line bg-panel text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

/** Small read-only tag (feature chips in tables). */
export function Perm({ children }: { children: ReactNode }) {
  return (
    <span className="mr-[3px] my-[2px] inline-flex h-5 items-center rounded-md border border-line bg-ink/[0.04] px-[7px] text-[11.5px] text-ink2">
      {children}
    </span>
  );
}

/** Info callout. */
export function Callout({
  tone = "info",
  icon,
  children,
}: {
  tone?: "info" | "warn" | "ok" | "danger";
  icon?: ReactNode;
  children: ReactNode;
}) {
  const c = {
    info: "border-accent/20 bg-accent/[0.06] text-accent",
    warn: "border-warn/25 bg-warn/[0.07] text-warn",
    ok: "border-ok/25 bg-ok/[0.07] text-ok",
    danger: "border-danger/25 bg-danger/[0.07] text-danger",
  }[tone];
  return (
    <div className={`flex gap-2.5 rounded-[10px] border px-[13px] py-[11px] text-[13px] leading-[1.45] ${c}`}>
      {icon && <span className="mt-px flex-none">{icon}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** A panel with the prototype's card-h header (title + flexible right side). */
export function Panel({
  title,
  sub,
  right,
  children,
  bordered,
  className = "",
}: {
  title?: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  bordered?: boolean;
  className?: string;
}) {
  return (
    <div className={`relative overflow-hidden rounded-xl border border-line bg-panel shadow-card ${className}`}>
      {(title || right) && (
        <div className={`flex flex-wrap items-center gap-3 px-5 py-4 ${bordered ? "border-b border-line" : ""}`}>
          {title && (
            <div className="min-w-0">
              <h3 className="m-0 text-[15px] font-semibold tracking-[-0.015em] text-ink">{title}</h3>
              {sub && <p className="m-0 mt-0.5 text-[13px] text-muted">{sub}</p>}
            </div>
          )}
          {right && <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">{right}</div>}
        </div>
      )}
      {children}
    </div>
  );
}
