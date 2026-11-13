"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  Lock,
  Mail,
  MessageCircle,
  Phone,
  Receipt,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { Spinner } from "@/components/ui";
import { LogoMark } from "@/components/theme";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-panel text-muted">
          <Spinner size={20} />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}

/* Login "C" layout. The right-hand brand panel is a fixed navy surface (white
   text in both themes); everything else reads the theme tokens. */
const LOGIN_CSS = `
.lc{display:grid;grid-template-columns:minmax(0,.85fr) minmax(0,1.15fr);min-height:100vh;background:rgb(var(--c-panel))}
:root[data-theme="dark"] .lc{background:rgb(var(--c-bg))}
.lc .l{display:flex;flex-direction:column;padding:40px 64px;min-width:0}
.lc .form{max-width:380px;width:100%;margin:auto;padding:32px 0}
.lc .go .i{transition:transform .15s}.lc .go:hover .i{transform:translateX(3px)}
.peekp{position:relative;overflow:hidden;margin:12px;border-radius:22px;color:#fff;min-height:calc(100vh - 24px);
  background:radial-gradient(800px 420px at 85% 0%,rgba(46,211,183,.28),transparent 60%),radial-gradient(700px 500px at 0% 100%,rgba(76,104,232,.40),transparent 60%),linear-gradient(165deg,#1E3080 0%,#121C4E 55%,#0B1236 100%)}
:root[data-theme="dark"] .peekp{background:radial-gradient(800px 420px at 85% 0%,rgba(124,140,248,.22),transparent 60%),radial-gradient(700px 500px at 0% 100%,rgba(46,211,183,.10),transparent 60%),linear-gradient(165deg,#141A30 0%,#0D1122 60%,#0A0D18 100%);box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
.peekp::before{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.055) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.055) 1px,transparent 1px);background-size:48px 48px;-webkit-mask-image:radial-gradient(ellipse 80% 70% at 60% 40%,#000 30%,transparent 80%);mask-image:radial-gradient(ellipse 80% 70% at 60% 40%,#000 30%,transparent 80%)}
.peekp .cap{position:absolute;left:56px;top:52px;right:56px;z-index:3}
.peekp .cap .ey{display:inline-flex;align-items:center;gap:8px;font-size:12.5px;color:#9FF3E3;font-weight:550;margin-bottom:12px}
.peekp .cap .ey i{width:7px;height:7px;border-radius:50%;background:#2ED3B7;box-shadow:0 0 0 4px rgba(46,211,183,.2);animation:lc-pulse 2s infinite}
.peekp .cap b{display:block;font-size:34px;font-weight:600;letter-spacing:-.045em;line-height:1.12;max-width:560px}
.peekp .cap b span{color:#7EF0DC}
.peekp .cap p{margin:12px 0 0;color:rgba(255,255,255,.7);font-size:15px;max-width:480px}
.tilt{position:absolute;left:64px;top:270px;width:760px;transform:perspective(2200px) rotateY(-13deg) rotateX(7deg) rotateZ(1.5deg);transform-origin:left center;z-index:1}
.win{color:rgb(var(--c-ink));border-radius:14px;overflow:hidden;background:rgb(var(--c-bg));box-shadow:0 50px 90px -20px rgba(0,0,0,.6),0 0 0 1px rgba(255,255,255,.12)}
.win .chrome{height:32px;display:flex;align-items:center;gap:7px;padding:0 12px;background:rgb(var(--c-panel));border-bottom:1px solid rgb(var(--c-line))}
.win .chrome i{width:10px;height:10px;border-radius:50%}
.win .chrome .url{margin:0 auto;height:20px;padding:0 12px;border-radius:6px;background:rgb(var(--c-ink) / .05);color:rgb(var(--c-muted));font-size:11px;display:flex;align-items:center;gap:6px}
.win .vp{position:relative;width:760px;height:500px;overflow:hidden}
.peekp .fade{position:absolute;inset:auto 0 0 0;height:160px;background:linear-gradient(transparent,#0B1236 85%);z-index:2}
:root[data-theme="dark"] .peekp .fade{background:linear-gradient(transparent,#0A0D18 85%)}
@keyframes lc-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@keyframes lc-pulse{0%{box-shadow:0 0 0 0 rgba(46,211,183,.45)}70%{box-shadow:0 0 0 7px rgba(46,211,183,0)}100%{box-shadow:0 0 0 0 rgba(46,211,183,0)}}
.fl{position:absolute;z-index:4;display:flex;gap:12px;align-items:center;background:rgb(var(--c-panel) / .96);color:rgb(var(--c-ink));border-radius:14px;padding:12px 14px;box-shadow:0 20px 40px -12px rgba(0,0,0,.5),0 0 0 1px rgb(var(--c-panel) / .6);animation:lc-float 6s ease-in-out infinite}
:root[data-theme="dark"] .fl{box-shadow:0 20px 40px -12px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.08)}
.fl .fi{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:none}
.fl b{display:block;font-size:13px;font-weight:600;letter-spacing:-.01em}
.fl span{font-size:12px;color:rgb(var(--c-muted))}
.fl.a{left:30px;bottom:200px;animation-delay:-2s}
.fl.b{right:40px;top:232px}
.fl.c{right:70px;bottom:120px;animation-delay:-4s}
.peekp .pills{position:absolute;left:56px;right:56px;bottom:40px;z-index:3;display:flex;gap:8px;flex-wrap:wrap}
.peekp .pills span{display:inline-flex;align-items:center;gap:7px;height:30px;padding:0 12px;border-radius:999px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14);font-size:12.5px;color:rgba(255,255,255,.85);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}
.peekp .pills svg{color:#9FF3E3}
@media (max-width:1100px){.lc{grid-template-columns:1fr}.peekp{display:none}.lc .l{padding:32px 20px}}
@media (prefers-reduced-motion:reduce){.fl,.peekp .cap .ey i{animation:none}}
`;

function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark size={34} />
      <b className="text-[15.5px] font-semibold tracking-[-0.02em] text-ink">IVR Console</b>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Decorative product preview. STATIC by design: it renders before     */
/* sign-in, so every number and name in it is invented.                */
/* ------------------------------------------------------------------ */
const DEMO_BARS: [number, number][] = [
  [31, 52], [29, 48], [35, 56], [18, 30], [16, 26], [40, 61], [42, 64],
  [38, 60], [45, 70], [43, 66], [24, 38], [20, 33], [47, 72], [49, 79],
];

function DemoDashboard() {
  const W = 470;
  const H = 150;
  const bw = W / DEMO_BARS.length;
  const max = 140;
  return (
    <div className="flex h-full text-[11px]">
      {/* sidebar */}
      <div className="flex w-[150px] flex-none flex-col gap-1 border-r border-line bg-panel p-3">
        <div className="mb-2 flex items-center gap-2 rounded-lg border border-line px-2 py-1.5">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-accent/10 text-[9px] font-bold text-accent">DA</span>
          <span className="truncate font-semibold text-ink">Demo Academy</span>
        </div>
        {["Dashboard", "Campaigns", "Bulk calls", "WhatsApp", "Reports", "Billing"].map((n, i) => (
          <div
            key={n}
            className={`rounded-md px-2 py-1.5 ${i === 0 ? "bg-bg font-semibold text-ink shadow-xs" : "text-muted"}`}
          >
            {n}
          </div>
        ))}
      </div>
      {/* main */}
      <div className="min-w-0 flex-1 space-y-3 p-4">
        <div className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Dashboard</div>
        <div className="grid grid-cols-4 gap-2.5">
          {[
            ["Calls today", "1,284"],
            ["Answered", "493"],
            ["Pressed 1", "162"],
            ["WhatsApp sent", "431"],
          ].map(([l, v]) => (
            <div key={l} className="rounded-lg border border-line bg-panel px-2.5 py-2 shadow-xs">
              <div className="text-muted">{l}</div>
              <div className="mt-1 text-[17px] font-semibold tracking-[-0.03em] text-ink tabular-nums">{v}</div>
            </div>
          ))}
        </div>
        <div className="rounded-lg border border-line bg-panel p-3 shadow-xs">
          <div className="mb-2 flex items-center justify-between">
            <span className="font-semibold text-ink">Calls, last 14 days</span>
            <span className="text-muted">Answered · Not answered</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-[120px] w-full" aria-hidden="true">
            {DEMO_BARS.map(([a, n], i) => {
              const x = i * bw + bw * 0.22;
              const w = bw * 0.56;
              const ha = (a / max) * H;
              const hn = (n / max) * H;
              const yA = H - ha;
              const yN = yA - hn - 2;
              return (
                <g key={i}>
                  <rect x={x} y={yN} width={w} height={hn} rx={3} fill="rgb(var(--c-line))" />
                  <rect x={x} y={yA} width={w} height={ha} rx={3} fill="rgb(var(--c-accent))" />
                </g>
              );
            })}
          </svg>
        </div>
        <div className="overflow-hidden rounded-lg border border-line bg-panel shadow-xs">
          {[
            ["Webinar reminder", "Running", "ok"],
            ["Course launch", "Scheduled", "accent"],
            ["Payment nudge", "Finished", "muted"],
          ].map(([n, s, t]) => (
            <div key={n} className="flex items-center justify-between border-b border-line px-3 py-2 last:border-b-0">
              <span className="font-medium text-ink">{n}</span>
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  t === "ok"
                    ? "border-ok/25 bg-ok/10 text-ok"
                    : t === "accent"
                      ? "border-accent/25 bg-accent/10 text-accent"
                      : "border-line bg-elev text-muted"
                }`}
              >
                {s}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function BrandPanel() {
  return (
    <div className="peekp" aria-hidden="true">
      <div className="cap">
        <div className="ey">
          <i />
          Live the moment you sign in
        </div>
        <b>
          Every call, every press, <span>every rupee</span> — on one screen.
        </b>
        <p>See what’s running, who answered and what it cost, and send WhatsApp follow-ups automatically.</p>
      </div>

      <div className="fl b">
        <div className="fi bg-ok/10 text-ok">
          <TrendingUp size={17} />
        </div>
        <div>
          <b>+12.4% calls today</b>
          <span>vs yesterday</span>
        </div>
      </div>

      <div className="tilt">
        <div className="win">
          <div className="chrome">
            <i style={{ background: "#F97066" }} />
            <i style={{ background: "#FDB022" }} />
            <i style={{ background: "#47CD89" }} />
            <div className="url">
              <Lock size={10} />
              ivr-console.example
            </div>
          </div>
          <div className="vp">
            <DemoDashboard />
          </div>
        </div>
      </div>

      <div className="fl a">
        <div className="fi bg-brand2/10 text-brand2">
          <MessageCircle size={17} />
        </div>
        <div>
          <b>WhatsApp sent</b>
          <span>Lead pressed 1 · just now</span>
        </div>
      </div>
      <div className="fl c">
        <div className="fi bg-accent/10 text-accent">
          <Phone size={17} />
        </div>
        <div>
          <b>Call answered</b>
          <span>0:41 · Webinar reminder</span>
        </div>
      </div>

      <div className="fade" />
      <div className="pills">
        <span>
          <Users size={14} />
          Bulk &amp; sheet auto-dial
        </span>
        <span>
          <MessageCircle size={14} />
          WhatsApp on pickup
        </span>
        <span>
          <Receipt size={14} />
          GST invoices
        </span>
      </div>
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
        body: JSON.stringify({ email, password: password.trim() }),
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
    "h-11 w-full rounded-[9px] border border-line bg-panel pl-10 pr-3 text-[14.5px] text-ink shadow-xs outline-none transition-[border-color,box-shadow] placeholder:text-muted hover:border-line2 focus:border-accent focus:shadow-glow";

  return (
    <div className="lc text-ink">
      <style>{LOGIN_CSS}</style>

      {/* ------------------------------------------------ form column */}
      <div className="l">
        <Link href="/" className="self-start">
          <Logo />
        </Link>

        <form onSubmit={submit} noValidate className="form">
          <span className="mb-[18px] inline-flex h-[26px] items-center gap-1.5 rounded-full border border-accent/20 bg-accent/[0.07] px-2.5 text-xs font-medium text-accent">
            <Lock size={13} />
            Client sign-in
          </span>
          <h1 className="m-0 mb-2 text-[32px] font-semibold leading-[1.15] tracking-[-0.045em] text-ink">Welcome back</h1>
          <p className="m-0 mb-[30px] text-[15px] text-muted">Sign in to run your calls and WhatsApp follow-ups.</p>

          {err && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-2.5 rounded-[10px] border border-danger/25 bg-danger/[0.07] px-3.5 py-2.5 text-[13px] leading-[1.5] text-danger"
            >
              <AlertCircle size={15} className="mt-px flex-none" />
              {err}
            </div>
          )}

          <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink2">
            Work email
          </label>
          <div className="relative">
            <Mail size={17} className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="email"
              type="email"
              autoFocus
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className={field}
            />
          </div>

          <div className="h-4" />

          <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink2">
            Password
          </label>
          <div className="relative">
            <Lock size={17} className="pointer-events-none absolute left-[13px] top-1/2 -translate-y-1/2 text-muted" />
            <input
              id="password"
              type={showPw ? "text" : "password"}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={detectCaps}
              onKeyDown={detectCaps}
              placeholder="Enter your password"
              className={`${field} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPw((s) => !s)}
              aria-label={showPw ? "Hide password" : "Show password"}
              title={showPw ? "Hide password" : "Show password"}
              className="absolute right-1.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted transition-colors hover:bg-ink/[0.05] hover:text-ink"
            >
              {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {capsLock && !err && (
            <div className="mt-1.5 flex items-center gap-1 text-xs text-warn">
              <AlertCircle size={12} />
              Caps Lock is on.
            </div>
          )}

          <button
            type="submit"
            disabled={!email || !password || busy}
            className="go mt-[22px] flex h-[46px] w-full items-center justify-center gap-2 rounded-[11px] bg-brand text-[14.5px] font-semibold text-onbrand shadow-xs transition-colors hover:bg-brand/90 focus-visible:shadow-glow focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? (
              <>
                <Spinner size={15} /> Signing in…
              </>
            ) : (
              <>
                Sign in <ArrowRight size={16} strokeWidth={2.2} className="i" />
              </>
            )}
          </button>

          <div className="mt-[22px] flex items-center gap-2 rounded-[11px] border border-line bg-elev px-3.5 py-3 text-[12.5px] text-muted">
            <ShieldCheck size={16} className="flex-none text-ok" />
            <span>Encrypted connection. Your session is private to your company.</span>
          </div>

          <p className="m-0 mt-6 text-[13.5px] text-muted">
            Need an account?{" "}
            <Link href="/request-access" className="font-semibold text-accent hover:underline">
              Request access
            </Link>
          </p>
        </form>

        <div className="flex flex-wrap gap-4 text-[12.5px] text-muted">
          <span>© {new Date().getFullYear()} Freedom With AI</span>
          <Link href="/" className="hover:text-ink">
            Home
          </Link>
        </div>
      </div>

      {/* ------------------------------------------------ brand column (desktop only) */}
      <BrandPanel />
    </div>
  );
}
