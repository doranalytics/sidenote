/* eslint-disable @next/next/no-img-element */
import Link from "next/link";

// The chrome shared by the small pages off the landing page (/thanks,
// /download): same background, type, and pill nav, so they read as the same
// site rather than a different app.
export function SiteShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh overflow-y-auto bg-[#f2f5f9] font-[InterDisplay,Inter,system-ui,sans-serif] text-[#111] dark:bg-[#0b0d10] dark:text-[#f5f5f7]">
      <link rel="stylesheet" href="https://rsms.me/inter/inter.css" precedence="default" />
      <header className="fixed inset-x-4 top-4 z-50 mx-auto flex h-14 max-w-4xl items-center justify-between rounded-full border border-[#0a84ff]/10 bg-white/80 px-3 shadow-[0_8px_30px_rgba(10,60,120,0.08)] backdrop-blur-[10px] dark:border-white/10 dark:bg-[#15171a]/80">
        <Link href="/" className="flex items-center gap-2.5 pl-1.5">
          <img src="/icon-192.png" alt="" className="size-8 rounded-[9px] shadow-sm" />
          <span className="text-[16px] font-semibold tracking-tight">Sidenote</span>
        </Link>
        <nav className="flex items-center gap-6 pr-2 text-[14px] font-medium text-[#555] dark:text-[#a1a1a6]">
          <Link href="/#features" className="transition-colors hover:text-[#111] dark:hover:text-white">
            Features
          </Link>
          <a href="/demo" className="transition-colors hover:text-[#111] dark:hover:text-white">
            Live demo
          </a>
        </nav>
      </header>
      <main className="mx-auto max-w-2xl px-6 pt-36 pb-24 text-center md:pt-44">{children}</main>
      <footer className="pb-10 text-center text-[12px] text-[#8a8a8a] dark:text-[#7c7c80]">
        Made for macOS · Your messages are indexed and searched on your Mac
      </footer>
    </div>
  );
}
