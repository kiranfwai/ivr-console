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
  "aria-label": ariaLabel,
  title,
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
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { error?: string; hint?: string }) {
  const borderCls = error
    ? "border-danger/60 focus:border-danger"
    : "border-line hover:border-line2 focus:border-brand/60";
  return (
    <div>
      <input
        aria-invalid={error ? true : undefined}
        className={`w-full bg-bg/60 border rounded-lg px-3 py-2 text-sm outline-none transition-colors
          placeholder:text-muted focus:bg-bg ${borderCls} ${className}`}
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
    : "border-line hover:border-line2 focus:border-brand/60";
  return (
    <div>
      <textarea
        aria-invalid={error ? true : undefined}
        className={`w-full bg-bg/60 border rounded-lg px-3 py-2 text-sm font-mono outline-none transition-colors
          placeholder:text-muted focus:bg-bg ${borderCls} ${className}`}
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
  hint,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement> & { error?: string; hint?: string }) {
  const borderCls = error
    ? "border-danger/60 focus:border-danger"
    : "border-line hover:border-line2 focus:border-brand/60";
  return (
    <div>
      <select
        aria-invalid={error ? true : undefined}
        className={`w-full bg-bg/60 border rounded-lg px-3 py-2 text-sm outline-none transition-colors
          focus:bg-bg cursor-pointer ${borderCls} ${className}`}
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
      <div className="text-xs font-medium text-ink2 uppercase tracking-wider">
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
      className={`relative overflow-hidden cursor-pointer px-2.5 py-1.5 rounded-md border text-ink inline-flex items-center gap-1.5 text-xs transition-colors ${
        dragOver
          ? "bg-brand/10 border-brand/40"
          : "bg-elev/80 hover:bg-elev border-line hover:border-line2"
      }`}
    >
      {reading && (
        <span
          className="absolute inset-y-0 left-0 bg-brand/20 transition-[width] duration-150"
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
        const cls = t.tone === "ok"
          ? "bg-ok/10 text-ok border-ok/30"
          : t.tone === "danger"
          ? "bg-danger/10 text-danger border-danger/30"
          : "bg-panel text-ink border-line";
        return (
          <div
            key={t.id}
            role="status"
            onMouseEnter={() => pause(t.id)}
            onMouseLeave={() => resume(t.id)}
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
      className="fixed inset-0 z-40 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${widthCls} bg-panel border border-line rounded-2xl shadow-elev animate-slide-up outline-none`}
      >
        {title && (
          <div className="flex items-center justify-between px-5 py-4 border-b border-line">
            <div className="font-semibold">{title}</div>
            <IconButton icon={<X size={16} />} onClick={onClose} aria-label="Close dialog" />
          </div>
        )}
        <div className="p-5">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
