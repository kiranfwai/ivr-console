"use client";

/**
 * Shared layout pieces for the two "send to a list" screens (Bulk calls and
 * Bulk WhatsApp): numbered steps, the sticky summary, the file chip, stat
 * tiles, callouts, a stacked progress bar and the confirm-before-send modal.
 * Presentation only — no data fetching lives here.
 */

import type { ReactNode } from "react";
import { Check, FileSpreadsheet, Info, AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { Card, Modal } from "./ui";

/* ---------- Segmented control ---------- */
export function Seg<T extends string>({
  value,
  onChange,
  options,
  className = "",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number }[];
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={`inline-flex gap-0.5 rounded-[10px] border border-line2 bg-ink/[0.04] p-[3px] ${className}`}
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.value)}
            className={`flex h-7 items-center gap-1.5 rounded-[7px] px-[11px] text-[13px] font-medium transition-colors ${
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

/* ---------- Steps + sticky summary ---------- */
export function StepsLayout({ steps, summary }: { steps: ReactNode; summary: ReactNode }) {
  return (
    <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
      <div className="relative overflow-hidden rounded-xl border border-line bg-panel shadow-card">{steps}</div>
      <div className="lg:sticky lg:top-[76px]">{summary}</div>
    </div>
  );
}

export function Step({
  n,
  done,
  title,
  description,
  children,
}: {
  n: number;
  done?: boolean;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex gap-4 px-4 py-5 sm:px-[22px] [&+&]:border-t [&+&]:border-line2">
      <div
        className={`grid h-7 w-7 flex-none place-items-center rounded-full border-[1.5px] text-[12.5px] font-semibold ${
          done ? "border-brand bg-brand text-onbrand" : "border-line2 bg-panel text-muted"
        }`}
      >
        {done ? <Check size={14} strokeWidth={2.5} /> : n}
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="mb-0.5 mt-[3px] text-[14.5px] font-semibold tracking-[-0.015em] text-ink">{title}</h4>
        {description && <p className="mb-3.5 text-[13px] text-muted">{description}</p>}
        {children}
      </div>
    </div>
  );
}

export function SummaryCard({ children }: { children: ReactNode }) {
  return (
    <Card noPadding>
      <div className="border-b border-line px-5 py-4 text-[15px] font-semibold tracking-[-0.015em]">Summary</div>
      <div className="px-5 pb-5 pt-2">{children}</div>
    </Card>
  );
}

export function SumRow({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: "warn" | "muted" }) {
  const c = tone === "warn" ? "text-warn" : tone === "muted" ? "text-muted" : "text-ink";
  return (
    <div className="flex items-center justify-between gap-3 py-[11px] text-[13.5px] [&+&]:border-t [&+&]:border-dashed [&+&]:border-line2">
      <span className="text-muted">{label}</span>
      <b className={`font-semibold tabular-nums ${c}`}>{value}</b>
    </div>
  );
}

export function SumTotal({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="mt-1 flex items-baseline justify-between border-t border-line pb-1 pt-3.5">
      <span className="text-muted">{label}</span>
      <b className="text-[26px] font-semibold tracking-[-0.04em] tabular-nums">{value}</b>
    </div>
  );
}

/* ---------- File chip + readiness chips ---------- */
export function FileChip({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mt-3 flex items-center gap-3 rounded-[11px] border border-line bg-panel px-3 py-2.5">
      <div className="grid h-9 w-9 flex-none place-items-center rounded-[9px] border border-ok/25 bg-ok/10 text-ok">
        <FileSpreadsheet size={17} />
      </div>
      <div className="min-w-0 flex-1">
        <b className="block truncate text-[13.5px] font-semibold">{title}</b>
        {sub && <div className="text-xs text-muted">{sub}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1.5">{action}</div>}
    </div>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>;
}

/* ---------- Callout ---------- */
export function Callout({ tone = "info", children, className = "" }: { tone?: "info" | "warn" | "danger" | "ok"; children: ReactNode; className?: string }) {
  const cls = {
    info: "bg-accent/[0.06] border-accent/20 text-ink2",
    warn: "bg-warn/[0.08] border-warn/25 text-ink2",
    danger: "bg-danger/[0.07] border-danger/25 text-ink2",
    ok: "bg-ok/[0.08] border-ok/25 text-ink2",
  }[tone];
  const icon = {
    info: <Info size={15} className="text-accent" />,
    warn: <AlertTriangle size={15} className="text-warn" />,
    danger: <XCircle size={15} className="text-danger" />,
    ok: <CheckCircle2 size={15} className="text-ok" />,
  }[tone];
  return (
    <div className={`flex gap-2.5 rounded-[10px] border px-[13px] py-[11px] text-[13px] leading-[1.45] ${cls} ${className}`}>
      <span className="mt-px flex-none">{icon}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ---------- Stat tiles ---------- */
export type StatTone = "plain" | "accent" | "ok" | "warn" | "danger";

export function StatTiles({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">{children}</div>;
}

export function StatTile({ label, value, tone = "plain" }: { label: string; value: number | string; tone?: StatTone }) {
  const c = { plain: "text-ink", accent: "text-accent", ok: "text-ok", warn: "text-warn", danger: "text-danger" }[tone];
  return (
    <div className="rounded-[10px] border border-line2 bg-elev px-3.5 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tracking-[-0.03em] tabular-nums ${c}`}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

/* ---------- Stacked progress bar ---------- */
export function Prog({
  parts,
  total,
  height = "h-2",
  title,
}: {
  parts: { value: number; cls: string }[];
  total: number;
  height?: string;
  title?: string;
}) {
  return (
    <div className={`flex w-full gap-[2px] overflow-hidden rounded-full bg-line ${height}`} title={title}>
      {parts.map((p, i) =>
        p.value > 0 && total > 0 ? (
          <i
            key={i}
            className={`block h-full transition-[width] duration-500 ${p.cls}`}
            style={{ width: `${Math.min(100, (p.value / total) * 100)}%` }}
          />
        ) : null,
      )}
    </div>
  );
}

/* ---------- Confirm modal (icon, title, text, facts, two buttons) ---------- */
export function ConfirmSendModal({
  open,
  icon,
  tone = "accent",
  title,
  body,
  facts,
  extra,
  actions,
  onClose,
}: {
  open: boolean;
  icon: ReactNode;
  tone?: "accent" | "warn" | "danger";
  title: ReactNode;
  body?: ReactNode;
  facts?: [ReactNode, ReactNode][];
  extra?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  const iconCls = {
    accent: "bg-accent/10 text-accent border-accent/20",
    warn: "bg-warn/10 text-warn border-warn/25",
    danger: "bg-danger/10 text-danger border-danger/25",
  }[tone];
  return (
    <Modal open={open} onClose={onClose} maxWidth="max-w-[460px]" footer={actions}>
      <div className={`mb-4 grid h-[46px] w-[46px] place-items-center rounded-[13px] border ${iconCls}`}>{icon}</div>
      <h3 className="mb-1.5 text-lg font-semibold tracking-[-0.025em] text-ink">{title}</h3>
      {body && <div className="text-sm text-muted">{body}</div>}
      {facts && facts.length > 0 && (
        <div className="mt-[18px] overflow-hidden rounded-[10px] border border-line">
          {facts.map(([k, v], i) => (
            <div key={i} className="flex justify-between gap-3 border-b border-line2 px-3 py-2.5 text-[13px] last:border-b-0">
              <span className="text-muted">{k}</span>
              <b className="text-right font-semibold text-ink">{v}</b>
            </div>
          ))}
        </div>
      )}
      {extra}
    </Modal>
  );
}

/** Equal-width footer buttons, like the prototype's confirm modal. */
export function ModalActions({ children }: { children: ReactNode }) {
  return <div className="flex w-full flex-wrap gap-2.5 [&>*]:flex-1">{children}</div>;
}
