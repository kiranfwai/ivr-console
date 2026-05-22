"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

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
    <div className="min-h-screen flex items-center justify-center bg-bg text-ink">
      <form
        onSubmit={submit}
        className="w-[340px] bg-panel border border-line rounded-2xl p-6 space-y-4"
      >
        <div>
          <div className="text-xl font-semibold">IVR Console</div>
          <div className="text-sm text-muted">Sign in to continue</div>
        </div>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Admin password"
          className="w-full bg-bg border border-line rounded-lg px-3 py-2 outline-none focus:border-accent"
        />
        {err && <div className="text-danger text-sm">{err}</div>}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full bg-accent text-bg font-medium rounded-lg py-2 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
