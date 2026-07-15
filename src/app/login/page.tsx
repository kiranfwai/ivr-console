"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogIn, AlertCircle } from "lucide-react";
import { Button, Input, Label, Spinner } from "@/components/ui";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center text-muted">
          <Spinner size={20} />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get("from") || "/";

  function detectCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (r.ok) {
        router.replace(from);
        return;
      }
      setErr(
        r.status === 401 || r.status === 403
          ? "Incorrect password. Please try again."
          : `Sign-in failed (${r.status}). Please try again.`,
      );
    } catch {
      setErr("Network error — check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="flex flex-col items-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/fwai-logo.png"
            alt="FWAI"
            className="w-12 h-12 rounded-xl shadow-glow mb-3"
          />
          <div className="text-lg font-semibold">IVR Console</div>
        </div>

        <form
          onSubmit={submit}
          className="bg-panel border border-line rounded-2xl p-6 shadow-card space-y-4"
        >
          <div>
            <Label required>Email</Label>
            <Input
              type="email"
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              aria-label="Email"
            />
          </div>
          <div>
            <Label required>Password</Label>
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={detectCaps}
              onKeyDown={detectCaps}
              placeholder="Enter password"
              error={err || undefined}
              aria-label="Password"
            />
            {capsLock && !err && (
              <div className="mt-1 text-xs text-warn flex items-center gap-1">
                <AlertCircle size={12} />
                Caps Lock is on.
              </div>
            )}
          </div>
          <Button
            type="submit"
            disabled={!email || !password}
            loading={busy}
            leftIcon={!busy && <LogIn size={14} />}
            className="w-full"
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </div>
    </div>
  );
}
