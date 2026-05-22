import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d10",
        panel: "#11151b",
        line: "#1d232c",
        ink: "#e7ecf2",
        muted: "#8a93a0",
        accent: "#5eead4",
        danger: "#f87171",
        ok: "#34d399",
        warn: "#fbbf24",
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto'],
        mono: ['ui-monospace', 'SF Mono', 'Menlo', 'Consolas'],
      },
    },
  },
  plugins: [],
};
export default config;
