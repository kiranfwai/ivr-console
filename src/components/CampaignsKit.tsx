"use client";

/**
 * Small pieces shared by the Campaigns, Audios, Phone numbers and Do-not-disturb
 * screens: the segmented filter, search field, numbered pager, initials avatar,
 * right-side drawer, one shared audio player and decorative waveform bars.
 * Tokens only, so light and dark both work.
 */

import { ReactNode, useEffect, useRef, useState } from "react";
import { Search, X, Play, Pause } from "lucide-react";
import { IconButton, toast } from "./ui";

/* -------------------- Segmented filter -------------------- */
export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  count?: number;
  /** Tailwind bg class for a small coloured dot before the label. */
  dot?: string;
}

export function Seg<T extends string>({
  options,
  value,
  onChange,
  className = "",
  ariaLabel,
}: {
  options: SegOption<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex max-w-full flex-wrap gap-0.5 rounded-[10px] border border-line bg-ink/[0.04] p-[3px] ${className}`}
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
            className={`flex h-7 items-center gap-1.5 rounded-[7px] px-[11px] text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:shadow-glow ${
              on ? "bg-panel text-ink shadow-xs" : "text-muted hover:text-ink"
            }`}
          >
            {o.dot && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${o.dot}`} />}
            {o.label}
            {o.count != null && <span className="text-[11.5px] font-medium text-muted tabular-nums">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------- Search field -------------------- */
export function SearchField({
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
      className={`flex h-9 items-center gap-2 rounded-[9px] border border-line bg-panel px-3 text-sm shadow-xs transition-[border-color,box-shadow] hover:border-line2 focus-within:border-accent focus-within:shadow-glow ${className}`}
    >
      <Search size={14} className="shrink-0 text-muted" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted"
      />
      {value && (
        <button type="button" onClick={() => onChange("")} aria-label="Clear search" className="text-muted hover:text-ink">
          <X size={13} />
        </button>
      )}
    </label>
  );
}

/* -------------------- Numbered pager -------------------- */
function pageList(cur: number, pages: number): (number | "…")[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const set = new Set([0, pages - 1, cur - 1, cur, cur + 1].filter((i) => i >= 0 && i < pages));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - (sorted[i - 1] as number) > 1) out.push("…");
    out.push(n);
  });
  return out;
}

export function Pager({
  page,
  pages,
  from,
  to,
  total,
  onPage,
  disabled,
  extra,
}: {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number;
  onPage: (p: number) => void;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  const btn =
    "inline-flex h-[30px] items-center rounded-[8px] border border-line bg-panel px-2.5 text-[12.5px] font-semibold text-ink shadow-xs transition-colors hover:bg-elev disabled:cursor-not-allowed disabled:opacity-45";
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 text-[13px] text-muted">
      <span>
        {total ? (
          <>
            Showing{" "}
            <b className="font-semibold text-ink tabular-nums">
              {from.toLocaleString()}–{to.toLocaleString()}
            </b>{" "}
            of <span className="tabular-nums">{total.toLocaleString()}</span>
          </>
        ) : (
          "Nothing to show"
        )}
        {extra}
      </span>
      {pages > 1 && (
        <div className="ml-auto flex items-center gap-2">
          <button type="button" className={btn} disabled={disabled || page === 0} onClick={() => onPage(page - 1)}>
            Previous
          </button>
          <div className="hidden gap-0.5 sm:flex">
            {pageList(page, pages).map((p, i) =>
              p === "…" ? (
                <span key={`e${i}`} className="grid h-[30px] min-w-[30px] place-items-center">
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  disabled={disabled}
                  aria-current={p === page ? "page" : undefined}
                  onClick={() => onPage(p)}
                  className={`grid h-[30px] min-w-[30px] place-items-center rounded-[8px] px-1 font-medium tabular-nums transition-colors ${
                    p === page ? "bg-panel text-ink shadow-xs ring-1 ring-line" : "text-muted hover:bg-ink/[0.05]"
                  }`}
                >
                  {p + 1}
                </button>
              ),
            )}
          </div>
          <span className="tabular-nums sm:hidden">
            {page + 1} / {pages}
          </span>
          <button type="button" className={btn} disabled={disabled || page >= pages - 1} onClick={() => onPage(page + 1)}>
            Next
          </button>
        </div>
      )}
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

export function initials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, " ").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function Avatar({ name, size = 34 }: { name: string; size?: number }) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-[9px] text-xs font-semibold ${AV_TONES[h % AV_TONES.length]}`}
      style={{ width: size, height: size }}
    >
      {initials(name)}
    </span>
  );
}

/* -------------------- Drawer -------------------- */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  width = "sm:w-[580px]",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const first = panelRef.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])");
    (first ?? panelRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // A dialog opened on top of the drawer (test call, confirm) closes first.
      const dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      if (dialogs.length && dialogs[dialogs.length - 1] !== panelRef.current) return;
      e.preventDefault();
      onClose();
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
      <div className="absolute inset-0 bg-scrim/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className={`absolute bottom-2.5 left-2.5 right-2.5 top-2.5 flex flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-pop outline-none animate-slide-up sm:left-auto ${width}`}
      >
        <div className="flex items-start gap-3 border-b border-line px-6 pb-[18px] pt-5">
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-semibold tracking-[-0.025em] text-ink">{title}</h2>
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          <IconButton data-close icon={<X size={16} />} onClick={onClose} aria-label="Close" />
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center gap-2 border-t border-line bg-elev/60 px-6 py-3.5">{footer}</div>}
      </div>
    </div>
  );
}

/* -------------------- Shared audio player -------------------- */
let sharedPlayer: HTMLAudioElement | null = null;
const PLAY_EVENT = "ivr-audio-play";

/** One audio plays at a time across the app; starting one stops the last. */
export function usePlayer(src: string | null | undefined) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const other = (e: Event) => {
      if ((e as CustomEvent).detail !== src) setPlaying(false);
    };
    window.addEventListener(PLAY_EVENT, other);
    return () => window.removeEventListener(PLAY_EVENT, other);
  }, [src]);
  function toggle() {
    if (!src) return;
    if (playing) {
      sharedPlayer?.pause();
      setPlaying(false);
      return;
    }
    sharedPlayer?.pause();
    sharedPlayer = new Audio(src);
    sharedPlayer.onended = () => setPlaying(false);
    sharedPlayer.onerror = () => {
      setPlaying(false);
      toast("Couldn't play this audio", "danger");
    };
    window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: src }));
    void sharedPlayer.play().catch(() => setPlaying(false));
    setPlaying(true);
  }
  return { playing, toggle };
}

/** Round filled play/pause button (the brand-coloured one on audio cards). */
export function PlayRound({ src, label, size = 30 }: { src: string; label: string; size?: number }) {
  const { playing, toggle } = usePlayer(src);
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`${playing ? "Pause" : "Play"} ${label}`}
      className="grid shrink-0 place-items-center rounded-full bg-brand text-onbrand shadow-xs transition-colors hover:bg-brand/90 focus-visible:outline-none focus-visible:shadow-glow"
      style={{ width: size, height: size }}
    >
      {playing ? <Pause size={12} className="fill-current" /> : <Play size={12} className="ml-px fill-current" />}
    </button>
  );
}

/** Small square icon button for a table row (play / pause). */
export function PlayIcon({ src, label }: { src: string; label: string }) {
  const { playing, toggle } = usePlayer(src);
  return (
    <IconButton
      size="sm"
      icon={playing ? <Pause size={14} /> : <Play size={14} />}
      onClick={toggle}
      title={playing ? "Pause audio" : "Play audio"}
      aria-label={`${playing ? "Pause" : "Play"} ${label}`}
      className={playing ? "text-accent" : ""}
    />
  );
}

/** Decorative waveform bars. Seeded so each audio keeps its own shape. */
export function WaveBars({ seed = 0, count = 34, height = 22, played = 0 }: { seed?: number; count?: number; height?: number; played?: number }) {
  return (
    <div className="flex flex-1 items-center gap-[2px]" style={{ height }} aria-hidden="true">
      {Array.from({ length: count }, (_, k) => (
        <i
          key={k}
          className={`block flex-1 rounded-[2px] ${k < played ? "bg-accent" : "bg-ink/[0.14]"}`}
          style={{ height: 5 + Math.abs(Math.sin((k + seed) * 0.6) * Math.cos(k * 0.17)) * (height - 6) }}
        />
      ))}
    </div>
  );
}

export function fmtSec(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec <= 0) return "";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Stable numeric seed from a string (for WaveBars). */
export function seedOf(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 17 + s.charCodeAt(i)) % 997;
  return h;
}
