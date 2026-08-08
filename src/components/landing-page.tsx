"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useState } from "react";
import { Download, Lock } from "lucide-react";
import { CHANGELOG } from "@/lib/changelog";
import { Button } from "@/components/ui/button";

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

// Sidenote is a Mac app, so this never offers to "open" anything in a browser
// tab — that just showed the local server's web UI and made the product feel
// like a website. If the app is running here, the only useful thing the site
// can tell you is whether there's a newer build to download.
function AlreadyInstalled({ running }: { running: boolean | null }) {
  const latest = CHANGELOG[0];
  if (!running) return null;

  return (
    <div className="mx-auto mt-8 max-w-md rounded-2xl border border-[#30d158]/30 bg-[#30d158]/[0.07] p-4 text-center">
      <p className="flex items-center justify-center gap-2 text-[13.5px] font-medium">
        <span className="relative flex size-2">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#30d158] opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-[#30d158]" />
        </span>
        Sidenote is installed on this Mac
      </p>
      <p className="mt-1.5 text-[13px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]">
        Latest version is{" "}
        <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">{latest.date}</span> —{" "}
        {latest.title.charAt(0).toLowerCase() + latest.title.slice(1)}. Sidenote updates itself —
        open it and click the banner. Your messages, notes, and pins stay put.
      </p>
      <Button
        asChild
        size="sm"
        className="mt-3 h-9 rounded-full bg-[#0a84ff] px-4 text-[13px] hover:bg-[#0974df]"
      >
        <a href={DOWNLOAD_URL} download>
          <Download className="mr-1.5 size-3.5" />
          Download the latest
        </a>
      </Button>
    </div>
  );
}

export function LandingPage() {
  const [showSetup, setShowSetup] = useState(false);
  const running = useLocalApp();

  return (
    <div className="min-h-dvh overflow-y-auto bg-[#fbfbfd] text-[#1d1d1f] dark:bg-black dark:text-[#f5f5f7]">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
        <span className="text-[17px] font-semibold tracking-tight">Sidenote</span>
        <div className="flex items-center gap-5">
          <a href="/demo" className="text-[13px] font-medium text-[#0a84ff] hover:underline">
            Live demo
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 pt-10 text-center md:pt-20">
        <img
          src="/icon-192.png"
          alt=""
          className="mx-auto size-16 rounded-[22.5%] shadow-lg md:size-20"
        />
        <h1 className="mt-8 text-[44px] leading-[1.05] font-semibold tracking-tight md:text-[64px]">
          Every text.
          <br />
          Remembered.
        </h1>
        <p className="mx-auto mt-5 max-w-[34ch] text-[17px] leading-relaxed text-[#6e6e73] md:text-[19px] dark:text-[#a1a1a6]">
          Search your entire iMessage history, pin the moments that matter, and right-click any
          message to ask what it means.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button
            asChild
            className="h-12 rounded-full bg-[#0a84ff] px-7 text-[15px] font-medium hover:bg-[#0974df]"
          >
            <a href={DOWNLOAD_URL} download onClick={() => setShowSetup(true)}>
              <Download className="mr-1.5 size-4" />
              Download Sidenote for Mac
            </a>
          </Button>
          <Button
            asChild
            variant="ghost"
            className="h-12 rounded-full px-6 text-[15px] font-medium text-[#0a84ff] hover:bg-[#0a84ff]/5"
          >
            <a href="/demo">Browse the demo →</a>
          </Button>
        </div>

        <p className="mt-6 flex items-center justify-center gap-1.5 text-[13px] text-[#6e6e73] dark:text-[#a1a1a6]">
          <Lock className="size-3.5" />
          Your archive stays on your Mac. AI only sees the message you ask about.
        </p>

        <AlreadyInstalled running={running} />

        {showSetup && (
          <div className="mx-auto mt-10 max-w-2xl rounded-3xl border border-black/[0.08] bg-white p-7 text-left shadow-lg md:p-9 dark:border-white/10 dark:bg-[#141416]">
            <p className="text-[19px] font-semibold tracking-tight md:text-[21px]">
              Opening it for the first time
            </p>
            <p className="mt-1 text-[13.5px] text-[#6e6e73] dark:text-[#a1a1a6]">
              Requires a Mac with Apple silicon — any Mac from 2021 on.
            </p>
            <ol className="mt-5 space-y-3">
              {[
                <>Open the download and drag <span className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7]">Sidenote</span> onto the Applications folder beside it.</>,
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
            <p className="mt-5 border-t border-black/[0.06] pt-5 text-[13.5px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]">
              Then it syncs, and everything works — search, notes, and AI included. Your messages
              are indexed on your Mac; asking about one sends just that message and the few around
              it, and only when you ask.
            </p>
          </div>
        )}

        <div className="mt-14 md:mt-20">
          <img
            src="/screenshot.png"
            alt="Sidenote showing a conversation"
            className="w-full rounded-xl border border-black/[0.08] shadow-2xl md:rounded-2xl dark:border-white/10"
          />
        </div>

        <div className="mt-16 grid gap-x-8 gap-y-12 pb-16 text-left md:mt-24 md:grid-cols-2">
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
            <figure key={f.title}>
              <figcaption className="mb-3">
                <p className="text-[19px] font-semibold tracking-tight">{f.title}</p>
                <p className="mt-1 text-[13.5px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]">
                  {f.sub}
                </p>
              </figcaption>
              <img
                src={f.img}
                alt={f.title}
                className="aspect-[8/5] w-full rounded-xl border border-black/[0.08] object-cover shadow-xl dark:border-white/10"
              />
            </figure>
          ))}
        </div>

        {/* What's new */}
        <div className="mx-auto mb-20 max-w-2xl border-t border-black/[0.06] pt-14 dark:border-white/10">
          <p className="text-[13px] font-semibold tracking-wide text-[#0a84ff] uppercase">
            What&apos;s new
          </p>
          <h2 className="mt-2 text-[28px] leading-tight font-semibold tracking-tight md:text-[34px]">
            Sidenote keeps getting better
          </h2>
          <div className="mt-9 space-y-9 text-left">
            {CHANGELOG.map((entry) => (
              <div key={entry.title} className="flex flex-col gap-1.5 sm:flex-row sm:gap-6">
                <span className="w-24 shrink-0 pt-0.5 text-[12.5px] text-[#6e6e73] sm:text-right dark:text-[#a1a1a6]">
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
          <p className="mt-10 text-center text-[13px] text-[#6e6e73] dark:text-[#a1a1a6]">
            Already installed? Sidenote offers new versions right in the app — one click, no
            Terminal.
          </p>
        </div>
      </main>

      <footer className="pb-10 text-center text-[12px] text-[#6e6e73] dark:text-[#a1a1a6]">
        Made for macOS · Your messages are indexed and searched on your Mac · Anonymous usage
        stats, never message content
      </footer>
    </div>
  );
}
