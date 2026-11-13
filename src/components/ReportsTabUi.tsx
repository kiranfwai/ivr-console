"use client";

import { ReactNode, useEffect, useRef } from "react";
import { Check, Minus } from "lucide-react";

/**
 * Small pieces used by the Call reports and Sheet screens: an anchored popover
 * (closes on outside click / Escape), a checkbox square and an initials avatar.
 */
export function Popover({
  open,
  onClose,
  trigger,
  children,
  align = "left",
  className = "",
}: {
  open: boolean;
  onClose: () => void;
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrap.current && !wrap.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <div ref={wrap} className="relative">
      {trigger}
      {open && (
        <div
          role="dialog"
          className={`absolute top-full z-40 mt-1.5 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-panel p-1.5 shadow-pop animate-fade-in ${
            align === "right" ? "right-0" : "left-0"
          } ${className}`}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/** The filter-bar trigger look (white button with an icon, label and caret). */
export const TRIGGER =
  "inline-flex h-9 max-w-full items-center gap-2 rounded-[9px] border border-line bg-panel px-3 text-[13.5px] font-medium text-ink shadow-xs whitespace-nowrap transition-colors hover:border-line2 focus-visible:outline-none focus-visible:shadow-glow";

export function CheckBox({ on, part }: { on: boolean; part?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-4 w-4 shrink-0 place-items-center rounded-[5px] border-[1.5px] transition-colors ${
        on || part ? "border-brand bg-brand text-onbrand" : "border-line2 bg-panel"
      }`}
    >
      {on ? <Check size={11} strokeWidth={3} /> : part ? <Minus size={11} strokeWidth={3} /> : null}
    </span>
  );
}

export function Initials({ name, size = 30 }: { name: string; size?: number }) {
  const parts = name.replace(/[^\p{L}\p{N} ]/gu, " ").trim().split(/\s+/).filter(Boolean);
  const txt = ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-[8px] bg-accent/10 text-[11.5px] font-semibold text-accent"
      style={{ width: size, height: size }}
    >
      {txt}
    </span>
  );
}
