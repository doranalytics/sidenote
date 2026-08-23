"use client";

import { ShoppingBag } from "lucide-react";
import { SignInForm, sendCodeLocal, verifyCodeLocal } from "@/components/sign-in-local";
import { PRICE_USD } from "@/lib/pricing";

// The license wall. The DMG is just a file once it's downloaded — what makes
// a copy *yours* is signing in with the email you bought it with. One time:
// the token lands in the vault, survives updates and re-syncs, and the app
// never asks again (and works offline from then on). A forwarded copy hits
// this screen and needs the buyer's inbox to get past it, which is the whole
// point. AI stays a separate, optional subscription on top.
export function ActivationScreen({ onActivated }: { onActivated: () => void }) {
  return (
    <div className="flex h-dvh items-center justify-center bg-[#f2f5f9] p-6 dark:bg-[#0b0d10]">
      <div className="w-full max-w-md rounded-[28px] bg-white p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.08)] md:p-10 dark:bg-[#161616]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon-192.png" alt="" className="mx-auto size-14 rounded-[14px] shadow-sm" />
        <h1 className="mt-5 text-[24px] font-bold tracking-tight">Unlock Sidenote</h1>
        <p className="mx-auto mt-2 max-w-[36ch] text-[13.5px] leading-relaxed text-muted-foreground">
          Sign in with the email you bought Sidenote with. We&apos;ll send a 6-digit code — no
          password. One time, then this Mac stays unlocked.
        </p>
        <SignInForm
          className="mx-auto mt-6"
          sendCode={sendCodeLocal}
          verifyCode={verifyCodeLocal}
          onSignedIn={onActivated}
          buyHref="https://sidenote.lol/#pricing"
        />
        <p className="mt-6 border-t border-black/[0.06] pt-5 text-[12.5px] leading-relaxed text-muted-foreground dark:border-white/10">
          Don&apos;t have Sidenote yet?{" "}
          <a
            href="https://sidenote.lol/#pricing"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-medium text-[#0a84ff] underline-offset-2 hover:underline"
          >
            <ShoppingBag className="size-3" />
            Get it — ${PRICE_USD}, once
          </a>
        </p>
      </div>
    </div>
  );
}
