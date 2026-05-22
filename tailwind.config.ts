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
      },
      keyframes: {
        fadeIn: { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
