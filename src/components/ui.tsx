"use client";

import { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, useEffect, useState } from "react";

type Variant = "primary" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className = "",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  const base = "px-3 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";
  const v = {
    primary: "bg-accent text-bg hover:opacity-90",
    ghost: "bg-panel border border-line text-ink hover:bg-line",
    danger: "bg-danger/10 text-danger border border-danger/30 hover:bg-danger/20",
  }[variant];
  return <button className={`${base} ${v} ${className}`} {...rest} />;
}

export function Input({ className = "", ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent ${className}`}
      {...rest}
    />
  );
}

export function Textarea({ className = "", ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={`w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm font-mono outline-none focus:border-accent ${className}`}
      {...rest}
    />
  );
}

export function Select({ className = "", children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm outline-none focus:border-accent ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <div className="text-xs uppercase tracking-wider text-muted mb-1">{children}</div>;
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`bg-panel border border-line rounded-2xl p-4 ${className}`}>{children}</div>;
}

export function Badge({ tone = "muted", children }: { tone?: "muted" | "ok" | "warn" | "danger" | "accent"; children: React.ReactNode }) {
  const c = {
    muted: "bg-line text-muted",
    ok: "bg-ok/10 text-ok border border-ok/30",
    warn: "bg-warn/10 text-warn border border-warn/30",
    danger: "bg-danger/10 text-danger border border-danger/30",
    accent: "bg-accent/10 text-accent border border-accent/30",
  }[tone];
  return <span className={`px-2 py-0.5 rounded-md text-xs ${c}`}>{children}</span>;
}

export function CsvFilePicker({ onLoad }: { onLoad: (text: string) => void }) {
  const [fileName, setFileName] = useState<string>("");
  return (
    <label className="cursor-pointer px-2 py-1 rounded bg-line/60 hover:bg-line text-ink inline-flex items-center gap-1 text-xs">
      <span>📁 {fileName || "Choose CSV"}</span>
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

export function KPI({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <Card>
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="text-3xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-xs text-muted mt-1">{sub}</div>}
    </Card>
  );
}

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
    <div className="fixed bottom-4 right-4 space-y-2 z-50">
      {items.map((t) => (
        <div
          key={t.id}
          className={`px-3 py-2 rounded-lg shadow-lg border text-sm ${
            t.tone === "ok"
              ? "bg-ok/10 text-ok border-ok/30"
              : t.tone === "danger"
              ? "bg-danger/10 text-danger border-danger/30"
              : "bg-panel border-line text-ink"
          }`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
