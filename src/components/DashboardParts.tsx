"use client";

import { ReactNode, useId } from "react";

/**
 * Small presentational pieces shared by the Dashboard, Dial and Scheduled
 * screens (the prototype's `.seg`, `.spark`, `.cav`, `.minibar`, `.card-h`).
 * Theme tokens only, so light and dark both work.
 */

/** Segmented control. `count` renders the small grey number after the label. */
export function Seg<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: ReactNode; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] border border-line2 bg-ink/[0.05] p-[3px]">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            className={`flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-[11px] text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-glow ${
              on ? "bg-panel text-ink shadow-xs" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
            {o.count != null && <span className="text-[11.5px] font-medium tabular-nums text-muted">{o.count.toLocaleString()}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Card header in the prototype's `.card-h` shape: title + sub on the left, actions on the right. */
export function CardHead({
  title,
  sub,
  right,
  border,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  border?: boolean;
}) {
  return (
    <div className={`flex flex-wrap items-center gap-3 px-5 py-4 ${border ? "border-b border-line" : ""}`}>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-ink">{title}</h3>
        {sub && <p className="mt-0.5 text-[13px] text-muted">{sub}</p>}
      </div>
      {right && <div className="flex shrink-0 flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

/** Plain card shell (no padding) for screens that lay out their own header/body. */
export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`relative overflow-hidden rounded-xl border border-line bg-panel shadow-card ${className}`}>{children}</div>;
}

/**
 * Area sparkline across the bottom of a KPI card. Values are real data points;
 * nothing is drawn for fewer than 3 of them (a 1–2 point "trend" is noise).
 */
export function Spark({ values, color }: { values: number[]; color: string }) {
  const gid = `sp${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  if (values.length < 3) return <div className="mt-2.5 h-[46px]" aria-hidden />;
  const mn = Math.min(...values);
  const mx = Math.max(...values);
  const pts = values.map((y, i) => [(i / (values.length - 1)) * 100, 27 - ((y - mn) / (mx - mn || 1)) * 22]);
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return (
    <svg className="-mx-[18px] mt-2.5 block h-[46px] w-[calc(100%+36px)]" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity={0.22} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={`${d} L100 30 L0 30Z`} fill={`url(#${gid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
    </svg>
  );
}

const AV_TONES = [
  "bg-accent/10 text-accent",
  "bg-ok/10 text-ok",
  "bg-warn/10 text-warn",
  "bg-info/10 text-info",
  "bg-brand2/15 text-ink2",
];

/** Initials tile (prototype `.cav`), colour picked from the name so it is stable. */
export function Avatar({ name }: { name: string }) {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const initials = ((words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "")).toUpperCase();
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return (
    <div className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] text-xs font-semibold ${AV_TONES[h % AV_TONES.length]}`}>
      {initials}
    </div>
  );
}

/** A 70px share bar with the percentage beside it (prototype `.minibar`). */
export function MiniBar({ share, label }: { share: number; label: string }) {
  return (
    <div className="flex items-center justify-end gap-2.5">
      <span className="block h-[5px] w-[70px] overflow-hidden rounded-full bg-line2">
        <i className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, share * 100))}%` }} />
      </span>
      <b className="w-11 text-right font-medium tabular-nums">{label}</b>
    </div>
  );
}

/** "in 4 hours" / "3 days ago" relative to now. */
export function relTime(iso: string): string {
  const diff = Date.parse(iso) - Date.now();
  if (!isFinite(diff)) return "";
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  let s: string;
  if (mins < 1) return diff >= 0 ? "any moment" : "just now";
  if (mins < 60) s = `${mins} min`;
  else if (mins < 60 * 36) {
    const h = Math.round(mins / 60);
    s = `${h} hour${h === 1 ? "" : "s"}`;
  } else {
    const d = Math.round(mins / 1440);
    s = `${d} day${d === 1 ? "" : "s"}`;
  }
  return diff >= 0 ? `in ${s}` : `${s} ago`;
}
