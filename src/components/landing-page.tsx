"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { Download, Lock } from "lucide-react";
import { CHANGELOG } from "@/lib/changelog";

// Redirects to the current GitHub release. The binary is deliberately not in
// this deployment — it lived in public/ once, gitignored, so a git-triggered
// deploy served a 404 where the download should be.
const DOWNLOAD_URL = "/Sidenote.dmg";
const APP_URL = "http://localhost:4747";

// Probes the local install. A no-cors fetch resolves (opaque) if anything is
// listening on the port; browsers allow https → http://localhost requests.
function useLocalApp() {
  const [running, setRunning] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`${APP_URL}/api/status`, {
      mode: "no-cors",
      signal: AbortSignal.timeout(2500),
    })
      .then(() => alive && setRunning(true))
      .catch(() => alive && setRunning(false));
    return () => {
      alive = false;
    };
  }, []);
  return running;
}

// Fades a section in the first time it scrolls into view. The hero uses timed
// CSS delays instead; this is for everything below the fold.
function Reveal({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -10% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div
      ref={ref}
      className={`${className} transition-[opacity,transform] duration-1000 [transition-timing-function:cubic-bezier(0.16,1,0.3,1)] ${
        shown ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0"
      }`}
    >
      {children}
    </div>
  );
}

const FEATURE_PILLS = [
  "Local first",
  "Privacy first",
  "Full-text search",
  "Explain any message",
  "Reply drafts",
  "Pinned moments",
  "Notes on people",
  "Look it up",
  "Clean exports",
  "Auto updates",
];

// Sidenote is a Mac app, so this never offers to "open" anything in a browser
// tab — that just showed the local server's web UI and made the product feel
// like a website. If the app is running here, the only useful thing the site
// can tell you is whether there's a newer build to download.
function AlreadyInstalled({ running }: { running: boolean | null }) {
  const latest = CHANGELOG[0];
  if (!running) return null;

  return (
    <div className="mx-auto mt-8 max-w-md rounded-3xl border border-[#30d158]/30 bg-[#30d158]/[0.07] p-5 text-center">
      <p className="flex items-center justify-center gap-2 text-[13.5px] font-medium">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#30d158] opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-[#30d158]" />
        </span>
        Sidenote is installed on this Mac
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]">
        Latest version is{" "}
        <span className="font-medium text-[#111] dark:text-[#f5f5f7]">{latest.date}</span> —{" "}
        {latest.title.charAt(0).toLowerCase() + latest.title.slice(1)}. Open Sidenote and click the
        banner at the top; it installs the update itself. Your messages, notes, and pins stay put.
      </p>
      {/* No download button here on purpose. Offering one to someone who
          already has the app is how you end up with a second copy in
          Downloads and a first-launch flow they did not need. */}
      <a
        href={DOWNLOAD_URL}
        download
        className="mt-2.5 inline-block text-[12px] text-[#6e6e73] underline underline-offset-2 hover:text-[#111] dark:text-[#a1a1a6] dark:hover:text-[#f5f5f7]"
      >
        Or download it again
      </a>
    </div>
  );
}

export function LandingPage() {
  const [showSetup, setShowSetup] = useState(false);
  const running = useLocalApp();

  return (
    <div className="min-h-dvh overflow-y-auto bg-[#f2f5f9] font-[InterDisplay,Inter,system-ui,sans-serif] text-[#111] dark:bg-[#0b0d10] dark:text-[#f5f5f7]">
      {/* Inter Display for the Cooldock-style display type; hoisted by React. */}
      <link rel="stylesheet" href="https://rsms.me/inter/inter.css" precedence="default" />
      <style
        // Hero entrance: Cooldock's appear effect is a bounce-free 1s spring
        // from y:-53 — this easing curve is the CSS approximation of it.
        dangerouslySetInnerHTML={{
          __html: `
            @keyframes ld-drop { from { opacity: 0; transform: translateY(-28px); } to { opacity: 1; transform: none; } }
            .ld-appear { animation: ld-drop 1s cubic-bezier(0.16, 1, 0.3, 1) both; }
            @media (prefers-reduced-motion: reduce) { .ld-appear { animation: none; } }
          `,
        }}
      />

      {/* Floating frosted pill nav */}
      <header className="fixed inset-x-4 top-4 z-50 mx-auto flex h-14 max-w-4xl items-center justify-between rounded-full border border-[#0a84ff]/10 bg-white/80 px-3 shadow-[0_8px_30px_rgba(10,60,120,0.08)] backdrop-blur-[10px] dark:border-white/10 dark:bg-[#15171a]/80">
        <span className="flex items-center gap-2.5 pl-1.5">
          <img src="/icon-192.png" alt="" className="size-8 rounded-[9px] shadow-sm" />
          <span className="text-[16px] font-semibold tracking-tight">Sidenote</span>
        </span>
        <nav className="hidden items-center gap-6 text-[14px] font-medium text-[#555] sm:flex dark:text-[#a1a1a6]">
          <a href="/demo" className="transition-colors hover:text-[#111] dark:hover:text-white">
            Live demo
          </a>
          <a href="#features" className="transition-colors hover:text-[#111] dark:hover:text-white">
            Features
          </a>
          <a href="#changelog" className="transition-colors hover:text-[#111] dark:hover:text-white">
            Updates
          </a>
        </nav>
        <a
          href={DOWNLOAD_URL}
          download
          onClick={() => setShowSetup(true)}
          className="flex h-9 items-center gap-1.5 rounded-full bg-[#0a84ff] px-4 text-[13px] font-medium text-white transition-[transform,background-color] hover:scale-[1.03] hover:bg-[#0974df]"
        >
          <Download className="size-3.5" />
          Download
        </a>
      </header>

      <main className="mx-auto max-w-5xl px-6 pt-36 text-center md:pt-44">
        {/* Eyebrow */}
        <p
          className="ld-appear flex items-center justify-center gap-2 text-[15px] font-medium tracking-tight"
          style={{ animationDelay: "0.05s" }}
        >
          <img src="/icon-192.png" alt="" className="size-5 rounded-[6px]" />
          Your iMessage companion
        </p>

        <h1
          className="ld-appear mx-auto mt-5 max-w-4xl text-[52px] leading-[0.98] font-bold tracking-[-0.04em] md:text-[92px]"
          style={{ animationDelay: "0.15s" }}
        >
          Every text. Remembered.
        </h1>
        <p
          className="ld-appear mx-auto mt-7 max-w-[52ch] text-[17px] leading-relaxed text-[#6b6b6b] md:text-[20px] dark:text-[#a1a1a6]"
          style={{ animationDelay: "0.3s" }}
        >
          Search your entire iMessage history, pin the moments that matter, and right-click any
          message to ask what it means.
        </p>

        <div
          className="ld-appear mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          style={{ animationDelay: "0.45s" }}
        >
          <a
            href={DOWNLOAD_URL}
            download
            onClick={() => setShowSetup(true)}
            className="flex h-11 items-center gap-2 rounded-full bg-[#0a84ff] px-6 text-[14px] font-medium text-white shadow-[0_8px_24px_rgba(10,132,255,0.35)] transition-[transform,background-color] hover:scale-[1.03] hover:bg-[#0974df]"
          >
            <Download className="size-4" />
            Download for macOS
          </a>
          <a
            href="/demo"
            className="flex h-11 items-center rounded-full px-5 text-[14px] font-medium text-[#0a84ff] transition-colors hover:bg-[#0a84ff]/5 dark:hover:bg-[#0a84ff]/15"
          >
            Browse the demo →
          </a>
        </div>

        {/* Cooldock-style small caption row */}
        <p
          className="ld-appear mt-7 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 text-[12.5px] text-[#8a8a8a] dark:text-[#7c7c80]"
          style={{ animationDelay: "0.6s" }}
        >
          <span>Free download</span>
          <span>Apple silicon</span>
          <span>Auto updates</span>
          <span className="flex items-center gap-1.5">
            <Lock className="size-3" />
            Your archive stays on your Mac — AI only sees the message you ask about
          </span>
        </p>

        <AlreadyInstalled running={running} />

        {showSetup && (
          <div className="mx-auto mt-10 max-w-2xl rounded-[28px] bg-white p-7 text-left shadow-[0_20px_60px_rgba(0,0,0,0.08)] md:p-9 dark:bg-[#161616]">
            <p className="text-[20px] font-bold tracking-tight md:text-[22px]">
              Opening it for the first time
            </p>
            <p className="mt-1 text-[13.5px] text-[#6e6e73] dark:text-[#a1a1a6]">
              Requires a Mac with Apple silicon — any Mac from 2021 on.
            </p>
            <ol className="mt-5 space-y-3">
              {[
                <>Open the download and drag <span className="font-medium text-[#111] dark:text-[#f5f5f7]">Sidenote</span> onto the Applications folder beside it.</>,
                <>Open Sidenote from Applications. After this, it updates itself.</>,
                <>Give it permission to read Messages. macOS asks you to flip one switch; Sidenote shows you exactly which, and takes it from there.</>,
              ].map((step, i) => (
                <li
                  key={i}
                  className="flex gap-3 text-[14px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]"
                >
                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#0a84ff]/10 text-[12px] font-bold text-[#0a84ff]">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-5 border-t border-black/[0.06] pt-5 text-[13.5px] leading-relaxed text-[#6e6e73] dark:border-white/10 dark:text-[#a1a1a6]">
              Then it syncs, and everything works — search, notes, and AI included. Your messages
              are indexed on your Mac; asking about one sends just that message and the few around
              it, and only when you ask.
            </p>
          </div>
        )}

        {/* Hero screenshot as a rounded slab */}
        <div className="ld-appear mt-16 md:mt-24" style={{ animationDelay: "0.75s" }}>
          <img
            src="/screenshot.png"
            alt="Sidenote showing a conversation"
            className="w-full rounded-[24px] shadow-[0_30px_80px_rgba(10,60,120,0.18)] md:rounded-[32px]"
          />
        </div>

        {/* Feature pill cloud */}
        <Reveal className="mt-20 md:mt-28">
          <h2 className="mx-auto max-w-3xl text-[36px] leading-[1.02] font-bold tracking-[-0.03em] md:text-[56px]">
            Everything you texted, one click away
          </h2>
          <p className="mx-auto mt-5 max-w-[54ch] text-[16px] leading-relaxed text-[#6b6b6b] md:text-[18px] dark:text-[#a1a1a6]">
            Search, pins, notes, AI explanations, reply drafts, and clean exports — all working
            from the archive already sitting on your Mac.
          </p>
          <div className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-2.5">
            {FEATURE_PILLS.map((pill) => (
              <span
                key={pill}
                className="rounded-full bg-white px-4 py-2 text-[13px] font-medium text-[#333] shadow-[0_1px_3px_rgba(10,60,120,0.08)] dark:bg-[#1c1e22] dark:text-[#d5d5d7]"
              >
                {pill}
              </span>
            ))}
          </div>
        </Reveal>

        {/* Feature cards */}
        <div id="features" className="mt-16 grid gap-5 pb-16 text-left md:mt-20 md:grid-cols-2">
          {[
            {
              img: "/shot-explain.png",
              title: "Ask what a message means",
              sub: "Right-click any text and Sidenote decodes it — slang, references, tone, in-jokes — using the conversation around it. The answer opens on the message, with a box for follow-ups.",
            },
            {
              img: "/shot-explain-menu.png",
              title: "Look it up, or draft the reply",
              sub: "“Look this up” identifies a name, band, place, or event, searching the web and your own history. “Help me reply” drafts a response that sounds like you.",
            },
            {
              img: "/shot-search.png",
              title: "Search everything",
              sub: "Instant full-text search across every conversation you've ever had. Click a result to jump to that exact moment.",
            },
            {
              img: "/shot-remember.png",
              title: "Remember any message",
              sub: "Right-click a message and hit “Remember this.” No retyping, no screenshots.",
            },
            {
              img: "/shot-notes.png",
              title: "Notes on every person",
              sub: "Saved messages and your own notes live side by side — a private memory for each relationship.",
            },
            {
              img: "/shot-export.png",
              title: "Export any conversation",
              sub: "Copy a clean transcript of any time range, ready to paste into ChatGPT or Claude.",
            },
          ].map((f) => (
            <Reveal key={f.title}>
              <figure className="h-full rounded-[28px] bg-white p-6 shadow-[0_2px_12px_rgba(10,60,120,0.04)] md:p-7 dark:bg-[#15171a]">
                <figcaption className="mb-5">
                  <p className="text-[21px] font-bold tracking-[-0.02em]">{f.title}</p>
                  <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]">
                    {f.sub}
                  </p>
                </figcaption>
                <img
                  src={f.img}
                  alt={f.title}
                  className="aspect-[8/5] w-full rounded-[18px] object-cover shadow-[0_12px_35px_rgba(0,0,0,0.12)]"
                />
              </figure>
            </Reveal>
          ))}
        </div>

        {/* What's new */}
        <Reveal className="mx-auto mb-20 max-w-2xl">
          <div id="changelog" className="rounded-[28px] bg-white p-8 shadow-[0_2px_12px_rgba(10,60,120,0.04)] md:p-10 dark:bg-[#15171a]">
            <p className="text-[12px] font-semibold tracking-[0.12em] text-[#0a84ff] uppercase">
              What&apos;s new
            </p>
            <h2 className="mt-2 text-[30px] leading-[1.05] font-bold tracking-[-0.03em] md:text-[38px]">
              Sidenote keeps getting better
            </h2>
            <div className="mt-9 space-y-9 text-left">
              {CHANGELOG.map((entry) => (
                <div key={entry.title} className="flex flex-col gap-1.5 sm:flex-row sm:gap-6">
                  <span className="w-24 shrink-0 pt-0.5 text-[12.5px] text-[#8a8a8a] sm:text-right dark:text-[#7c7c80]">
                    {entry.date}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold tracking-tight">{entry.title}</p>
                    <ul className="mt-1.5 space-y-1">
                      {entry.points.map((point) => (
                        <li
                          key={point}
                          className="flex gap-2 text-[13.5px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]"
                        >
                          <span className="mt-[7px] size-1 shrink-0 rounded-full bg-[#0a84ff]" />
                          {point}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-10 text-center text-[13px] text-[#8a8a8a] dark:text-[#7c7c80]">
              Already installed? Sidenote offers new versions right in the app — one click, no
              Terminal.
            </p>
          </div>
        </Reveal>
      </main>

      <footer className="pb-10 text-center text-[12px] text-[#8a8a8a] dark:text-[#7c7c80]">
        Made for macOS · Your messages are indexed and searched on your Mac · Anonymous usage
        stats, never message content
      </footer>
    </div>
  );
}
