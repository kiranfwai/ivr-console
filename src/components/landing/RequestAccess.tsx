"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Building2, Check, Mail, Phone, User } from "lucide-react";
import "./landing.css";

/**
 * The public "request access" page. Onboarding is done by hand, so there is no
 * self-serve sign-up — this captures the lead and the server emails the team.
 */

type Field = "name" | "company" | "email" | "phone";

const RULES: Record<Field, (v: string) => boolean> = {
  name: (v) => v.trim().length > 1,
  company: (v) => v.trim().length > 1,
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()),
  phone: (v) => /^[6-9]\d{9}$/.test(v),
};

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

function Labelled({
  id,
  label,
  icon,
  children,
}: {
  id: string;
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-[13px]">
      <label htmlFor={id} className="mb-1.5 block text-[12px] font-semibold text-ink2">
        {label}
      </label>
      <div className="relative flex items-center [&:focus-within_.lead-ic]:text-brand">
        {icon && <span className="lead-ic pointer-events-none absolute left-3 text-muted transition-colors">{icon}</span>}
        {children}
      </div>
    </div>
  );
}

const INPUT =
  "w-full rounded-[10px] border bg-white/[0.028] py-2.5 pl-[38px] pr-3 text-[13.6px] text-ink outline-none transition-colors placeholder:text-[#4A515E] focus:border-brand/50 focus:bg-brand/[0.035] focus:shadow-[0_0_0_3px_rgba(94,234,212,0.1)]";

export default function RequestAccess() {
  const [v, setV] = useState({ name: "", company: "", email: "", phone: "" });
  const [bad, setBad] = useState<Partial<Record<Field, boolean>>>({});
  const [consent, setConsent] = useState(true);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<typeof v | null>(null);

  function set(f: Field, value: string) {
    setV((p) => ({ ...p, [f]: f === "phone" ? value.replace(/\D/g, "").slice(0, 10) : value }));
    setBad((p) => ({ ...p, [f]: false }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const failed = (Object.keys(RULES) as Field[]).filter((f) => !RULES[f](v[f]));
    if (failed.length) {
      setBad(Object.fromEntries(failed.map((f) => [f, true])));
      setNotice(
        failed[0] === "phone" && v.phone
          ? "That does not look like a valid 10-digit Indian mobile number."
          : "Please complete the highlighted fields.",
      );
      document.getElementById(failed[0])?.focus();
      return;
    }

    setBusy(true);
    setNotice("");
    try {
      const r = await fetch("/api/access-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...v, consent }),
      });
      if (r.ok) setSent(v);
      else setNotice("Something went wrong sending that. Please try again in a moment.");
    } catch {
      setNotice("Network error — check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="lp-scope relative min-h-screen bg-bg text-ink">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="lp-grid" style={{ WebkitMaskImage: "radial-gradient(ellipse 95% 85% at 20% 26%, #000 18%, transparent 76%)", maskImage: "radial-gradient(ellipse 95% 85% at 20% 26%, #000 18%, transparent 76%)" }} />
        <div className="lp-glow left-[8%] top-[-320px] h-[860px] w-[1040px] -translate-x-[40%]" />
        <div className="lp-glow-soft bottom-[-400px] right-[10%] h-[780px] w-[920px] translate-x-[35%]" />
        <div className="lp-vignette" />
      </div>

      <div className="relative z-10 grid min-h-screen md:grid-cols-[1.02fr_0.98fr]">
        {/* ---------------------------------------------- brand column */}
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
                We onboard you
                <br />
                <span className="lp-g">by hand.</span>
              </h1>
              <p className="m-0 max-w-[430px] text-[15px] text-ink2">
                No self-serve sign-up. We set up your first campaign with you on a call, so the first list you
                dial is a real one — not a test.
              </p>
            </div>

            <div className="max-w-[470px]">
              {[
                ["We review your request", "Usually within one working day. If we are not the right fit for your volume, we will tell you plainly."],
                ["A 20-minute setup call", "We connect your Google Sheet, upload your recording and set the schedule together, live."],
                ["Your first campaign goes out", "You watch it dial, see press-1 land, and get the report the same day."],
              ].map(([h, p], i, arr) => (
                <div
                  key={h}
                  className={`relative flex items-start gap-[15px] ${i < arr.length - 1 ? "pb-[18px] before:absolute before:bottom-0.5 before:left-[13px] before:top-[29px] before:w-px before:bg-gradient-to-b before:from-brand/35 before:to-line before:content-['']" : ""}`}
                >
                  <span className="relative z-10 grid h-[27px] w-[27px] flex-none place-items-center rounded-full bg-brand/10 text-[12px] font-extrabold text-brand shadow-[inset_0_0_0_1px_rgba(94,234,212,0.3)]">
                    {i + 1}
                  </span>
                  <div>
                    <h4 className="mb-1 mt-0.5 text-[14.5px] font-semibold tracking-[-0.02em]">{h}</h4>
                    <p className="m-0 max-w-[380px] text-[13.2px] leading-[1.55] text-ink2">{p}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-[26px] flex flex-wrap gap-8">
              {[["<1 day", "Typical response"], ["20 min", "Setup call"], ["None", "Setup fee"]].map(([n, l]) => (
                <div key={l}>
                  <b className="block text-[20px] font-extrabold tracking-[-0.035em]">{n}</b>
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

        {/* ---------------------------------------------- form column */}
        <main
          className="flex items-start justify-center py-[46px] pl-11 pr-5 md:pl-11"
          style={{ paddingRight: "max(44px, calc((100vw - 1240px) / 2))" }}
        >
          <div className="relative m-auto w-full max-w-[404px] rounded-[20px] border border-line2 bg-gradient-to-b from-[rgba(22,26,35,0.94)] to-[rgba(14,17,23,0.96)] px-7 pb-[26px] pt-[30px] shadow-[0_44px_90px_-50px_#000,inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-lg before:absolute before:inset-x-[22px] before:-top-px before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand/55 before:to-transparent before:content-['']">
            {sent ? (
              <div className="text-center">
                <div className="mx-auto mb-[18px] mt-0.5 grid h-[54px] w-[54px] place-items-center rounded-[17px] bg-brand/10 text-brand shadow-[inset_0_0_0_1px_rgba(94,234,212,0.3)]">
                  <Check size={26} strokeWidth={2.6} />
                </div>
                <h2 className="m-0 mb-[9px] text-[23px] font-extrabold tracking-[-0.035em]">Request received.</h2>
                <p className="m-0 mb-5 text-[13.6px] leading-[1.6] text-ink2">
                  Thanks — we have your details. Someone from the FWAI team will reach out within one working day
                  to book your setup call.
                </p>
                <div className="mb-5 overflow-hidden rounded-xl border border-line bg-white/[0.025] text-left">
                  {[
                    ["Name", sent.name],
                    ["Company", sent.company],
                    ["Email", sent.email],
                    ["WhatsApp", `+91 ${sent.phone}`],
                  ].map(([k, val]) => (
                    <div key={k} className="flex justify-between gap-3.5 border-b border-line px-3.5 py-2.5 text-[13px] last:border-b-0">
                      <span className="text-muted">{k}</span>
                      <b className="break-words text-right font-medium">{val}</b>
                    </div>
                  ))}
                </div>
                <Link
                  href="/login"
                  className="flex w-full items-center justify-center rounded-[10px] border border-line2 px-5 py-3 text-[14.5px] font-semibold text-ink transition-colors hover:border-white/30 hover:bg-white/5"
                >
                  Back to sign in
                </Link>
                <p className="mt-[15px] text-[12px] text-muted">
                  Wrong details? Reply to the confirmation email and we will fix it.
                </p>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <Link
                  href="/login"
                  className="group mb-4 inline-flex items-center gap-[7px] text-[12.5px] font-medium text-muted transition-colors hover:text-ink"
                >
                  <ArrowLeft size={13} strokeWidth={2.3} className="transition-transform group-hover:-translate-x-[3px]" />
                  Back to sign in
                </Link>

                <h2 className="m-0 mb-[7px] text-[23px] font-extrabold tracking-[-0.035em]">Request access</h2>
                <p className="m-0 mb-[22px] text-[13.6px] text-ink2">
                  Leave your details and we will get back to you within a working day.
                </p>

                {notice && (
                  <div className="mb-4 flex items-start gap-[9px] rounded-[10px] border border-danger/30 bg-danger/[0.07] px-3.5 py-2.5 text-[13px] leading-[1.5] text-[#FFC2CA]">
                    {notice}
                  </div>
                )}

                <div className="grid gap-[11px] sm:grid-cols-2">
                  <Labelled id="name" label="Full name" icon={<User size={15} strokeWidth={1.9} />}>
                    <input
                      id="name"
                      value={v.name}
                      onChange={(e) => set("name", e.target.value)}
                      placeholder="Your name"
                      autoComplete="name"
                      className={`${INPUT} ${bad.name ? "border-danger/50 bg-danger/5" : "border-line2"}`}
                    />
                  </Labelled>
                  <Labelled id="company" label="Company" icon={<Building2 size={15} strokeWidth={1.9} />}>
                    <input
                      id="company"
                      value={v.company}
                      onChange={(e) => set("company", e.target.value)}
                      placeholder="Company name"
                      autoComplete="organization"
                      className={`${INPUT} ${bad.company ? "border-danger/50 bg-danger/5" : "border-line2"}`}
                    />
                  </Labelled>
                </div>

                <Labelled id="email" label="Work email" icon={<Mail size={15} strokeWidth={1.9} />}>
                  <input
                    id="email"
                    type="email"
                    value={v.email}
                    onChange={(e) => set("email", e.target.value)}
                    placeholder="you@company.com"
                    autoComplete="email"
                    className={`${INPUT} ${bad.email ? "border-danger/50 bg-danger/5" : "border-line2"}`}
                  />
                </Labelled>

                <div className="mb-[13px]">
                  <label htmlFor="phone" className="mb-1.5 block text-[12px] font-semibold text-ink2">
                    WhatsApp number
                  </label>
                  <div className="flex">
                    <span className="flex flex-none items-center gap-[7px] rounded-l-[10px] border border-r-0 border-line2 bg-white/5 px-[11px] text-[13.4px] font-medium text-ink2">
                      <Phone size={14} strokeWidth={1.9} className="text-muted" />
                      +91
                    </span>
                    <input
                      id="phone"
                      type="tel"
                      inputMode="numeric"
                      value={v.phone}
                      onChange={(e) => set("phone", e.target.value)}
                      placeholder="98765 43210"
                      autoComplete="tel"
                      className={`${INPUT} rounded-l-none rounded-r-[10px] pl-3 ${bad.phone ? "border-danger/50 bg-danger/5" : "border-line2"}`}
                    />
                  </div>
                </div>

                <label className="mb-[18px] mt-1 flex cursor-pointer items-start gap-2.5 text-[12.8px] leading-[1.55] text-ink2">
                  <input
                    type="checkbox"
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="sr-only"
                  />
                  <span
                    className={`mt-0.5 grid h-4 w-4 flex-none place-items-center rounded-[5px] border transition-colors ${
                      consent ? "border-brand bg-brand text-[#042420]" : "border-line2 bg-white/[0.03] text-transparent"
                    }`}
                  >
                    <Check size={10} strokeWidth={3.4} />
                  </span>
                  You can contact me on WhatsApp and by phone about this request.
                </label>

                <button
                  type="submit"
                  disabled={busy}
                  className="group flex w-full items-center justify-center gap-[9px] rounded-[10px] bg-gradient-to-b from-[#a9f2e8] to-brand px-5 py-3 text-[14.5px] font-semibold text-[#042420] shadow-[0_12px_28px_-12px_rgba(94,234,212,0.7)] transition-transform hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                >
                  {busy ? "Sending…" : "Request access"}
                  {!busy && (
                    <ArrowRight size={15} strokeWidth={2.3} className="transition-transform group-hover:translate-x-[3px]" />
                  )}
                </button>

                <p className="mt-5 text-center text-[13.2px] text-ink2">
                  Already have an account?{" "}
                  <Link href="/login" className="font-semibold text-brand hover:text-[#a9f2e8]">
                    Sign in
                  </Link>
                </p>
                <p className="mt-4 text-center text-[11.2px] leading-[1.65] text-muted">
                  We use these details only to set up your account.
                </p>
              </form>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
