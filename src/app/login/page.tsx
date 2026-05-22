"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Phone, LogIn } from "lucide-react";
import { Button, Input, Label } from "@/components/ui";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get("from") || "/";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");
    const r = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (r.ok) {
      router.replace(from);
    } else {
      setErr("Wrong password.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm animate-slide-up">
        <div className="flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-brand to-brand2 flex items-center justify-center text-bg shadow-glow mb-3">
            <Phone size={20} strokeWidth={2.5} />
          </div>
          <div className="text-lg font-semibold">IVR Console</div>
          <div className="text-xs text-muted mt-1">FWAI — outbound + WhatsApp control</div>
        </div>

        <form
          onSubmit={submit}
          className="bg-panel border border-line rounded-2xl p-6 shadow-card space-y-4"
        >
          <div>
            <Label>Admin password</Label>
            <Input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
            />
          </div>
          {err && (
            <div className="text-danger text-sm bg-danger/10 border border-danger/25 rounded-md px-3 py-2">
              {err}
            </div>
          )}
          <Button
            type="submit"
            disabled={!password}
            loading={busy}
            leftIcon={!busy && <LogIn size={14} />}
            className="w-full"
          >
            {busy ? "Signing in…" : "Sign in"}
          </Button>
        </form>

        <div className="text-center mt-6 text-xs text-muted">
          v2 · Upstash Redis · Vercel Blob
        </div>
      </div>
    </div>
  );
}
