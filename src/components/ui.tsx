"use client";

import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
  useEffect,
  useState,
} from "react";
import { Check, X, AlertCircle, Info, Inbox, Upload } from "lucide-react";

/* -------------------- Button -------------------- */
type Variant = "primary" | "ghost" | "danger" | "outline" | "subtle";
type Size = "sm" | "md" | "lg";

export function Button({
  variant = "primary",
  size = "md",
  leftIcon,
  rightIcon,
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
}) {
  const base =
    "inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-all duration-150 " +
    "disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-brand/40 active:scale-[0.98] whitespace-nowrap";
  const variantCls = {
    primary: "bg-brand text-bg hover:bg-brand/90 shadow-card",
    ghost: "bg-elev/60 border border-line text-ink hover:bg-elev hover:border-line2",
    outline: "border border-line text-ink hover:bg-elev hover:border-line2",
    subtle: "text-ink2 hover:text-ink hover:bg-elev/60",
    danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
  }[variant];
  const sizeCls = {
    sm: "px-2.5 py-1.5 text-xs",
    md: "px-3.5 py-2 text-sm",
    lg: "px-4 py-2.5 text-sm",
  }[size];
  return (
    <button
      className={`${base} ${variantCls} ${sizeCls} ${className}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={size === "sm" ? 12 : 14} /> : leftIcon}
      {children}
      {!loading && rightIcon}
    </button>
  );
}

export function IconButton({
  icon,
  variant = "subtle",
  size = "md",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  variant?: Variant;
  size?: Size;
}) {
  const base =
    "inline-flex items-center justify-center rounded-lg transition-all duration-150 " +
    "disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 " +
    "focus-visible:ring-brand/40 active:scale-[0.95]";
  const variantCls = {
    primary: "bg-brand text-bg hover:bg-brand/90",
    ghost: "bg-elev/60 border border-line text-ink hover:bg-elev",
    outline: "border border-line text-ink hover:bg-elev",
    subtle: "text-ink2 hover:text-ink hover:bg-elev/60",
    danger: "text-danger hover:bg-danger/10",
  }[variant];
  const sizeCls = { sm: "p-1.5", md: "p-2", lg: "p-2.5" }[size];
  return <button className={`${base} ${variantCls} ${sizeCls} ${className}`} {...rest}>{icon}</button>;
}

/* -------------------- Inputs -------------------- */
export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full bg-bg/60 border border-line rounded-lg px-3 py-2 text-sm outline-none transition-colors
        placeholder:text-muted hover:border-line2 focus:border-brand/60 focus:bg-bg ${className}`}
      {...rest}
    />
  );
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full bg-bg/60 border border-line rounded-lg px-3 py-2 text-sm font-mono outline-none transition-colors
        placeholder:text-muted hover:border-line2 focus:border-brand/60 focus:bg-bg ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full bg-bg/60 border border-line rounded-lg px-3 py-2 text-sm outline-none transition-colors
        hover:border-line2 focus:border-brand/60 focus:bg-bg cursor-pointer ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Label({ children, hint }: { children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <div className="text-xs font-medium text-ink2 uppercase tracking-wider">{children}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

/* -------------------- Card / Surface -------------------- */
export function Card({
  children,
  className = "",
  title,
  description,
  action,
  noPadding,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  noPadding?: boolean;
}) {
  return (
    <div
      className={`bg-panel border border-line rounded-2xl shadow-card ${
        noPadding ? "" : "p-5"
      } ${className}`}
    >
      {(title || action) && (
        <div className={`flex items-start justify-between gap-3 ${noPadding ? "p-5 pb-3" : "mb-4"}`}>
          <div className="min-w-0">
            {title && <div className="font-semibold text-ink">{title}</div>}
            {description && <div className="text-xs text-muted mt-0.5">{description}</div>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </div>
  );
}

export function Section({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`space-y-4 animate-slide-up ${className}`}>{children}</div>;
}

/* -------------------- Badges & status pills -------------------- */
type Tone = "muted" | "ok" | "warn" | "danger" | "accent" | "info";

export function Badge({
  tone = "muted",
  children,
  dot,
  className = "",
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
}) {
  const c = {
    muted: "bg-line/60 text-ink2 border-line",
    ok: "bg-ok/10 text-ok border-ok/25",
    warn: "bg-warn/10 text-warn border-warn/25",
    danger: "bg-danger/10 text-danger border-danger/25",
    accent: "bg-brand/10 text-brand border-brand/25",
    info: "bg-info/10 text-info border-info/25",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs border ${c} ${className}`}>
      {dot && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse2" />}
      {children}
    </span>
  );
}

/* -------------------- KPI cards -------------------- */
export function KPI({
  label,
  value,
  sub,
  icon,
  trend,
  tone = "muted",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  trend?: "up" | "down" | "flat";
  tone?: Tone;
}) {
  const iconBg = {
    muted: "bg-elev text-ink2",
    ok: "bg-ok/10 text-ok",
    warn: "bg-warn/10 text-warn",
    danger: "bg-danger/10 text-danger",
    accent: "bg-brand/10 text-brand",
    info: "bg-info/10 text-info",
  }[tone];
  return (
    <Card className="hover:border-line2 transition-colors">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
          <div className="text-3xl font-semibold mt-1 tabular-nums">{value}</div>
          {sub && (
            <div className="text-xs text-muted mt-1 flex items-center gap-1">
              {sub}
              {trend === "up" && <span className="text-ok">↑</span>}
              {trend === "down" && <span className="text-danger">↓</span>}
            </div>
          )}
        </div>
        {icon && (
          <div className={`shrink-0 w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------- File picker -------------------- */
export function CsvFilePicker({ onLoad }: { onLoad: (text: string) => void }) {
  const [fileName, setFileName] = useState<string>("");
  return (
    <label className="cursor-pointer px-2.5 py-1.5 rounded-md bg-elev/80 hover:bg-elev border border-line hover:border-line2 text-ink inline-flex items-center gap-1.5 text-xs transition-colors">
      <Upload size={12} />
      <span>{fileName || "Choose CSV"}</span>
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          const text = await f.text();
          setFileName(f.name);
          onLoad(text);
        }}
      />
    </label>
  );
}

/* -------------------- Empty state -------------------- */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="w-12 h-12 rounded-xl bg-elev border border-line flex items-center justify-center text-muted mb-3">
        {icon || <Inbox size={20} />}
      </div>
      <div className="text-sm font-medium text-ink">{title}</div>
      {description && <div className="text-xs text-muted mt-1 max-w-sm">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* -------------------- Skeleton loader -------------------- */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return (
    <div className={`bg-elev/60 rounded-md animate-pulse ${className}`} />
  );
}

/* -------------------- Spinner -------------------- */
export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="animate-spin"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------- Toasts -------------------- */
type Toast = { id: number; tone: "ok" | "danger" | "info"; text: string };
let toastCounter = 1;
const listeners = new Set<(t: Toast) => void>();

export function toast(text: string, tone: Toast["tone"] = "info") {
  const t: Toast = { id: toastCounter++, tone, text };
  listeners.forEach((fn) => fn(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const fn = (t: Toast) => {
      setItems((prev) => [...prev, t]);
      setTimeout(() => setItems((prev) => prev.filter((p) => p.id !== t.id)), 4000);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50 pointer-events-none">
      {items.map((t) => {
        const Icon = t.tone === "ok" ? Check : t.tone === "danger" ? AlertCircle : Info;
        const cls = t.tone === "ok"
          ? "bg-ok/10 text-ok border-ok/30"
          : t.tone === "danger"
          ? "bg-danger/10 text-danger border-danger/30"
          : "bg-panel text-ink border-line";
        return (
          <div
            key={t.id}
            className={`px-3 py-2.5 rounded-lg shadow-elev border text-sm flex items-center gap-2 animate-slide-up pointer-events-auto backdrop-blur ${cls}`}
          >
            <Icon size={16} />
            {t.text}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------- Modal -------------------- */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = "max-w-xl",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${maxWidth} bg-panel border border-line rounded-2xl shadow-elev animate-slide-up`}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <div className="font-semibold">{title}</div>
            <IconButton icon={<X size={16} />} onClick={onClose} />
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
