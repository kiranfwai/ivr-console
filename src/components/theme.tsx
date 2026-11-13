"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemePref = "light" | "dark" | "system";
const KEY = "ivr.theme";

function resolve(pref: ThemePref): "light" | "dark" {
  if (pref !== "system") return pref;
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(pref: ThemePref) {
  const el = document.documentElement;
  // Animate colours only for the switch itself, not every later layout change.
  el.classList.add("theme-anim");
  el.setAttribute("data-theme", resolve(pref));
  window.setTimeout(() => el.classList.remove("theme-anim"), 250);
}

/** Light / dark / follow-the-device, remembered per browser. Light is the default. */
export function useTheme() {
  const [pref, setPref] = useState<ThemePref>("light");

  useEffect(() => {
    let saved: ThemePref = "light";
    try {
      const v = window.localStorage.getItem(KEY);
      if (v === "light" || v === "dark" || v === "system") saved = v;
    } catch {
      /* storage blocked — stay on light */
    }
    setPref(saved);
    if (saved !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const set = useCallback((p: ThemePref) => {
    setPref(p);
    try {
      window.localStorage.setItem(KEY, p);
    } catch {
      /* non-fatal */
    }
    apply(p);
  }, []);

  const isDark = pref === "dark" || (pref === "system" && resolve("system") === "dark");
  return { pref, set, isDark, toggle: () => set(isDark ? "light" : "dark") };
}

/** The IVR Console mark: a call going out in waves, teal dot for the pickup. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="ivr-mark-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2A3F96" />
          <stop offset="1" stopColor="#16225A" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#ivr-mark-g)" />
      <rect x=".5" y=".5" width="31" height="31" rx="8.5" fill="none" stroke="#fff" strokeOpacity=".14" />
      <circle cx="11" cy="21" r="2.7" fill="#2ED3B7" />
      <path d="M11 14.5a6.5 6.5 0 0 1 6.5 6.5" stroke="#fff" strokeWidth="2.3" fill="none" strokeLinecap="round" />
      <path d="M11 9a12 12 0 0 1 12 12" stroke="#fff" strokeOpacity=".5" strokeWidth="2.3" fill="none" strokeLinecap="round" />
    </svg>
  );
}
