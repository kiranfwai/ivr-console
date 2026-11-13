import type { Config } from "tailwindcss";

/**
 * Every colour is a CSS variable (RGB channels) set per theme in globals.css,
 * so the same class — `bg-panel`, `text-ink`, `border-line`, `bg-brand/10` —
 * renders correctly in light AND dark mode, opacity modifiers included.
 * Light is the default; `<html data-theme="dark">` switches.
 */
const v = (name: string) => `rgb(var(--c-${name}) / <alpha-value>)`;

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces
        bg: v("bg"),          // app canvas
        panel: v("panel"),    // cards, sidebar, popovers
        elev: v("elev"),      // raised / hover / table header
        line: v("line"),      // hairline borders
        line2: v("line2"),    // stronger borders / dividers

        // Text
        ink: v("ink"),        // primary
        ink2: v("ink2"),      // secondary
        muted: v("muted"),    // tertiary / hints

        // Brand & semantic
        brand: v("brand"),    // the one primary action (navy in light, off-white in dark)
        onbrand: v("onbrand"),// text on a brand surface
        accent: v("accent"),  // links, focus rings, charts, active nav
        brand2: v("brand2"),  // teal, from the FWAI mark
        ok: v("ok"),
        ok2: v("ok2"),
        warn: v("warn"),
        warn2: v("warn2"),
        danger: v("danger"),
        danger2: v("danger2"),
        info: v("info"),
        scrim: v("scrim"),
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "SF Mono", "Menlo", "Consolas"],
      },
      boxShadow: {
        xs: "var(--shadow-xs)",
        card: "var(--shadow-card)",
        elev: "var(--shadow-pop)",
        pop: "var(--shadow-pop)",
        glow: "0 0 0 4px rgb(var(--c-accent) / 0.18)",
      },
      borderRadius: {
        xl: "0.75rem",
        "2xl": "1rem",
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.25s ease-out",
        pulse2: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        // Payment-success celebration
        "check-pop": "checkPop 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "check-draw": "checkDraw 0.4s 0.25s ease-out both",
        "ring-out": "ringOut 0.9s 0.2s ease-out both",
        "pop-in": "popIn 0.4s 0.35s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        checkPop: {
          "0%": { opacity: "0", transform: "scale(0.5)" },
          "60%": { opacity: "1", transform: "scale(1.08)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        checkDraw: {
          "0%": { strokeDashoffset: "48" },
          "100%": { strokeDashoffset: "0" },
        },
        ringOut: {
          "0%": { opacity: "0.55", transform: "scale(0.7)" },
          "100%": { opacity: "0", transform: "scale(2.2)" },
        },
        popIn: {
          "0%": { opacity: "0", transform: "translateY(6px) scale(0.96)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
