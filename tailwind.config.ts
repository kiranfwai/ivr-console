import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces — layered dark theme, each step ~3% lighter
        bg: "#0a0c10",        // app background
        panel: "#0f1218",     // primary card surface
        elev: "#161a23",      // raised elements (hover, popovers)
        line: "#1f2531",      // hairline borders
        line2: "#2a3142",     // stronger borders / dividers

        // Text
        ink: "#e8ecf3",       // primary
        ink2: "#b8c0cf",      // secondary
        muted: "#7a8597",     // tertiary / hints

        // Brand & semantic
        brand: "#5eead4",     // teal accent (primary CTAs)
        brand2: "#7dd3fc",    // sky (secondary highlight)
        ok: "#22c55e",
        ok2: "#16a34a",
        warn: "#f59e0b",
        warn2: "#d97706",
        danger: "#ef4444",
        danger2: "#dc2626",
        info: "#6366f1",
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SF Mono', 'Menlo', 'Consolas'],
      },
      boxShadow: {
        card: "0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.4)",
        elev: "0 1px 0 rgba(255,255,255,0.06) inset, 0 4px 16px rgba(0,0,0,0.5)",
        glow: "0 0 0 1px rgba(94,234,212,0.35), 0 0 24px rgba(94,234,212,0.1)",
      },
      borderRadius: {
        xl: "0.875rem",
        "2xl": "1.125rem",
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
          "0%": { opacity: "0", transform: "translateY(8px)" },
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
