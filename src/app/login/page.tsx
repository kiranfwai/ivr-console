"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, ArrowRight, Lock, Mail } from "lucide-react";
import { Spinner } from "@/components/ui";
import "@/components/landing/landing.css";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-muted">
          <Spinner size={20} />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

function Logo() {
  return (
    <span className="inline-flex items-center gap-[11px] text-[16.5px] font-bold tracking-[-0.025em]">
      <span className="block h-[30px] w-[30px] flex-none overflow-hidden rounded-[9px] shadow-[0_4px_14px_-4px_rgba(0,0,0,0.7),inset_0_0_0_1px_rgba(255,255,255,0.09)]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/fwai-logo.png" alt="Freedom With AI" className="h-full w-full object-cover" />
      </span>
      IVR Console <span className="font-medium text-muted">by FWAI</span>
    </span>
  );
}

/** Illustrative campaign snapshot. Static by design — this renders before auth. */
function LiveCampaignCard() {
  const rows: [string, string, "ok" | "no"][] = [
    ["+91 98••• 41207", "Press-1", "ok"],
    ["+91 90••• 88310", "Answered", "ok"],
    ["+91 76••• 22984", "No answer", "no"],
  ];
  return (
    <div className="max-w-[470px] overflow-hidden rounded-[17px] border border-line2 bg-gradient-to-b from-[rgba(22,26,35,0.9)] to-[rgba(15,18,24,0.9)] shadow-[0_34px_70px_-44px_#000,inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 text-[12.5px] text-ink2">
        <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.11em] text-brand">
          <span className="lp-live h-[7px] w-[7px] rounded-full bg-brand" /> Live
        </span>
        <span>webinar-reminder</span>
      </div>
      <div className="border-b border-line px-4 pb-3.5 pt-3">
        <div className="mb-2 flex justify-between text-[12px] text-muted">
          <span>Dialled</span>
          <b className="text-[12.5px] font-semibold tabular-nums text-ink">
            2,914 <span className="font-normal text-muted">/ 4,182</span>
          </b>
        </div>
        <div className="h-[5px] overflow-hidden rounded-full bg-white/[0.07]">
          <i className="block h-full rounded-full bg-gradient-to-r from-[#14B8A6] via-brand to-[#a9f2e8]" style={{ width: "69.7%" }} />
        </div>
      </div>
      {rows.map(([num, label, tone]) => (
        <div key={num} className="flex items-center justify-between gap-3 border-b border-line px-4 py-[10.5px] text-[13px] last:border-b-0">
          <span className="font-medium tabular-nums text-ink">{num}</span>
          <span className="flex gap-1.5">
            <span
              className={`inline-flex items-center whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11px] font-semibold ${
                tone === "ok"
                  ? "bg-brand/10 text-brand shadow-[inset_0_0_0_1px_rgba(94,234,212,0.2)]"
                  : "bg-white/5 text-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]"
              }`}
            >
              {label}
            </span>
            {tone === "ok" && (
              <span className="inline-flex items-center whitespace-nowrap rounded-full bg-[rgba(37,211,102,0.1)] px-[9px] py-[3px] text-[11px] font-semibold text-[#4FD37E] shadow-[inset_0_0_0_1px_rgba(37,211,102,0.18)]">
                WhatsApp
              </span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const router = useRouter();
  const search = useSearchParams();
  const from = search.get("from") || "/";

  function detectCaps(e: React.KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.("CapsLock") ?? false);
  }

  // Unchanged: the same request, the same responses, the same redirect.
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

  const field =
    "w-full rounded-[10px] border bg-white/[0.028] py-2.5 pl-[38px] pr-3 text-[13.6px] text-ink outline-none transition-colors placeholder:text-[#4A515E] focus:border-brand/50 focus:bg-brand/[0.035] focus:shadow-[0_0_0_3px_rgba(94,234,212,0.1)]";

  return (
    <div className="relative min-h-screen bg-bg text-ink">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="lp-grid"
          style={{
            WebkitMaskImage: "radial-gradient(ellipse 95% 85% at 20% 26%, #000 18%, transparent 76%)",
            maskImage: "radial-gradient(ellipse 95% 85% at 20% 26%, #000 18%, transparent 76%)",
          }}
        />
        <div className="lp-glow left-[8%] top-[-320px] h-[860px] w-[1040px] -translate-x-[40%]" />
        <div className="lp-glow-soft bottom-[-400px] right-[10%] h-[780px] w-[920px] translate-x-[35%]" />
        <div className="lp-vignette" />
      </div>

      <div className="relative z-10 grid min-h-screen md:grid-cols-[1.02fr_0.98fr]">
        {/* ------------------------------------------------ brand column */}
        <aside
          className="hidden flex-col justify-between gap-[22px] py-[46px] pr-11 md:flex"
          style={{ paddingLeft: "max(44px, calc((100vw - 1240px) / 2))" }}
        >
          <Link href="/">
            <Logo />
          </Link>

          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="mb-7 max-w-[480px]">
              <h1 className="m-0 mb-[13px] text-[clamp(26px,2.8vw,37px)] font-extrabold leading-[1.06] tracking-[-0.04em]">
                Your list is already
                <br />
                <span className="lp-g">being dialled.</span>
              </h1>
              <p className="m-0 max-w-[430px] text-[15px] text-ink2">
                Sign in to follow every campaign live — who picked up, who pressed 1, and whose WhatsApp already
                landed.
              </p>
            </div>

            <LiveCampaignCard />

            <div className="mt-[26px] flex flex-wrap gap-8">
              {[
                ["4,182", "Dialled today"],
                ["731", "Press-1 leads"],
                ["100%", "Answered → WhatsApp"],
              ].map(([n, l]) => (
                <div key={l}>
                  <b className="block text-[20px] font-extrabold tracking-[-0.035em] tabular-nums">{n}</b>
                  <span className="text-[12.5px] text-muted">{l}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-[19px] text-[12.5px] text-muted">
            <span>© {new Date().getFullYear()} Freedom With AI</span>
            <Link href="/" className="hover:text-ink2">
              Home
            </Link>
          </div>
        </aside>

        {/* ------------------------------------------------ form column */}
        <main
          className="flex items-start justify-center px-5 py-[46px] md:pl-11"
          style={{ paddingRight: "max(20px, calc((100vw - 1240px) / 2))" }}
        >
          <form
            onSubmit={submit}
            noValidate
            className="relative m-auto w-full max-w-[404px] rounded-[20px] border border-line2 bg-gradient-to-b from-[rgba(22,26,35,0.94)] to-[rgba(14,17,23,0.96)] px-7 pb-[26px] pt-[30px] shadow-[0_44px_90px_-50px_#000,inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg before:absolute before:inset-x-[22px] before:-top-px before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand/55 before:to-transparent before:content-['']"
          >
            <h2 className="m-0 mb-[7px] text-[23px] font-extrabold tracking-[-0.035em]">Sign in to your console</h2>
            <p className="m-0 mb-[22px] text-[13.6px] text-ink2">
              Welcome back. Pick up where your campaigns left off.
            </p>

            {err && (
              <div className="mb-4 flex items-start gap-[9px] rounded-[10px] border border-danger/30 bg-danger/[0.07] px-3.5 py-2.5 text-[13px] leading-[1.5] text-[#FFC2CA]">
                <AlertCircle size={15} className="mt-px flex-none" />
                {err}
              </div>
            )}

            <div className="mb-[13px]">
              <label htmlFor="email" className="mb-1.5 block text-[12px] font-semibold text-ink2">
                Work email
              </label>
              <div className="relative flex items-center [&:focus-within_.ic]:text-brand">
                <span className="ic pointer-events-none absolute left-3 text-muted transition-colors">
                  <Mail size={15} strokeWidth={1.9} />
                </span>
                <input
                  id="email"
                  type="email"
                  autoFocus
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className={`${field} border-line2`}
                />
              </div>
            </div>

            <div className="mb-[13px]">
              <label htmlFor="password" className="mb-1.5 block text-[12px] font-semibold text-ink2">
                Password
              </label>
              <div className="relative flex items-center [&:focus-within_.ic]:text-brand">
                <span className="ic pointer-events-none absolute left-3 text-muted transition-colors">
                  <Lock size={15} strokeWidth={1.9} />
                </span>
                <input
                  id="password"
                  type={showPw ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyUp={detectCaps}
                  onKeyDown={detectCaps}
                  placeholder="Enter your password"
                  className={`${field} border-line2 pr-[58px]`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  className="absolute right-1.5 rounded-[7px] px-2.5 py-1.5 text-[10.5px] font-bold tracking-[0.07em] text-muted transition-colors hover:bg-white/5 hover:text-ink"
                >
                  {showPw ? "HIDE" : "SHOW"}
                </button>
              </div>
              {capsLock && !err && (
                <div className="mt-1.5 flex items-center gap-1 text-xs text-warn">
                  <AlertCircle size={12} />
                  Caps Lock is on.
                </div>
              )}
            </div>

            <button
              type="submit"
              disabled={!email || !password || busy}
              className="group mt-2 flex w-full items-center justify-center gap-[9px] rounded-[10px] bg-gradient-to-b from-[#a9f2e8] to-brand px-5 py-3 text-[14.5px] font-semibold text-[#042420] shadow-[0_12px_28px_-12px_rgba(94,234,212,0.7)] transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
            >
              {busy ? "Signing in…" : "Sign in"}
              {!busy && (
                <ArrowRight size={15} strokeWidth={2.3} className="transition-transform group-hover:translate-x-[3px]" />
              )}
            </button>

            <p className="mt-5 text-center text-[13.2px] text-ink2">
              Don&rsquo;t have an account yet?{" "}
              <Link href="/request-access" className="font-semibold text-brand hover:text-[#a9f2e8]">
                Request access
              </Link>
            </p>
          </form>
        </main>
      </div>
    </div>
  );
}
