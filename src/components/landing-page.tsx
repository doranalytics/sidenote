"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { Check, Lock, ShoppingBag } from "lucide-react";
import { CHANGELOG } from "@/lib/changelog";
import { AI_MONTHLY_USD, PRICE_USD } from "@/lib/pricing";

// Buying starts here: a plain link into Stripe Checkout, and Stripe sends you
// back to /thanks with the download. Someone who already paid downloads again
// from /download by signing in with the purchase email. The binary itself is
// in a private store — never in this deployment, never on a public URL.
const BUY_URL = "/api/checkout";
const AGAIN_URL = "/download";
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
  "Ask about any thread",
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
      {/* No buy button here on purpose. Offering one to someone who already
          has the app is how you end up with a second purchase. */}
      <a
        href={AGAIN_URL}
        className="mt-2.5 inline-block text-[12px] text-[#6e6e73] underline underline-offset-2 hover:text-[#111] dark:text-[#a1a1a6] dark:hover:text-[#f5f5f7]"
      >
        Or download it again
      </a>
    </div>
  );
}

export function LandingPage() {
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
          <a href="#pricing" className="transition-colors hover:text-[#111] dark:hover:text-white">
            Pricing
          </a>
          <a href="#changelog" className="transition-colors hover:text-[#111] dark:hover:text-white">
            Updates
          </a>
        </nav>
        <a
          href={BUY_URL}
          className="flex h-9 items-center gap-1.5 rounded-full bg-[#0a84ff] px-4 text-[13px] font-medium text-white transition-[transform,background-color] hover:scale-[1.03] hover:bg-[#0974df]"
        >
          <ShoppingBag className="size-3.5" />
          Buy · ${PRICE_USD}
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
            id="buy"
            href={BUY_URL}
            className="flex h-11 items-center gap-2 rounded-full bg-[#0a84ff] px-6 text-[14px] font-medium text-white shadow-[0_8px_24px_rgba(10,132,255,0.35)] transition-[transform,background-color] hover:scale-[1.03] hover:bg-[#0974df]"
          >
            <ShoppingBag className="size-4" />
            Get Sidenote for macOS — ${PRICE_USD} once
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
          <span>${PRICE_USD} once — yours for good</span>
          <span>AI optional, ${AI_MONTHLY_USD}/month</span>
          <span>Apple silicon</span>
          <span>Auto updates</span>
          <span className="flex items-center gap-1.5">
            <Lock className="size-3" />
            Your archive stays on your Mac — AI only sees the message you ask about
          </span>
        </p>

        <AlreadyInstalled running={running} />

        <p
          className="ld-appear mt-3 text-[12.5px] text-[#8a8a8a] dark:text-[#7c7c80]"
          style={{ animationDelay: "0.6s" }}
        >
          Already bought it?{" "}
          <a href={AGAIN_URL} className="underline underline-offset-2 hover:text-[#111] dark:hover:text-[#f5f5f7]">
            Download it again
          </a>
        </p>

        {/* Hero: the Ask AI panel composited over the real app screenshot,
            mirroring how the panel actually opens in-app (right side, dimmed
            thread behind). The panel is an HTML mock fed by the demo data.
            The words come first: a screenshot with a chat in it doesn't
            explain itself. */}
        <div className="ld-appear mx-auto mt-20 max-w-2xl md:mt-28" style={{ animationDelay: "0.7s" }}>
          <p className="text-[12px] font-semibold tracking-[0.12em] text-[#0a84ff] uppercase">
            What you&apos;re looking at
          </p>
          <h2 className="mt-2 text-[30px] leading-[1.05] font-bold tracking-[-0.03em] md:text-[40px]">
            Your texts on the left. Ask AI about them on the right.
          </h2>
          <p className="mx-auto mt-4 max-w-[58ch] text-[15.5px] leading-relaxed text-[#6b6b6b] md:text-[17px] dark:text-[#a1a1a6]">
            This is Sidenote with a conversation open and the{" "}
            <span className="font-medium text-[#111] dark:text-[#f5f5f7]">Ask AI</span> panel
            pulled out beside it. Type a question — &ldquo;why do we call that dog
            Baguette?&rdquo; — and it searches the whole history of that thread, years back, and
            answers from the actual messages, citing the day. Search, pins, notes, and export are
            yours for ${PRICE_USD}; AI is an optional ${AI_MONTHLY_USD}/month on top.
          </p>
        </div>
        <figure className="ld-appear mt-8 md:mt-10" style={{ animationDelay: "0.8s" }}>
          {/* On phones the inset panel would be unreadably small — so the
              screenshot dims and the SAME panel overlaps it as a card,
              because the AI chat IS the hero. sm+ keeps the in-app inset. */}
          <div className="relative">
            <div className="relative overflow-hidden rounded-[24px] shadow-[0_30px_80px_rgba(10,60,120,0.18)] md:rounded-[32px]">
              <img
                src="/screenshot.png"
                alt="A Sidenote conversation with the Ask AI panel open"
                className="w-full"
              />
              <div className="absolute inset-0 bg-[#1d2530]/25 backdrop-blur-[3px]" />
            </div>
            <div className="relative mx-3 -mt-16 flex flex-col rounded-2xl bg-white text-left shadow-2xl sm:absolute sm:top-[4%] sm:right-[2.5%] sm:bottom-[4%] sm:mx-0 sm:mt-0 sm:w-[38%] dark:bg-[#15171a]">
              <div className="flex items-center justify-between px-5 pt-4">
                <p className="text-[15px] font-semibold">Maya Chen</p>
                <span className="text-[15px] text-[#9a9aa0]">✕</span>
              </div>
              <div className="mx-5 mt-3 grid grid-cols-2 rounded-full bg-[#f2f5f9] p-1 text-center text-[12.5px] font-medium dark:bg-[#0b0d10]">
                <span className="rounded-full py-1.5 text-[#6e6e73] dark:text-[#a1a1a6]">Notes</span>
                <span className="rounded-full bg-white py-1.5 shadow-sm dark:bg-[#1c1e22]">
                  Ask AI
                </span>
              </div>
              <div className="flex-1 space-y-2.5 overflow-hidden px-5 pt-4 text-[12.5px] leading-snug">
                <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[#0a84ff] px-3 py-1.5 text-white">
                  wait, why do we keep calling that dog Baguette?
                </p>
                <p className="w-fit max-w-[92%] rounded-2xl rounded-bl-md bg-[#f2f5f9] px-3 py-1.5 text-[#333] dark:bg-[#0b0d10] dark:text-[#d5d5d7]">
                  On Aug 11 you found the &ldquo;bread dog&rdquo; on the East Rock dogs Instagram
                  and told Maya &ldquo;his name is Baguette. I am not making this up.&rdquo; She
                  declared it the best day of her life — it&apos;s been a running joke since.
                </p>
              </div>
              <p className="mx-5 mt-3 mb-4 flex items-center justify-between rounded-full bg-[#f2f5f9] px-4 py-2 text-[12px] text-[#9a9aa0] dark:bg-[#0b0d10]">
                Ask about Maya Chen…
                <span className="font-medium text-[#0a84ff]">↑</span>
              </p>
            </div>
          </div>
        </figure>

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

        {/* Featured: ask AI about a whole thread. The chat is an HTML mock (the
            Cooldock trick — their widget renders are DOM, not screenshots),
            using the demo thread's own sample data so it reads as real. */}
        <Reveal className="mt-16 md:mt-20">
          <div className="rounded-[28px] bg-white p-6 text-left shadow-[0_2px_12px_rgba(10,60,120,0.04)] md:p-10 dark:bg-[#15171a]">
            <div className="grid items-center gap-8 md:grid-cols-2">
              <div>
                <p className="text-[12px] font-semibold tracking-[0.12em] text-[#0a84ff] uppercase">
                  New — AI that knows your history
                </p>
                <h3 className="mt-2 text-[28px] leading-[1.05] font-bold tracking-[-0.03em] md:text-[36px]">
                  Ask about any conversation
                </h3>
                <p className="mt-3 text-[14.5px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]">
                  Open the Ask AI panel on a thread and ask anything — about last week or ten years
                  ago. Sidenote searches the whole history and answers from the actual messages.
                  And right-clicking any single message explains it, looks it up, or drafts your
                  reply.
                </p>
              </div>
              <div className="rounded-[20px] bg-[#f2f5f9] p-4 dark:bg-[#0b0d10]">
                <p className="border-b border-black/[0.05] pb-2.5 text-[12.5px] font-semibold dark:border-white/10">
                  Ask about Maya Chen
                </p>
                <div className="mt-3 space-y-2.5 text-[13px] leading-snug">
                  <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-[#0a84ff] px-3.5 py-2 text-white">
                    when did Maya ship her pattern?
                  </p>
                  <p className="w-fit max-w-[90%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-[#333] shadow-sm dark:bg-[#1c1e22] dark:text-[#d5d5d7]">
                    Sun, Aug 2 — &ldquo;WE SHIPPED IT.&rdquo; The indigo wave pattern made the
                    cover of the lookbook, and you two celebrated that Saturday over coffee.
                  </p>
                </div>
                <p className="mt-3 flex items-center justify-between rounded-full bg-white px-4 py-2.5 text-[12.5px] text-[#9a9aa0] shadow-sm dark:bg-[#1c1e22]">
                  Ask about Maya Chen…
                  <span className="font-medium text-[#0a84ff]">↑</span>
                </p>
              </div>
            </div>
          </div>
        </Reveal>

        {/* Feature cards */}
        <div id="features" className="mt-5 scroll-mt-28 grid gap-5 pb-16 text-left md:grid-cols-2">
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

        {/* Pricing: two numbers. The app is bought once; AI is a monthly
            you can turn on and off from inside the app. */}
        <Reveal className="mx-auto mb-16 max-w-3xl">
          <div id="pricing" className="scroll-mt-28 rounded-[28px] bg-white p-8 shadow-[0_2px_12px_rgba(10,60,120,0.04)] md:p-10 dark:bg-[#15171a]">
            <p className="text-[12px] font-semibold tracking-[0.12em] text-[#0a84ff] uppercase">
              Pricing
            </p>
            <h2 className="mt-2 text-[30px] leading-[1.05] font-bold tracking-[-0.03em] md:text-[38px]">
              Buy it once. Yours for life.
            </h2>
            <p className="mx-auto mt-3 max-w-[48ch] text-[15px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]">
              One payment, no subscription for the app — every update included, forever. AI is the
              only monthly thing, and it&apos;s optional.
            </p>
            <div className="mt-8 grid gap-4 text-left md:grid-cols-2">
              <div className="rounded-[22px] border border-black/[0.06] p-6 dark:border-white/10">
                <p className="text-[13px] font-semibold tracking-tight text-[#6e6e73] dark:text-[#a1a1a6]">
                  Sidenote for Mac
                </p>
                <p className="mt-1 text-[40px] leading-none font-bold tracking-[-0.04em]">
                  ${PRICE_USD}
                  <span className="ml-1.5 text-[15px] font-medium tracking-normal text-[#8a8a8a]">one-time · lifetime</span>
                </p>
                <ul className="mt-5 space-y-2 text-[14px] text-[#333] dark:text-[#d5d5d7]">
                  {[
                    "Search every text you've ever sent",
                    "Pin the moments that matter",
                    "Notes on every person",
                    "Clean exports of any conversation",
                    "Every update, no upgrade fee",
                    "Everything stays on your Mac",
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Check className="mt-[3px] size-3.5 shrink-0 text-[#0a84ff]" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <a
                  href={BUY_URL}
                  className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#0a84ff] px-6 text-[14px] font-medium text-white shadow-[0_8px_24px_rgba(10,132,255,0.35)] transition-[transform,background-color] hover:scale-[1.02] hover:bg-[#0974df]"
                >
                  <ShoppingBag className="size-4" />
                  Get Sidenote — ${PRICE_USD}
                </a>
              </div>
              <div className="rounded-[22px] border border-[#0a84ff]/15 bg-[#0a84ff]/[0.04] p-6">
                <p className="text-[13px] font-semibold tracking-tight text-[#6e6e73] dark:text-[#a1a1a6]">
                  AI, optional
                </p>
                <p className="mt-1 text-[40px] leading-none font-bold tracking-[-0.04em]">
                  ${AI_MONTHLY_USD}
                  <span className="ml-1.5 text-[15px] font-medium tracking-normal text-[#8a8a8a]">/ month</span>
                </p>
                <ul className="mt-5 space-y-2 text-[14px] text-[#333] dark:text-[#d5d5d7]">
                  {[
                    "Explain any message — slang, tone, in-jokes",
                    "Ask about a whole conversation, years back",
                    "Look things up, with the web and your history",
                    "Reply drafts in your voice",
                    "Turn on or off inside the app, any time",
                    "Only the message you ask about is sent",
                  ].map((line) => (
                    <li key={line} className="flex items-start gap-2">
                      <Check className="mt-[3px] size-3.5 shrink-0 text-[#0a84ff]" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-6 flex h-11 items-center justify-center rounded-full border border-[#0a84ff]/20 px-6 text-[13.5px] font-medium text-[#0a84ff]">
                  Added from Settings → AI after you install
                </p>
              </div>
            </div>
            <p className="mt-5 text-[12.5px] text-[#8a8a8a] dark:text-[#7c7c80]">
              Secure checkout by Stripe · Mac with Apple silicon (2021 or later) · Cancel AI whenever
            </p>
          </div>
        </Reveal>

        {/* What's new */}
        <Reveal className="mx-auto mb-20 max-w-2xl">
          <div id="changelog" className="scroll-mt-28 rounded-[28px] bg-white p-8 shadow-[0_2px_12px_rgba(10,60,120,0.04)] md:p-10 dark:bg-[#15171a]">
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
        <span className="mx-2">·</span>
        <a href={AGAIN_URL} className="underline underline-offset-2 hover:text-[#111] dark:hover:text-[#f5f5f7]">
          Download again
        </a>
      </footer>
    </div>
  );
}
