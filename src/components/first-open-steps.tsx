import { AI_MONTHLY_USD } from "@/lib/pricing";

// The three things to do with a fresh download. Shown on /thanks right after
// buying and on /download after signing in — the two places a DMG is handed
// out, and the two moments someone is about to open it for the first time.
export function FirstOpenSteps() {
  return (
    <div className="rounded-[28px] bg-white p-7 text-left shadow-[0_20px_60px_rgba(0,0,0,0.08)] md:p-9 dark:bg-[#161616]">
      <p className="text-[20px] font-bold tracking-tight md:text-[22px]">Opening it for the first time</p>
      <p className="mt-1 text-[13.5px] text-[#6e6e73] dark:text-[#a1a1a6]">
        Requires a Mac with Apple silicon — any Mac from 2021 on.
      </p>
      <ol className="mt-5 space-y-3">
        {[
          <>
            Open the download and drag{" "}
            <span className="font-medium text-[#111] dark:text-[#f5f5f7]">Sidenote</span> onto the
            Applications folder beside it.
          </>,
          <>Open Sidenote from Applications. After this, it updates itself.</>,
          <>
            Unlock it: sign in with the email you bought with. A 6-digit code arrives by email —
            no password. One time; the app stays unlocked after that.
          </>,
          <>
            Give it permission to read Messages. macOS asks you to flip one switch; Sidenote shows
            you exactly which, and takes it from there.
          </>,
          <>
            Want AI? Turn it on in <span className="font-medium text-[#111] dark:text-[#f5f5f7]">Settings → AI</span> —
            ${AI_MONTHLY_USD}/month, cancel any time. Everything else works without it.
          </>,
        ].map((step, i) => (
          <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]">
            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#0a84ff]/10 text-[12px] font-bold text-[#0a84ff]">
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 border-t border-black/[0.06] pt-5 text-[13.5px] leading-relaxed text-[#6e6e73] dark:border-white/10 dark:text-[#a1a1a6]">
        Then it syncs, and everything works — search, notes, pins, export. With AI on, asking about
        a message sends just that message and the few around it, and only when you ask. Your
        archive stays on your Mac.
      </p>
    </div>
  );
}
