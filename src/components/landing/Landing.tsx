"use client";

import { ReactNode, useEffect } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  Download,
  FileSpreadsheet,
  MessageCircle,
  Music,
  Phone,
  Plus,
  Users2,
  Wallet,
  X,
} from "lucide-react";
import "./landing.css";

/* ------------------------------------------------------------------ */
/* shared bits                                                         */
/* ------------------------------------------------------------------ */

const SECTIONS = [
  { id: "top", label: "Home" },
  { id: "problem", label: "The problem" },
  { id: "sheet", label: "Sheet Auto-Dial" },
  { id: "press1", label: "Press-1 capture" },
  { id: "whatsapp", label: "WhatsApp on answer" },
  { id: "schedule", label: "Scheduling" },
  { id: "dedupe", label: "Dedupe" },
  { id: "reports", label: "Reporting" },
  { id: "extras", label: "And also" },
  { id: "compare", label: "Compare" },
  { id: "faq", label: "FAQ" },
  { id: "cta", label: "Get started" },
];

function Logo({ small }: { small?: boolean }) {
  return (
    <span className="inline-flex items-center gap-[11px] text-[16.5px] font-bold tracking-[-0.025em]">
      <span
        className={`${small ? "h-[25px] w-[25px] rounded-lg" : "h-[30px] w-[30px] rounded-[9px]"} block flex-none overflow-hidden shadow-[0_4px_14px_-4px_rgba(0,0,0,0.7),inset_0_0_0_1px_rgba(255,255,255,0.09)]`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/fwai-logo.png" alt="Freedom With AI" className="h-full w-full object-cover" />
      </span>
      IVR Console <span className="font-medium text-muted">by FWAI</span>
    </span>
  );
}

function Screen({
  id,
  alt,
  children,
  className = "",
}: {
  id: string;
  alt?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={`relative flex min-h-screen scroll-mt-[66px] items-center pb-14 pt-[112px] ${
        alt ? "border-y border-line bg-[#0d1017]" : ""
      } ${className}`}
    >
      {children}
    </section>
  );
}

function Wrap({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`relative z-10 mx-auto w-full max-w-[1360px] px-[clamp(22px,3.6vw,54px)] ${className}`}>
      {children}
    </div>
  );
}

function Eyebrow({ step, children }: { step?: number; children: ReactNode }) {
  return (
    <div className="mb-4 inline-flex items-center gap-[9px] text-[11.5px] font-extrabold uppercase tracking-[0.14em] text-brand">
      {step !== undefined && (
        <em className="grid h-[22px] w-[22px] place-items-center rounded-[7px] bg-brand/10 text-[11px] not-italic shadow-[inset_0_0_0_1px_rgba(94,234,212,0.3)]">
          {step}
        </em>
      )}
      {children}
    </div>
  );
}

function Bullet({ children }: { children: ReactNode }) {
  return (
    <li className="flex items-start gap-[11px] text-[14.5px] leading-[1.55] text-ink2">
      <Check size={15} className="mt-[3px] flex-none text-brand" strokeWidth={2.6} />
      {children}
    </li>
  );
}

function Tag({ tone, children }: { tone: "ok" | "wa" | "no" | "rt" | "bad"; children: ReactNode }) {
  const tones = {
    ok: "bg-brand/10 text-brand shadow-[inset_0_0_0_1px_rgba(94,234,212,0.2)]",
    // WhatsApp keeps its own green — it is a brand colour, not our accent.
    wa: "bg-[rgba(37,211,102,0.1)] text-[#4FD37E] shadow-[inset_0_0_0_1px_rgba(37,211,102,0.18)]",
    no: "bg-white/5 text-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]",
    rt: "bg-warn/10 text-warn shadow-[inset_0_0_0_1px_rgba(245,158,11,0.2)]",
    bad: "bg-danger/10 text-danger shadow-[inset_0_0_0_1px_rgba(239,68,68,0.2)]",
  }[tone];
  return (
    <span className={`inline-flex items-center gap-[5px] whitespace-nowrap rounded-full px-[9px] py-[3px] text-[10.8px] font-semibold ${tones}`}>
      {children}
    </span>
  );
}

/** The chrome each product visual sits in — a small window with a title bar. */
function VCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden rounded-[18px] border border-line2 bg-gradient-to-b from-[rgba(22,26,35,0.96)] to-[rgba(13,16,21,0.98)] shadow-[0_50px_100px_-50px_#000,inset_0_1px_0_rgba(255,255,255,0.05)] before:absolute before:inset-x-[26px] before:-top-px before:h-px before:bg-gradient-to-r before:from-transparent before:via-brand/50 before:to-transparent before:content-['']">
      <div className="flex items-center justify-between gap-3 border-b border-line bg-white/[0.02] px-4 py-3 text-[12px] text-ink2">
        <span className="flex gap-[6px]">
          <i className="block h-2 w-2 rounded-full bg-[#252B36]" />
          <i className="block h-2 w-2 rounded-full bg-[#252B36]" />
          <i className="block h-2 w-2 rounded-full bg-[#252B36]" />
        </span>
        <span>{title}</span>
      </div>
      <div className="p-[18px]">{children}</div>
    </div>
  );
}

function Note({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-3 flex items-center gap-[9px] rounded-[10px] border border-brand/25 bg-brand/[0.06] px-3 py-[9px] text-[12.2px] text-[#a9f2e8]">
      <span className="flex-none text-brand">{icon}</span>
      {children}
    </div>
  );
}

function Duo({ reverse, text, visual }: { reverse?: boolean; text: ReactNode; visual: ReactNode }) {
  return (
    <div className="grid w-full items-center gap-9 md:grid-cols-[1fr_1.12fr] md:gap-[clamp(38px,5vw,84px)]">
      <div className={`lp-rv ${reverse ? "md:order-2" : ""}`}>{text}</div>
      <div className={`lp-rv lp-d1 ${reverse ? "md:order-1" : ""}`}>{visual}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* page                                                                */
/* ------------------------------------------------------------------ */

export default function Landing() {
  // Reveal blocks as they scroll in, and light the matching dot in the rail.
  useEffect(() => {
    const reveal = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            reveal.unobserve(e.target);
          }
        });
      },
      { threshold: 0.16, rootMargin: "0px 0px -8% 0px" },
    );
    document.querySelectorAll(".lp-rv").forEach((el) => reveal.observe(el));

    const dots = Array.from(document.querySelectorAll<HTMLAnchorElement>("[data-rail]"));
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          dots.forEach((d) =>
            d.classList.toggle("is-on", d.dataset.rail === e.target.id),
          );
        });
      },
      { threshold: 0.5 },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) spy.observe(el);
    });

    return () => {
      reveal.disconnect();
      spy.disconnect();
    };
  }, []);

  return (
    <div className="bg-bg text-ink">
      {/* ------------------------------------------------ nav */}
      <nav className="fixed inset-x-0 top-0 z-50 h-[66px] border-b border-line bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-[66px] max-w-[1360px] items-center justify-between px-[clamp(22px,3.6vw,54px)]">
          <a href="#top">
            <Logo />
          </a>
          <div className="hidden gap-7 text-[14px] text-ink2 lg:flex">
            {["problem", "sheet", "press1", "whatsapp", "compare", "faq"].map((id) => (
              <a key={id} href={`#${id}`} className="transition-colors hover:text-ink">
                {SECTIONS.find((s) => s.id === id)?.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-[9px]">
            <a
              href="/login"
              className="rounded-[9px] border border-line2 px-[15px] py-2 text-[13.2px] font-semibold text-ink transition-colors hover:border-white/30 hover:bg-white/5"
            >
              Sign in
            </a>
            <a
              href="/login"
              className="rounded-[9px] bg-gradient-to-b from-[#a9f2e8] to-brand px-[15px] py-2 text-[13.2px] font-semibold text-[#042420] shadow-[0_12px_28px_-12px_rgba(94,234,212,0.7)] transition-transform hover:-translate-y-px"
            >
              Start dialling
            </a>
          </div>
        </div>
      </nav>

      {/* ------------------------------------------------ dot rail */}
      <div className="fixed right-5 top-1/2 z-40 hidden -translate-y-1/2 flex-col gap-[11px] xl:flex">
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            data-rail={s.id}
            aria-label={s.label}
            className="group relative h-2 w-2 rounded-full bg-white/20 transition-all duration-200 hover:bg-white/40 [&.is-on]:h-[22px] [&.is-on]:bg-brand [&.is-on]:shadow-[0_0_12px_rgba(94,234,212,0.6)]"
          >
            <span className="pointer-events-none absolute right-[18px] top-1/2 -translate-y-1/2 translate-x-1.5 whitespace-nowrap rounded-[7px] border border-line2 bg-[rgba(12,15,20,0.95)] px-[9px] py-1 text-[11.5px] font-semibold text-ink2 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100">
              {s.label}
            </span>
          </a>
        ))}
      </div>

      {/* ================================================ 01 hero */}
      <Screen id="top" className="text-center">
        <div className="absolute inset-0 overflow-hidden">
          <div className="lp-grid" />
          <div className="lp-glow left-1/2 top-[-340px] h-[790px] w-[1100px] -translate-x-1/2" />
          <div className="lp-vignette" />
        </div>
        <Wrap>
          <div className="lp-rv is-in">
            <div className="mb-[26px] inline-flex items-center gap-2 rounded-full border border-line2 bg-white/[0.03] py-[6px] pl-[10px] pr-[15px] text-[12.5px] text-ink2">
              <span className="lp-live h-[7px] w-[7px] flex-none rounded-full bg-brand" />
              <b className="font-semibold text-brand">Live now</b>
              <span className="text-muted">·</span> scheduled campaigns + WhatsApp-on-answer
            </div>
            <h1 className="m-0 mb-[22px] text-[clamp(36px,5.4vw,70px)] font-extrabold leading-[1.02] tracking-[-0.045em]">
              Turn a Google Sheet into
              <br />
              <span className="lp-g">thousands of phone calls.</span>
            </h1>
            <p className="mx-auto mb-0 max-w-[720px] text-[clamp(15.5px,1.35vw,18px)] leading-[1.65] text-ink2">
              IVR Console is FWAI&rsquo;s outbound calling desk. Connect a sheet, pick a recording, and it dials
              your whole list, captures press-1 interest, fires WhatsApp the moment someone picks up — and hands
              you a clean report.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-[11px]">
              <a
                href="/login"
                className="group inline-flex items-center justify-center gap-[9px] rounded-[11px] bg-gradient-to-b from-[#a9f2e8] to-brand px-[26px] py-[13.5px] text-[15.5px] font-semibold text-[#042420] shadow-[0_12px_28px_-12px_rgba(94,234,212,0.7)] transition-transform hover:-translate-y-px"
              >
                Start dialling
                <ArrowRight size={16} strokeWidth={2.3} className="transition-transform group-hover:translate-x-[3px]" />
              </a>
              <a
                href="#problem"
                className="inline-flex items-center justify-center rounded-[11px] border border-line2 px-[26px] py-[13.5px] text-[15.5px] font-semibold text-ink transition-colors hover:border-white/30 hover:bg-white/5"
              >
                See how it works
              </a>
            </div>
            <p className="mt-5 text-[12.8px] text-muted">
              No caller team. No per-seat licences. Pay only for what you dial.
            </p>
            <div className="mt-[50px] flex flex-wrap justify-center gap-[clamp(28px,4vw,58px)]">
              {[
                // Live figure, 10 Oct 2026: 43,903 calls placed in the previous 30 days.
                ["40,000+", "Calls a month"],
                ["100%", "Answered → WhatsApp"],
                ["5 min", "Sheet polling"],
                ["Zero", "Duplicates dialled"],
              ].map(([n, l]) => (
                <div key={l}>
                  <b className="block text-[clamp(21px,2.3vw,30px)] font-extrabold leading-[1.1] tracking-[-0.04em] tabular-nums">
                    {n}
                  </b>
                  <span className="text-[12.5px] text-muted">{l}</span>
                </div>
              ))}
            </div>
          </div>
        </Wrap>
        <div className="lp-cue absolute bottom-6 left-1/2 flex flex-col items-center gap-[7px] text-[11px] uppercase tracking-[0.1em] text-muted">
          Scroll
          <ChevronDown size={14} />
        </div>
      </Screen>

      {/* ================================================ 02 problem */}
      <Screen id="problem" alt>
        <Wrap>
          <div className="lp-rv">
            <Eyebrow>The problem</Eyebrow>
            <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
              Bulk calling in India is still
              <br />
              held together by people.
            </h2>
            <p className="m-0 max-w-[700px] text-[clamp(15.5px,1.35vw,18px)] leading-[1.65] text-ink2">
              Every team runs the same broken loop: export a sheet, hand it to callers, chase who picked up,
              copy-paste WhatsApp links one by one, and reconcile it all on Monday.
            </p>
          </div>
          <div className="mt-11 grid gap-4 md:grid-cols-2">
            {[
              ["The list goes stale before it’s dialled", "Registrations keep arriving after you export. By the time the team calls, half the list is old and the newest leads never got a call at all."],
              ["The same person gets called three times", "Two tabs, two exports, one lead. Nobody dedupes by phone number, so your best leads get spammed and your quiet ones get missed."],
              ["Interest dies between the call and the follow-up", "Someone picks up, says yes, then waits four hours for a link. The intent is long gone before the message arrives."],
              ["Nobody can prove what actually happened", "“How many did we reach?” becomes a two-hour spreadsheet reconstruction — no answer rate, no press-1 count, no per-sheet breakdown."],
            ].map(([h, p], i) => (
              <div
                key={h}
                className={`lp-rv ${["", "lp-d1", "lp-d2", "lp-d3"][i]} rounded-2xl border border-line bg-gradient-to-b from-[rgba(22,26,35,0.6)] to-[rgba(15,18,24,0.6)] px-7 py-[26px]`}
              >
                <span className="mb-[15px] grid h-7 w-7 place-items-center rounded-[9px] bg-danger/10 text-danger shadow-[inset_0_0_0_1px_rgba(239,68,68,0.2)]">
                  <X size={15} strokeWidth={2.4} />
                </span>
                <h4 className="m-0 mb-2 text-[16.5px] font-bold tracking-[-0.025em]">{h}</h4>
                <p className="m-0 text-[14.2px] leading-[1.6] text-ink2">{p}</p>
              </div>
            ))}
          </div>
        </Wrap>
      </Screen>

      {/* ================================================ 03 sheet auto-dial */}
      <Screen id="sheet">
        <div className="absolute inset-0 overflow-hidden">
          <div className="lp-glow-soft left-[-320px] top-1/2 h-[760px] w-[820px] -translate-y-1/2" />
        </div>
        <Wrap>
          <Duo
            text={
              <>
                <Eyebrow step={1}>Sheet Auto-Dial</Eyebrow>
                <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
                  Your sheet <span className="lp-g">is</span> the dialler list.
                </h2>
                <p className="m-0 max-w-[520px] text-[clamp(15.5px,1.35vw,18px)] leading-[1.65] text-ink2">
                  Paste a Google Sheet URL, pick the exact tab, and the console takes it from there — polling
                  every five minutes and dialling only the rows it has never seen.
                </p>
                <ul className="m-0 mt-6 grid list-none gap-[11px] p-0">
                  <Bullet>Target a specific tab, not just the first sheet</Bullet>
                  <Bullet>Preview the rows and the number column before a single call</Bullet>
                  <Bullet>Late registrations get called without anyone re-exporting</Bullet>
                </ul>
                <a
                  href="/login"
                  className="group mt-[26px] inline-flex items-center justify-center gap-[9px] rounded-[10px] bg-gradient-to-b from-[#a9f2e8] to-brand px-5 py-[11px] text-[14.5px] font-semibold text-[#042420] shadow-[0_12px_28px_-12px_rgba(94,234,212,0.7)] transition-transform hover:-translate-y-px"
                >
                  Connect a sheet
                  <ArrowRight size={15} strokeWidth={2.3} className="transition-transform group-hover:translate-x-[3px]" />
                </a>
              </>
            }
            visual={
              <VCard title="Sheet Auto-Dial · new connection">
                <span className="mb-[7px] block text-[10px] font-bold uppercase tracking-[0.09em] text-muted">
                  Google Sheet URL
                </span>
                <div className="flex items-center gap-[9px] rounded-[9px] border border-brand/40 bg-brand/5 px-3 py-[9px] text-[12.8px]">
                  <FileSpreadsheet size={14} className="flex-none text-muted" />
                  docs.google.com/…/Aug-Webinar-Registrations
                  <Check size={15} strokeWidth={2.6} className="ml-auto text-brand" />
                </div>
                <div className="my-3 flex flex-wrap gap-[6px]">
                  {["Responses", "Form 1", "Archive", "Notes"].map((t, i) => (
                    <span
                      key={t}
                      className={`rounded-lg border px-[11px] py-[5px] text-[11.5px] ${
                        i === 0
                          ? "border-brand/40 bg-brand/[0.08] font-semibold text-brand"
                          : "border-line bg-white/[0.02] text-muted"
                      }`}
                    >
                      {t}
                    </span>
                  ))}
                </div>
                <div className="overflow-hidden rounded-[10px] border border-line text-[11.8px]">
                  <div className="grid grid-cols-[1.15fr_1fr_0.8fr] gap-2 border-b border-line bg-white/[0.03] px-3 py-[7.5px] text-[9.5px] font-bold uppercase tracking-[0.09em] text-muted">
                    <span>Name</span>
                    <span>Phone</span>
                    <span>Status</span>
                  </div>
                  {[
                    ["Priya S.", "+91 98••• 41207", "New", true],
                    ["Rahul M.", "+91 90••• 88310", "New", true],
                    ["Anita K.", "+91 76••• 22984", "Dialled", false],
                  ].map(([n, p, s, isNew]) => (
                    <div
                      key={n as string}
                      className={`grid grid-cols-[1.15fr_1fr_0.8fr] gap-2 border-b border-line px-3 py-[7.5px] text-ink2 last:border-b-0 ${
                        isNew ? "bg-brand/5" : ""
                      }`}
                    >
                      <b className="font-medium text-ink">{n}</b>
                      <span className="tabular-nums">{p}</span>
                      <span>
                        <Tag tone={isNew ? "ok" : "no"}>{s}</Tag>
                      </span>
                    </div>
                  ))}
                </div>
                <Note icon={<Clock size={14} strokeWidth={2.2} />}>
                  Polling every 5 minutes — 412 new rows picked up since 09:00
                </Note>
              </VCard>
            }
          />
        </Wrap>
      </Screen>

      {/* ================================================ 04 press-1 */}
      <Screen id="press1" alt>
        <Wrap>
          <Duo
            reverse
            text={
              <>
                <Eyebrow step={2}>Press-1 IVR capture</Eyebrow>
                <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
                  The people who care
                  <br />
                  <span className="lp-g">put their hand up.</span>
                </h2>
                <p className="m-0 max-w-[520px] text-[clamp(15.5px,1.35vw,18px)] leading-[1.65] text-ink2">
                  Your recording plays, the keypress is captured, and interested leads are split out of the list
                  the moment they press 1 — no caller writing names on a notepad.
                </p>
                <ul className="m-0 mt-6 grid list-none gap-[11px] p-0">
                  <Bullet>Your own audio, uploaded once and reused</Bullet>
                  <Bullet>Press-1 recorded per lead, not per campaign</Bullet>
                  <Bullet>No-answers queue themselves for a retry</Bullet>
                </ul>
              </>
            }
            visual={
              <VCard title="Live call · +91 98••• 41207">
                <div className="mb-[14px] flex items-center gap-[14px] rounded-xl border border-line bg-white/[0.025] p-[14px]">
                  <span className="flex h-[30px] items-center gap-[3px]">
                    {[9, 19, 27, 14, 22, 11, 24].map((h, i) => (
                      <i
                        key={i}
                        className="lp-bar-eq w-[3px] rounded-full bg-brand opacity-85"
                        style={{ height: h, animationDelay: `${i * 0.1}s` }}
                      />
                    ))}
                  </span>
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold">webinar-reminder.mp3</div>
                    <div className="text-[11.5px] text-muted">Playing · 0:14 / 0:22</div>
                  </div>
                  <Tag tone="ok">Answered</Tag>
                </div>
                <span className="mb-[7px] block text-[10px] font-bold uppercase tracking-[0.09em] text-muted">
                  Caller keypad
                </span>
                <div className="grid grid-cols-3 gap-[7px]">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => (
                    <div
                      key={k}
                      className={`grid aspect-[1.55] place-items-center rounded-[10px] border text-[15px] font-semibold ${
                        k === 1
                          ? "lp-press border-brand bg-gradient-to-b from-[#a9f2e8] to-brand font-extrabold text-[#042420] shadow-[0_0_22px_-4px_rgba(94,234,212,0.7)]"
                          : "border-line bg-white/[0.022] text-muted"
                      }`}
                    >
                      {k}
                    </div>
                  ))}
                </div>
                <Note icon={<Check size={14} strokeWidth={2.4} />}>
                  Pressed 1 — moved to the interested list, 731 so far today
                </Note>
              </VCard>
            }
          />
        </Wrap>
      </Screen>

      {/* ================================================ 05 whatsapp */}
      <Screen id="whatsapp">
        <div className="absolute inset-0 overflow-hidden">
          <div className="lp-glow-soft right-[-320px] top-1/2 h-[760px] w-[820px] -translate-y-1/2" />
        </div>
        <Wrap>
          <Duo
            text={
              <>
                <Eyebrow step={3}>WhatsApp on answer</Eyebrow>
                <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
                  The link lands
                  <br />
                  <span className="lp-g">while they are still holding the phone.</span>
                </h2>
                <p className="m-0 max-w-[520px] text-[clamp(15.5px,1.35vw,18px)] leading-[1.65] text-ink2">
                  Not after a press-1. Not in a batch that evening. The message fires the second the call is
                  answered, which is the only moment the intent is still warm.
                </p>
                <ul className="m-0 mt-6 grid list-none gap-[11px] p-0">
                  <Bullet>Fires on pickup, not on keypress</Bullet>
                  <Bullet>100% of answered calls got a message in production</Bullet>
                  <Bullet>Bulk WhatsApp campaigns run server-side too</Bullet>
                </ul>
              </>
            }
            visual={
              <VCard title="Follow-up timeline">
                <div className="grid">
                  {[
                    { icon: <Phone size={12} strokeWidth={2.2} />, h: "Call dialled", p: "Ringing…", ts: "14:02:03" },
                    { icon: <Check size={12} strokeWidth={2.6} />, h: "Answered", p: "Recording starts playing", ts: "14:02:09" },
                  ].map((e) => (
                    <div key={e.h} className="relative flex items-start gap-[13px] pb-4 before:absolute before:bottom-0.5 before:left-[11px] before:top-[26px] before:w-px before:bg-gradient-to-b before:from-brand/40 before:to-line before:content-['']">
                      <span className="relative z-10 grid h-[23px] w-[23px] flex-none place-items-center rounded-full bg-brand/10 text-brand shadow-[inset_0_0_0_1px_rgba(94,234,212,0.3)]">
                        {e.icon}
                      </span>
                      <div>
                        <h6 className="my-0.5 text-[13px] font-semibold tracking-[-0.01em]">{e.h}</h6>
                        <p className="m-0 text-[12px] text-muted">{e.p}</p>
                      </div>
                      <span className="ml-auto whitespace-nowrap pt-[3px] text-[11px] tabular-nums text-muted">{e.ts}</span>
                    </div>
                  ))}
                  <div className="relative flex items-start gap-[13px]">
                    <span className="relative z-10 grid h-[23px] w-[23px] flex-none place-items-center rounded-full bg-[rgba(37,211,102,0.13)] text-[#4FD37E] shadow-[inset_0_0_0_1px_rgba(37,211,102,0.3)]">
                      <MessageCircle size={12} strokeWidth={2} />
                    </span>
                    <div className="flex-1">
                      <h6 className="my-0.5 text-[13px] font-semibold text-[#4FD37E]">WhatsApp sent</h6>
                      <div className="mt-1 max-w-[300px] rounded-[12px_12px_12px_3px] bg-[rgba(37,211,102,0.1)] px-[13px] py-[10px] text-[12.4px] leading-[1.5] text-[#D5F7E2] shadow-[inset_0_0_0_1px_rgba(37,211,102,0.22)]">
                        Hi Priya — here’s your joining link for tonight’s 7 PM session. See you there!
                        <div className="mt-[5px] flex items-center justify-end gap-[5px] text-[10px] text-[rgba(213,247,226,0.6)]">
                          14:02 <Check size={12} strokeWidth={2.4} className="text-[#4FD37E]" />
                        </div>
                      </div>
                    </div>
                    <span className="ml-auto whitespace-nowrap pt-[3px] text-[11px] tabular-nums text-muted">14:02:10</span>
                  </div>
                </div>
                <Note icon={<Clock size={14} strokeWidth={2.2} />}>One second between pickup and message</Note>
              </VCard>
            }
          />
        </Wrap>
      </Screen>

      {/* ================================================ 06 scheduling */}
      <Screen id="schedule" alt>
        <Wrap>
          <Duo
            reverse
            text={
              <>
                <Eyebrow step={4}>Scheduling &amp; repeats</Eyebrow>
                <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
                  Set 7 PM once.
                  <br />
                  <span className="lp-g">It goes out at 7 PM.</span>
                </h2>
                <p className="m-0 max-w-[520px] text-[clamp(15.5px,1.35vw,18px)] leading-[1.65] text-ink2">
                  One-off or recurring, calls or bulk WhatsApp. Scheduling runs on the server, so nothing depends
                  on someone leaving a browser tab open.
                </p>
                <ul className="m-0 mt-6 grid list-none gap-[11px] p-0">
                  <Bullet>One-off at a set time, or repeating on chosen days</Bullet>
                  <Bullet>Server-driven — no browser, no laptop, no babysitting</Bullet>
                  <Bullet>Queued runs are visible and cancellable before they fire</Bullet>
                </ul>
              </>
            }
            visual={
              <VCard title="Schedule · bootcamp-day2">
                <div className="mb-3 flex flex-wrap gap-[9px]">
                  <span className="flex items-center gap-2 rounded-[9px] border border-brand/40 bg-brand/[0.08] px-3 py-2 text-[12.4px] font-semibold text-brand">
                    <Clock size={13} /> 19:00 IST
                  </span>
                  <span className="flex items-center rounded-[9px] border border-line bg-white/[0.025] px-3 py-2 text-[12.4px] text-ink2">
                    Send now
                  </span>
                  <span className="ml-auto flex items-center gap-[11px] rounded-[9px] border border-line bg-white/[0.025] px-3 py-2 text-[12.4px] text-ink2">
                    Repeat
                    <span className="relative h-[21px] w-[38px] flex-none rounded-full bg-brand shadow-[0_0_16px_-4px_rgba(94,234,212,0.7)] after:absolute after:right-[2.5px] after:top-[2.5px] after:h-4 after:w-4 after:rounded-full after:bg-[#042420] after:content-['']" />
                  </span>
                </div>
                <span className="mb-[7px] block text-[10px] font-bold uppercase tracking-[0.09em] text-muted">
                  Repeat on
                </span>
                <div className="mb-[13px] grid grid-cols-7 gap-[6px]">
                  {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                    <div
                      key={i}
                      className={`grid aspect-square place-items-center rounded-lg border text-[11px] font-semibold ${
                        i < 5
                          ? "border-brand/40 bg-brand/10 text-brand"
                          : "border-line bg-white/[0.022] text-muted"
                      }`}
                    >
                      {d}
                    </div>
                  ))}
                </div>
                <span className="mb-[7px] block text-[10px] font-bold uppercase tracking-[0.09em] text-muted">
                  Next runs
                </span>
                {[
                  ["Tomorrow · 19:00", "rt", "Queued"],
                  // Weekdays only — a dated mock ("Thu 29 Aug") goes stale.
                  ["Thursday · 19:00", "no", "Scheduled"],
                  ["Friday · 19:00", "no", "Scheduled"],
                ].map(([l, tone, s]) => (
                  <div key={l as string} className="flex items-center justify-between gap-3 border-b border-line py-[9px] text-[12.8px] text-ink2 last:border-b-0">
                    <b className="font-medium text-ink">{l}</b>
                    <Tag tone={tone as "rt" | "no"}>{s}</Tag>
                  </div>
                ))}
              </VCard>
            }
          />
        </Wrap>
      </Screen>

      {/* ================================================ 07 dedupe */}
      <Screen id="dedupe">
        <div className="absolute inset-0 overflow-hidden">
          <div className="lp-glow-soft left-[-320px] top-1/2 h-[760px] w-[820px] -translate-y-1/2" />
        </div>
        <Wrap>
          <Duo
            text={
              <>
                <Eyebrow step={5}>Phone-based dedupe</Eyebrow>
                <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
                  One lead.
                  <br />
                  <span className="lp-g">One call.</span>
                </h2>
                <p className="m-0 max-w-[520px] text-[clamp(15.5px,1.35vw,18px)] leading-[1.65] text-ink2">
                  Deduplication runs on the number itself, not on the row. Two tabs, two exports and a re-import
                  of the same list still add up to a single call per person.
                </p>
                <ul className="m-0 mt-6 grid list-none gap-[11px] p-0">
                  <Bullet>Matches across tabs, exports and repeat runs</Bullet>
                  <Bullet>Duplicates are shown in the report, not silently dropped</Bullet>
                  <Bullet>Your best leads stop getting spammed</Bullet>
                </ul>
              </>
            }
            visual={
              <VCard title="Import preview · 430 rows">
                {[
                  ["+91 98••• 41207", false, "Will dial"],
                  ["+91 90••• 88310", false, "Will dial"],
                  ["+91 98••• 41207", true, "Duplicate · Form 1"],
                  ["+91 76••• 22984", false, "Will dial"],
                  ["+91 90••• 88310", true, "Duplicate · Archive"],
                ].map(([num, dup, label], i) => (
                  <div
                    key={i}
                    className={`mb-[7px] flex items-center justify-between gap-3 rounded-[10px] border bg-white/[0.022] px-3 py-[9.5px] text-[12.8px] ${
                      dup ? "border-dashed border-line opacity-55" : "border-line"
                    }`}
                  >
                    <span className={`font-medium text-ink ${dup ? "line-through decoration-danger" : ""}`}>
                      {num}
                    </span>
                    <Tag tone={dup ? "bad" : "ok"}>{label}</Tag>
                  </div>
                ))}
                <Note icon={<Check size={14} strokeWidth={2.4} />}>
                  412 will dial · 18 duplicates caught before a single call
                </Note>
              </VCard>
            }
          />
        </Wrap>
      </Screen>

      {/* ================================================ 08 reports */}
      <Screen id="reports" alt>
        <Wrap>
          <Duo
            reverse
            text={
              <>
                <Eyebrow step={6}>Per-sheet reporting</Eyebrow>
                <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
                  The client asks.
                  <br />
                  <span className="lp-g">You send the file.</span>
                </h2>
                <p className="m-0 max-w-[520px] text-[clamp(15.5px,1.35vw,18px)] leading-[1.65] text-ink2">
                  Answer rate, press-1 count, duplicates, retries and full call detail — per sheet connection,
                  ready the same day as CSV or XLSX. No Monday reconstruction.
                </p>
                <ul className="m-0 mt-6 grid list-none gap-[11px] p-0">
                  <Bullet>One report per sheet connection, not one giant dump</Bullet>
                  <Bullet>CSV for your tools, XLSX for the client</Bullet>
                  <Bullet>Every call row is there if anyone questions the numbers</Bullet>
                </ul>
              </>
            }
            visual={
              <VCard title="Report · Aug Webinar Registrations">
                <div className="mb-[13px] grid grid-cols-3 gap-[9px]">
                  {[["Dialled", "4,182"], ["Answered", "2,914"], ["Press-1", "731"]].map(([l, v]) => (
                    <div key={l} className="rounded-[10px] border border-line bg-white/[0.025] px-3 py-[11px]">
                      <span className="mb-1 block text-[9.5px] font-bold uppercase tracking-[0.09em] text-muted">{l}</span>
                      <b className="text-[18px] font-extrabold tracking-[-0.04em] tabular-nums">{v}</b>
                    </div>
                  ))}
                </div>
                <span className="mb-[7px] block text-[10px] font-bold uppercase tracking-[0.09em] text-muted">
                  Answer rate
                </span>
                <div className="mb-[14px] h-[5px] overflow-hidden rounded-full bg-white/[0.07]">
                  <i className="block h-full rounded-full bg-gradient-to-r from-[#14B8A6] via-brand to-[#a9f2e8]" style={{ width: "69.7%" }} />
                </div>
                {[
                  ["Duplicates skipped", "18"],
                  ["Retries queued", "1,268"],
                  ["WhatsApp delivered", "2,914 · 100%"],
                ].map(([l, v]) => (
                  <div key={l} className="flex items-center justify-between gap-3 border-b border-line py-[9px] text-[12.8px] text-ink2 last:border-b-0">
                    <b className="font-medium text-ink">{l}</b>
                    <span className="tabular-nums">{v}</span>
                  </div>
                ))}
                <div className="mt-3 flex gap-2">
                  {["CSV", "XLSX"].map((f) => (
                    <span key={f} className="flex flex-1 items-center justify-center gap-2 rounded-[9px] border border-line2 bg-white/[0.025] py-[9px] text-[12.2px] font-semibold text-ink2">
                      <Download size={14} /> {f}
                    </span>
                  ))}
                </div>
              </VCard>
            }
          />
        </Wrap>
      </Screen>

      {/* ================================================ 09 extras */}
      <Screen id="extras" className="text-center">
        <div className="absolute inset-0 overflow-hidden">
          <div className="lp-glow left-1/2 top-[-340px] h-[790px] w-[1100px] -translate-x-1/2 opacity-55" />
        </div>
        <Wrap>
          <div className="lp-rv">
            <Eyebrow>And also</Eyebrow>
            <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
              The parts that keep it
              <br />
              <span className="lp-g">running as a business.</span>
            </h2>
            <p className="mx-auto m-0 max-w-[640px] text-[clamp(15.5px,1.35vw,18px)] leading-[1.65] text-ink2">
              Everything above is the dialling. These are the pieces that make it survivable once you are running
              it for more than one client.
            </p>
          </div>
          <div className="mt-11 grid gap-4 md:grid-cols-3">
            {[
              [<Music key="m" size={18} />, "Audio library", "Upload once, reuse across campaigns. Swap the recording without rebuilding the list or touching the schedule."],
              [<Wallet key="w" size={18} />, "Wallet & GST invoices", "Top up the wallet and get a proper GST invoice as a PDF automatically — for you and for the client. Your accountant stops asking."],
              [<Users2 key="u" size={18} />, "Multi-tenant by default", "Separate clients, separate lists, separate wallets, separate reports. Run your whole book of business from one console."],
            ].map(([icon, h, p], i) => (
              <div
                key={h as string}
                className={`lp-rv ${["", "lp-d1", "lp-d2"][i]} rounded-2xl border border-line bg-gradient-to-b from-[rgba(22,26,35,0.6)] to-[rgba(15,18,24,0.6)] p-7 text-left transition-all duration-200 hover:-translate-y-[3px] hover:border-brand/35`}
              >
                <span className="mb-4 grid h-[38px] w-[38px] place-items-center rounded-[11px] bg-brand/10 text-brand shadow-[inset_0_0_0_1px_rgba(94,234,212,0.22)]">
                  {icon}
                </span>
                <h4 className="m-0 mb-2 text-[16.5px] font-bold tracking-[-0.025em]">{h}</h4>
                <p className="m-0 text-[14.2px] leading-[1.6] text-ink2">{p}</p>
              </div>
            ))}
          </div>
        </Wrap>
      </Screen>

      {/* ================================================ 10 compare */}
      <Screen id="compare" alt>
        <Wrap>
          <div className="lp-rv">
            <Eyebrow>Us vs. the rest</Eyebrow>
            <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
              Against a caller team,
              <br />
              and against a generic dialler.
            </h2>
          </div>
          <div className="lp-rv lp-d1 mt-10 overflow-hidden rounded-2xl border border-line bg-white/[0.02]">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] border-collapse text-[14px]">
                <thead>
                  <tr>
                    {[
                      ["Capability", false],
                      ["IVR Console", true],
                      ["Manual caller team", false],
                      ["Generic dialler", false],
                    ].map(([h, us]) => (
                      <th
                        key={h as string}
                        className={`border-b border-line bg-white/[0.03] px-[22px] py-[14px] text-left text-[10.5px] font-bold uppercase tracking-[0.09em] ${
                          us ? "text-brand" : "text-muted"
                        }`}
                        style={h === "Capability" ? { width: "28%" } : undefined}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Picks up new sheet rows on its own", "Every 5 minutes", "Re-export by hand", "CSV upload only"],
                    ["Duplicate protection", "By phone number", "Human memory", "Per-file at best"],
                    ["WhatsApp on pickup", "Same second", "Copy-paste, hours later", "Separate tool"],
                    ["Press-1 intent capture", "Built in, per lead", "Noted in a sheet", "Usually an add-on"],
                    ["Recurring campaigns", "One-off + repeating", "Someone remembers", "Rare"],
                    ["Client-ready report", "CSV + XLSX per sheet", "Rebuilt manually", "Raw call logs"],
                    ["GST invoice per top-up", "Auto-generated PDF", "Not applicable", "Rarely India-ready"],
                    ["Cost to scale 10×", "Same team, more minutes", "10× the people", "Per-seat licences"],
                  ].map(([cap, us, them1, them2]) => (
                    <tr key={cap}>
                      <td className="border-b border-line px-[22px] py-[14px] text-ink2">{cap}</td>
                      <td className="border-b border-line bg-brand/[0.045] px-[22px] py-[14px] font-semibold text-ink">
                        <span className="inline-flex items-center gap-2">
                          <Check size={14} strokeWidth={2.6} className="flex-none text-brand" />
                          {us}
                        </span>
                      </td>
                      <td className="border-b border-line px-[22px] py-[14px] text-muted">{them1}</td>
                      <td className="border-b border-line px-[22px] py-[14px] text-muted">{them2}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Wrap>
      </Screen>

      {/* ================================================ 11 faq */}
      <Screen id="faq" className="text-center">
        <Wrap>
          <div className="lp-rv">
            <Eyebrow>FAQ</Eyebrow>
            <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
              Questions people ask first.
            </h2>
          </div>
          <div className="lp-faq lp-rv lp-d1 mx-auto mt-10 w-full max-w-[900px] text-left">
            {[
              ["Do I have to upload a CSV every time?", "No. You connect a Google Sheet tab once. The console re-reads it every five minutes and dials only the new rows, so late registrations get called without anyone re-exporting anything."],
              ["What stops the same person being called twice?", "Dedupe runs on the phone number itself, not on the row. If the same number appears in two tabs, two exports or two runs of the same connection, it is dialled once and the rest are marked as duplicates in the report."],
              ["When exactly does the WhatsApp go out?", "The moment the call is answered — not after a press-1, and not in a batch later. Answered calls get the message while the person is still holding the phone."],
              ["Can I schedule campaigns for later, or on repeat?", "Yes — one-off at a set time, or repeating on a schedule, for both calls and bulk WhatsApp. Scheduling runs on the server, so nothing depends on a browser tab staying open."],
              ["What do I get at the end of a campaign?", "A per-sheet report for each connection: dialled, answered, press-1, duplicates, retries and full call detail — downloadable as CSV or XLSX and ready to send to the client as-is."],
              ["How does billing and GST work?", "You top up a wallet and spend it on minutes. Every top-up generates a GST invoice as a PDF automatically, for both you and your client, so nothing has to be reconstructed at month end."],
              ["Can I run multiple clients from one login?", "Yes. It is multi-tenant — separate clients with their own lists, wallets, campaigns and reports, all managed from a single console."],
            ].map(([q, a], i) => (
              <details
                key={q}
                open={i === 0}
                className="mb-[9px] overflow-hidden rounded-[13px] border border-line bg-white/[0.022] transition-colors open:border-line2 open:bg-white/[0.032]"
              >
                <summary className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 text-[14.8px] font-semibold tracking-[-0.02em]">
                  {q}
                  <span className="lp-plus grid h-[22px] w-[22px] flex-none place-items-center rounded-[7px] bg-brand/10 text-brand shadow-[inset_0_0_0_1px_rgba(94,234,212,0.22)] transition-transform duration-200">
                    <Plus size={12} strokeWidth={2.6} />
                  </span>
                </summary>
                <p className="m-0 px-5 pb-[18px] text-[14px] leading-[1.65] text-ink2">{a}</p>
              </details>
            ))}
          </div>
        </Wrap>
      </Screen>

      {/* ================================================ 12 cta */}
      <section id="cta" className="relative overflow-hidden py-[110px] text-center">
        <div className="absolute inset-0 overflow-hidden">
          <div className="lp-glow bottom-[-360px] left-1/2 h-[790px] w-[1100px] -translate-x-1/2" />
        </div>
        <Wrap>
          <div className="lp-rv">
            <h2 className="m-0 mb-[18px] text-[clamp(28px,3.6vw,48px)] font-extrabold leading-[1.06] tracking-[-0.042em]">
              Stop dialling by hand.
            </h2>
            <p className="mx-auto m-0 max-w-[600px] text-[clamp(15.5px,1.35vw,18px)] leading-[1.65] text-ink2">
              Connect your first sheet today and watch the first hundred calls go out before lunch.
            </p>
            <div className="mt-8 flex flex-wrap justify-center gap-[11px]">
              <a
                href="/login"
                className="group inline-flex items-center justify-center gap-[9px] rounded-[11px] bg-gradient-to-b from-[#a9f2e8] to-brand px-[26px] py-[13.5px] text-[15.5px] font-semibold text-[#042420] shadow-[0_12px_28px_-12px_rgba(94,234,212,0.7)] transition-transform hover:-translate-y-px"
              >
                Start dialling
                <ArrowRight size={16} strokeWidth={2.3} className="transition-transform group-hover:translate-x-[3px]" />
              </a>
              <a
                href="/request-access"
                className="inline-flex items-center justify-center rounded-[11px] border border-line2 px-[26px] py-[13.5px] text-[15.5px] font-semibold text-ink transition-colors hover:border-white/30 hover:bg-white/5"
              >
                Request access
              </a>
            </div>
            <p className="mt-5 text-[12.8px] text-muted">
              Onboarding is hands-on — we set up your first campaign with you.
            </p>
          </div>
        </Wrap>
      </section>

      {/* ================================================ footer */}
      <footer className="border-t border-line bg-[#0d1017] pb-[30px] pt-[50px] text-[13.8px]">
        <Wrap>
          <div className="flex flex-wrap justify-between gap-[clamp(30px,6vw,90px)]">
            <div>
              <a href="#top" className="mb-[14px] inline-block">
                <Logo small />
              </a>
              <p className="m-0 max-w-[290px] text-[13.8px] leading-[1.6] text-ink2">
                Outbound IVR and WhatsApp campaigns, run straight from a Google Sheet. Built by FWAI.
              </p>
            </div>
            <div>
              <h5 className="m-0 mb-[13px] text-[10.5px] font-bold uppercase tracking-[0.11em] text-muted">
                Product
              </h5>
              {[
                ["sheet", "Sheet Auto-Dial"],
                ["press1", "Press-1 capture"],
                ["whatsapp", "WhatsApp on answer"],
                ["reports", "Reporting"],
              ].map(([id, l]) => (
                <a key={id} href={`#${id}`} className="mb-[9px] block text-ink2 transition-colors hover:text-ink">
                  {l}
                </a>
              ))}
            </div>
          </div>
          <div className="mt-9 flex flex-wrap justify-between gap-4 border-t border-line pt-5 text-[12.5px] text-muted">
            <span>© {new Date().getFullYear()} Freedom With AI. All rights reserved.</span>
            <span>Made in India</span>
          </div>
        </Wrap>
      </footer>
    </div>
  );
}
