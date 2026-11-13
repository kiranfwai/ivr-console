"use client";

import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { Check, X, AlertCircle, Info, Inbox, Upload } from "lucide-react";

/* -------------------- Field messages (shared) -------------------- */
function FieldMessages({ error, hint }: { error?: string; hint?: string }) {
  if (!error && !hint) return null;
  return error ? (
    <div className="mt-1 text-xs text-danger flex items-center gap-1">
      <AlertCircle size={12} />
      {error}
    </div>
  ) : (
    <div className="mt-1 text-xs text-muted">{hint}</div>
  );
}

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
    "inline-flex items-center justify-center gap-2 font-semibold rounded-[9px] border transition-[background-color,border-color,color,box-shadow,transform] duration-150 " +
    "disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:shadow-glow " +
    "active:translate-y-px whitespace-nowrap";
  // One main action per screen (navy in light, off-white in dark); everything
  // else is a quiet white/outlined button.
  const variantCls = {
    primary: "bg-brand text-onbrand border-transparent shadow-xs hover:bg-brand/90",
    ghost: "bg-panel text-ink border-line shadow-xs hover:bg-elev hover:border-line2",
    outline: "bg-panel text-ink border-line shadow-xs hover:bg-elev hover:border-line2",
    subtle: "bg-transparent text-ink2 border-transparent hover:text-ink hover:bg-ink/[0.05]",
    danger: "bg-panel text-danger border-danger/30 shadow-xs hover:bg-danger/[0.07]",
  }[variant];
  const sizeCls = {
    sm: "h-[30px] px-2.5 text-[12.5px]",
    md: "h-9 px-3.5 text-[13.5px]",
    lg: "h-[42px] px-[18px] text-sm",
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
  "aria-label": ariaLabel,
  title,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  variant?: Variant;
  size?: Size;
}) {
  const base =
    "inline-flex items-center justify-center rounded-[9px] transition-colors duration-150 " +
    "disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:shadow-glow " +
    "active:translate-y-px";
  const variantCls = {
    primary: "bg-brand text-onbrand hover:bg-brand/90",
    ghost: "bg-panel border border-line text-ink hover:bg-elev",
    outline: "bg-panel border border-line text-ink hover:bg-elev",
    subtle: "text-muted hover:text-ink hover:bg-ink/[0.05]",
    danger: "text-danger hover:bg-danger/10",
  }[variant];
  const sizeCls = { sm: "p-1.5", md: "p-2", lg: "p-2.5" }[size];
  return (
    <button
      className={`${base} ${variantCls} ${sizeCls} ${className}`}
      aria-label={ariaLabel ?? title}
      title={title}
      {...rest}
    >
      {icon}
    </button>
  );
}

/* -------------------- Inputs -------------------- */
export function Input({
  className = "",
  error,
  invalid,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { error?: string; invalid?: boolean; hint?: string }) {
  // `invalid` marks a field that is merely still empty — red border, no message,
  // because "Required" under every blank box is noise next to a red asterisk.
  const borderCls = error || invalid
    ? "border-danger/60 focus:border-danger"
    : "border-line hover:border-line2 focus:border-accent focus:shadow-glow";
  return (
    <div>
      <input
        aria-invalid={error || invalid ? true : undefined}
        className={`w-full bg-panel border rounded-[9px] px-3 py-2 text-sm text-ink outline-none shadow-xs transition-[border-color,box-shadow]
          placeholder:text-muted ${borderCls} ${className}`}
        {...rest}
      />
      <FieldMessages error={error} hint={hint} />
    </div>
  );
}

export function Textarea({
  className = "",
  error,
  hint,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string; hint?: string }) {
  const borderCls = error
    ? "border-danger/60 focus:border-danger"
    : "border-line hover:border-line2 focus:border-accent focus:shadow-glow";
  return (
    <div>
      <textarea
        aria-invalid={error ? true : undefined}
        className={`w-full bg-panel border rounded-[9px] px-3 py-2.5 text-sm text-ink leading-relaxed outline-none shadow-xs transition-[border-color,box-shadow]
          placeholder:text-muted ${borderCls} ${className}`}
        {...rest}
      />
      <FieldMessages error={error} hint={hint} />
    </div>
  );
}

export function Select({
  className = "",
  children,
  error,
  invalid,
  hint,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { error?: string; invalid?: boolean; hint?: string }) {
  const borderCls = error || invalid
    ? "border-danger/60 focus:border-danger"
    : "border-line hover:border-line2 focus:border-accent focus:shadow-glow";
  return (
    <div>
      <select
        aria-invalid={error || invalid ? true : undefined}
        className={`w-full bg-panel border rounded-[9px] px-3 py-2 text-sm text-ink outline-none shadow-xs transition-[border-color,box-shadow]
          cursor-pointer ${borderCls} ${className}`}
        {...rest}
      >
        {children}
      </select>
      <FieldMessages error={error} hint={hint} />
    </div>
  );
}

export function Label({
  children,
  hint,
  required,
}: {
  children: ReactNode;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <div className="text-[13px] font-medium text-ink2">
        {children}
        {required && <span className="text-danger ml-0.5" aria-hidden="true">*</span>}
      </div>
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
      className={
        // White card on the soft grey canvas (light) / one step up from the
        // canvas with a hairline edge (dark). Firm border + soft shadow so the
        // card never melts into the page.
        "relative bg-panel border border-line rounded-xl shadow-card " +
        `${noPadding ? "" : "p-5"} ${className}`
      }
    >
      {(title || action) && (
        <div className={`flex flex-wrap items-start gap-3 ${noPadding ? "p-5 pb-3" : "mb-4"}`}>
          <div className="min-w-0 flex-1">
            {title && <div className="text-[15px] font-semibold tracking-[-0.015em] text-ink">{title}</div>}
            {description && <div className="text-[13px] text-muted mt-0.5">{description}</div>}
          </div>
          {action && <div className="w-full sm:w-auto shrink-0">{action}</div>}
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
  // Drawn with an inner ring rather than a hard border, matching the tags on the
  // landing page — softer edge, same information.
  const c = {
    muted: "bg-elev text-ink2 border-line",
    ok: "bg-ok/[0.09] text-ok border-ok/25",
    warn: "bg-warn/[0.09] text-warn border-warn/25",
    danger: "bg-danger/[0.08] text-danger border-danger/25",
    accent: "bg-accent/[0.09] text-accent border-accent/25",
    info: "bg-info/[0.09] text-info border-info/25",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 h-[22px] px-2 rounded-full border text-xs font-medium whitespace-nowrap ${c} ${className}`}>
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
    accent: "bg-accent/10 text-accent",
    info: "bg-info/10 text-info",
  }[tone];
  return (
    <Card className="hover:shadow-pop transition-shadow">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-muted">{label}</div>
          <div className="text-[28px] font-semibold tracking-[-0.035em] mt-1.5 leading-tight tabular-nums">{value}</div>
          {sub && (
            <div className="text-xs text-muted mt-1 flex items-center gap-1">
              {sub}
              {trend === "up" && <span className="text-ok">↑</span>}
              {trend === "down" && <span className="text-danger">↓</span>}
            </div>
          )}
        </div>
        {icon && (
          <div className={`shrink-0 w-9 h-9 rounded-[9px] ${iconBg} flex items-center justify-center`}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}

/* -------------------- File picker -------------------- */
// Big CSVs (20–30k rows) take a moment to read off disk; show a real progress
// bar driven by FileReader's onprogress so the upload never looks frozen (BUG 4).
export function CsvFilePicker({ onLoad }: { onLoad: (text: string) => void }) {
  const [fileName, setFileName] = useState<string>("");
  const [dragOver, setDragOver] = useState(false);
  const [progress, setProgress] = useState<number | null>(null); // 0–100 while reading, null idle

  function readWithProgress(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onprogress = (e) => {
        if (e.lengthComputable) setProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      };
      reader.onload = () => resolve(String(reader.result ?? ""));
      reader.onerror = () => reject(reader.error ?? new Error("read failed"));
      reader.readAsText(f);
    });
  }

  async function handleFile(f: File | undefined | null) {
    if (!f) return;
    setFileName(f.name);
    const LARGE = 512 * 1024; // 512 KB ≈ a few thousand rows
    try {
      let text: string;
      if (f.size > LARGE) {
        setProgress(0);
        text = await readWithProgress(f);
        setProgress(100);
      } else {
        text = await f.text();
      }
      onLoad(text);
    } catch {
      toast("Could not read that file", "danger");
    } finally {
      // Let 100% show briefly, then clear.
      setTimeout(() => setProgress(null), 400);
    }
  }

  const reading = progress !== null;
  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        handleFile(e.dataTransfer.files?.[0]);
      }}
      className={`relative overflow-hidden cursor-pointer h-[30px] px-2.5 rounded-[8px] border text-ink inline-flex items-center gap-1.5 text-[12.5px] font-semibold shadow-xs transition-colors ${
        dragOver
          ? "bg-accent/10 border-accent/40"
          : "bg-panel hover:bg-elev border-line hover:border-line2"
      }`}
    >
      {reading && (
        <span
          className="absolute inset-y-0 left-0 bg-accent/15 transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
      )}
      <Upload size={12} className="relative" />
      <span className="relative tabular-nums">
        {reading ? `Reading… ${progress}%` : fileName || (dragOver ? "Drop CSV here" : "Choose CSV")}
      </span>
      <input
        type="file"
        accept=".csv,text/csv,text/plain"
        className="hidden"
        disabled={reading}
        onChange={(e) => handleFile(e.target.files?.[0])}
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
      <div className="w-11 h-11 rounded-xl bg-elev border border-line flex items-center justify-center text-muted mb-3">
        {icon || <Inbox size={20} />}
      </div>
      <div className="text-sm font-semibold text-ink">{title}</div>
      {description && <div className="text-[13px] text-muted mt-1 max-w-sm">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* -------------------- Loading state -------------------- */
/**
 * What a screen shows while its first request is in flight.
 *
 * It exists so that "we don't know yet" never looks like "there is nothing
 * here". Sized to roughly the height of EmptyState so the panel doesn't jump
 * when the real answer arrives and one replaces the other.
 */
export function Loading({ label, py = "py-12" }: { label?: string; py?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center ${py} px-4 text-center text-muted`}>
      <Spinner size={20} />
      {label && <div className="mt-3 text-xs">{label}</div>}
    </div>
  );
}

/* -------------------- Skeleton loader -------------------- */
export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return (
    <div className={`bg-ink/[0.06] rounded-md animate-pulse ${className}`} />
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
type Toast = { id: number; tone: "ok" | "danger" | "info"; text: string; duration: number };
let toastCounter = 1;
const listeners = new Set<(t: Toast) => void>();

export function toast(
  text: string,
  tone: Toast["tone"] = "info",
  duration = 4000,
) {
  const t: Toast = { id: toastCounter++, tone, text, duration };
  listeners.forEach((fn) => fn(t));
}

export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  // Track per-toast remaining time and timers so we can pause/resume on hover.
  const timers = useRef<Map<number, { handle: ReturnType<typeof setTimeout>; remaining: number; start: number }>>(
    new Map(),
  );

  const dismiss = (id: number) => {
    const entry = timers.current.get(id);
    if (entry) clearTimeout(entry.handle);
    timers.current.delete(id);
    setItems((prev) => prev.filter((p) => p.id !== id));
  };

  const schedule = (id: number, ms: number) => {
    const handle = setTimeout(() => dismiss(id), ms);
    timers.current.set(id, { handle, remaining: ms, start: Date.now() });
  };

  const pause = (id: number) => {
    const entry = timers.current.get(id);
    if (!entry) return;
    clearTimeout(entry.handle);
    entry.remaining = Math.max(0, entry.remaining - (Date.now() - entry.start));
  };

  const resume = (id: number) => {
    const entry = timers.current.get(id);
    if (!entry) return;
    schedule(id, entry.remaining);
  };

  useEffect(() => {
    const fn = (t: Toast) => {
      setItems((prev) => [...prev, t]);
      schedule(t.id, t.duration);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      timers.current.forEach((e) => clearTimeout(e.handle));
      timers.current.clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="fixed bottom-4 right-4 space-y-2 z-50 pointer-events-none">
      {items.map((t) => {
        const Icon = t.tone === "ok" ? Check : t.tone === "danger" ? AlertCircle : Info;
        const cls = "bg-panel text-ink border-line";
        const icCls = t.tone === "ok" ? "bg-ok/10 text-ok" : t.tone === "danger" ? "bg-danger/10 text-danger" : "bg-accent/10 text-accent";
        return (
          <div
            key={t.id}
            role="status"
            onMouseEnter={() => pause(t.id)}
            onMouseLeave={() => resume(t.id)}
            className={`max-w-sm pl-2.5 pr-4 py-2.5 rounded-xl shadow-pop border text-[13.5px] flex items-center gap-2.5 animate-slide-up pointer-events-auto ${cls}`}
          >
            <span className={`w-7 h-7 shrink-0 rounded-full grid place-items-center ${icCls}`}><Icon size={15} /></span>
            {t.text}
          </div>
        );
      })}
    </div>
  );
}

/* -------------------- Modal -------------------- */
const MODAL_SIZES = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl" } as const;

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    // Move focus into the dialog on open.
    const prevFocus = document.activeElement as HTMLElement | null;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => !el.hasAttribute("disabled"));
    (focusables()[0] ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab") {
        const els = focusables();
        if (els.length === 0) return;
        const first = els[0];
        const last = els[els.length - 1];
        const activeEl = document.activeElement;
        if (e.shiftKey && activeEl === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  const widthCls = maxWidth ?? MODAL_SIZES[size];
  return (
    <div
      className="fixed inset-0 z-40 bg-scrim/50 backdrop-blur-[3px] flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${widthCls} bg-panel border border-line rounded-2xl shadow-pop animate-slide-up outline-none max-h-[calc(100vh-2rem)] flex flex-col`}
      >
        {title && (
          <div className="flex items-center justify-between px-6 py-4 border-b border-line">
            <div className="text-[17px] font-semibold tracking-[-0.02em]">{title}</div>
            <IconButton icon={<X size={16} />} onClick={onClose} aria-label="Close dialog" />
          </div>
        )}
        <div className="p-6 overflow-y-auto">{children}</div>
        {footer && <div className="px-6 py-3.5 border-t border-line bg-elev/60 rounded-b-2xl flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ==================================================================
   Shared list-screen furniture
   ------------------------------------------------------------------
   Every screen that shows "many of a thing" now uses the same three
   pieces, so Campaigns, Audios, Sheets, Batches and Clients stop each
   inventing their own layout:

     <Tiles>      four headline numbers answering "is this healthy?"
     <DataPanel>  a titled surface holding a scannable table
     <Kebab>      per-row actions, collapsed behind a single ··· button

   and <ConfirmDialog> replaces the browser's plain grey confirm(),
   which three screens were still using.
   ================================================================== */

export function Tiles({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 ${className}`}>{children}</div>
  );
}

export function Tile({
  label,
  value,
  sub,
  tone = "muted",
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Colours only the sub-line — the value itself always stays plain. */
  tone?: "muted" | "ok" | "warn" | "danger";
}) {
  const subCls = {
    muted: "text-muted",
    ok: "text-ok",
    warn: "text-warn",
    danger: "text-danger",
  }[tone];
  return (
    <div className="rounded-xl border border-line bg-panel px-5 py-4 shadow-card">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className="mt-1.5 text-[26px] font-semibold tracking-[-0.035em] tabular-nums leading-tight">
        {value}
      </div>
      {sub != null && <div className={`mt-1 text-[12.5px] ${subCls}`}>{sub}</div>}
    </div>
  );
}

export function DataPanel({
  title,
  meta,
  action,
  children,
  footer,
}: {
  title: ReactNode;
  meta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-line bg-panel shadow-card">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-[-0.015em]">{title}</div>
          {meta && <div className="mt-0.5 text-[13px] text-muted">{meta}</div>}
        </div>
        {action && <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
      {children}
      {footer && <div className="border-t border-line px-5 py-3 text-[13px] text-muted">{footer}</div>}
    </div>
  );
}

/** Table styling shared by every DataPanel, so column rhythm matches across screens. */
export const TH =
  "text-left text-xs font-medium text-muted bg-elev px-5 py-2.5 border-y border-line whitespace-nowrap";
export const TD = "px-5 py-3 text-[13.5px] align-middle border-b border-line/70";

export function DataTable({ children, className = "" }: { children: ReactNode; className?: string }) {
  // Wide tables scroll inside their own panel rather than pushing the page sideways.
  return (
    <div className="overflow-x-auto">
      <table className={`w-full border-collapse ${className}`}>{children}</table>
    </div>
  );
}

export interface KebabItem {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
  danger?: boolean;
}

/** Row actions behind a single ··· button, so a row stays readable. */
export function Kebab({ items, label = "Actions" }: { items: KebabItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  // The menu is position:fixed next to its button, so a table that scrolls
  // sideways (overflow-x:auto) can't clip it on the last rows; it opens upward
  // when there isn't room below.
  const [pos, setPos] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  function place() {
    const r = btn.current?.getBoundingClientRect();
    if (!r) return;
    const need = 12 + items.length * 38;
    const right = Math.max(8, window.innerWidth - r.right);
    setPos(window.innerHeight - r.bottom < need && r.top > need
      ? { bottom: window.innerHeight - r.top + 4, right }
      : { top: r.bottom + 4, right });
  }

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  return (
    <div ref={wrap} className="relative inline-block text-left">
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => { if (!open) place(); setOpen((v) => !v); }}
        className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-[8px] text-muted transition-colors hover:text-ink hover:bg-ink/[0.06]"
      >
        <span className="-mt-1 text-base leading-none">···</span>
      </button>
      {open && pos && (
        <div
          role="menu"
          style={{ position: "fixed", top: pos.top, bottom: pos.bottom, right: pos.right }}
          className="z-[45] min-w-[180px] overflow-hidden rounded-xl border border-line bg-panel p-1 shadow-pop animate-fade-in"
        >
          {items.map((it) => (
            <button
              key={it.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={`flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13.5px] transition-colors ${
                it.danger ? "text-danger hover:bg-danger/[0.08]" : "text-ink2 hover:bg-ink/[0.05] hover:text-ink"
              }`}
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One confirmation dialog for the whole app.
 *
 * `typeToConfirm` guards the genuinely unrecoverable actions: the button stays
 * disabled until the exact word is typed. Used for "clear the whole DND list",
 * where the old flow was a browser confirm() one click away from wiping it.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  tone = "danger",
  typeToConfirm,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  typeToConfirm?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const [typed, setTyped] = useState("");
  useEffect(() => {
    if (open) setTyped("");
  }, [open]);

  const ready = !typeToConfirm || typed.trim() === typeToConfirm;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            disabled={!ready}
            loading={busy}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm text-ink2">
        <div>{body}</div>
        {typeToConfirm && (
          <div>
            <Label>
              Type <span className="font-mono text-ink">{typeToConfirm}</span> to confirm
            </Label>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
          </div>
        )}
      </div>
    </Modal>
  );
}
