"use client";

import { useState } from "react";
import Link from "next/link";
import { Download } from "lucide-react";
import { SiteShell } from "@/components/site-shell";
import { FirstOpenSteps } from "@/components/first-open-steps";
import { SignInForm, type SignInResult } from "@/components/sign-in-form";
import { PRICE_USD } from "@/lib/pricing";

// "I bought it, give it to me again." Sign in with the purchase email and the
// DMG is one click away. The same sign-in the app uses, against the same two
// endpoints — the app just keeps the token instead of the download link.
async function post(path: string, body: unknown) {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: (data.error as string) ?? "Something went wrong.", code: data.code as string | undefined };
    }
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Couldn't reach Sidenote. Check your connection." };
  }
}

export function DownloadAgain() {
  const [grant, setGrant] = useState<{ email: string; download: string } | null>(null);
  // Lazy initializer: read once, client-side only (SSR sees false, and the
  // copy difference is too small to matter for a flash).
  const [expired] = useState(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("expired") === "1"
  );

  return (
    <SiteShell>
      {grant ? (
        <>
          <h1 className="mx-auto max-w-3xl text-[44px] leading-[1] font-bold tracking-[-0.04em] md:text-[64px]">
            Here you go.
          </h1>
          <p className="mx-auto mt-5 max-w-[46ch] text-[16px] leading-relaxed text-[#6b6b6b] md:text-[18px] dark:text-[#a1a1a6]">
            Signed in as <span className="font-medium text-[#111] dark:text-[#f5f5f7]">{grant.email}</span>.
            Same email turns AI on inside the app.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <a
              href={`/api/download?t=${encodeURIComponent(grant.download)}`}
              className="flex h-12 items-center gap-2 rounded-full bg-[#0a84ff] px-7 text-[15px] font-medium text-white shadow-[0_8px_24px_rgba(10,132,255,0.35)] transition-[transform,background-color] hover:scale-[1.03] hover:bg-[#0974df]"
            >
              <Download className="size-4" />
              Download Sidenote for macOS
            </a>
          </div>
          <div className="mt-12">
            <FirstOpenSteps />
          </div>
        </>
      ) : (
        <>
          <h1 className="mx-auto max-w-3xl text-[40px] leading-[1.02] font-bold tracking-[-0.04em] md:text-[56px]">
            Download it again
          </h1>
          <p className="mx-auto mt-5 max-w-[44ch] text-[16px] leading-relaxed text-[#6b6b6b] md:text-[18px] dark:text-[#a1a1a6]">
            {expired
              ? "That download link had expired — sign in for a fresh one."
              : "Sign in with the email you bought Sidenote with. We'll email a 6-digit code; no password."}
          </p>
          <div className="mx-auto mt-8 max-w-md rounded-[28px] bg-white p-7 shadow-[0_2px_12px_rgba(10,60,120,0.04)] dark:bg-[#15171a]">
            <SignInForm
              sendCode={(email) => post("/api/auth/send-code", { email })}
              verifyCode={(email, code) => post("/api/auth/verify-code", { email, code, web: true })}
              onSignedIn={(data: SignInResult, email) =>
                setGrant({ email, download: String(data.download ?? "") })
              }
              buyHref="/#buy"
            />
          </div>
          <p className="mt-6 text-[13px] text-[#8a8a8a] dark:text-[#7c7c80]">
            Haven&apos;t bought it yet?{" "}
            <Link href="/#pricing" className="font-medium text-[#0a84ff] underline-offset-2 hover:underline">
              Get Sidenote — ${PRICE_USD}
            </Link>
          </p>
        </>
      )}
    </SiteShell>
  );
}
