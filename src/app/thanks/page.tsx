import type { Metadata } from "next";
import Link from "next/link";
import { Download, Sparkles } from "lucide-react";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { entitlementFor, recordAppPurchase, signDownload } from "@/lib/access";
import { AI_MONTHLY_USD } from "@/lib/pricing";
import { SiteShell } from "@/components/site-shell";
import { FirstOpenSteps } from "@/components/first-open-steps";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Thanks — Sidenote",
  robots: { index: false },
};

// Where Stripe sends you after paying — for the app or for AI — and where
// the customer portal and a canceled AI checkout return to.
//
// The session id in the URL is checked against Stripe directly, never trusted
// on its own. A paid app session records the purchase (idempotently; the
// webhook usually got there first) and mints a 24-hour download link, so
// reloading or bookmarking this page keeps working. A paid AI session just
// says so and sends you back to the app.
export default async function Thanks({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string; canceled?: string; portal?: string }>;
}) {
  const { session_id, canceled, portal } = await searchParams;

  if (canceled === "ai" || portal === "done") {
    return (
      <SiteShell>
        <h1 className="mx-auto max-w-3xl text-[40px] leading-[1.02] font-bold tracking-[-0.04em] md:text-[56px]">
          {portal === "done" ? "All set." : "No problem."}
        </h1>
        <p className="mx-auto mt-5 max-w-[46ch] text-[16px] leading-relaxed text-[#6b6b6b] md:text-[18px] dark:text-[#a1a1a6]">
          {portal === "done"
            ? "Any change you made is in effect. You can close this tab and go back to Sidenote."
            : `AI stays off for now. Turn it on any time from Settings → AI inside Sidenote — it's $${AI_MONTHLY_USD}/month, cancel whenever.`}
        </p>
      </SiteShell>
    );
  }

  let email: string | null = null;
  let token: string | null = null;
  let aiOn = false;
  let problem: string | null = null;

  if (!stripeConfigured()) {
    problem = "Purchases aren't set up yet.";
  } else if (!session_id || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(session_id)) {
    problem =
      "This page needs a checkout session. If you just paid, use the link in your receipt, or download again from sidenote.lol/download.";
  } else {
    try {
      const s = await stripe().checkout.sessions.retrieve(session_id);
      email = s.customer_details?.email?.toLowerCase() ?? s.customer_email?.toLowerCase() ?? null;
      if (s.payment_status !== "paid" || !email) {
        problem =
          s.status === "open"
            ? "This checkout hasn't finished. Go back and complete the payment, then you'll land here."
            : "This payment hasn't cleared yet. Once it does, you'll get a receipt by email and can download from sidenote.lol/download.";
      } else if (s.mode === "subscription") {
        aiOn = true;
      } else {
        await recordAppPurchase({
          email,
          sessionId: s.id,
          customerId: typeof s.customer === "string" ? s.customer : (s.customer?.id ?? null),
          paymentIntentId:
            typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null),
          amountCents: s.amount_total ?? 0,
          currency: s.currency ?? "usd",
          livemode: s.livemode,
        });
        token = signDownload(email, "thanks");
        try {
          aiOn = (await entitlementFor(email)).ai;
        } catch {
          // purely cosmetic — the offer below is harmless either way
        }
      }
    } catch {
      problem =
        "Couldn't look up that checkout. If you paid, your receipt is on its way — download from sidenote.lol/download with the same email.";
    }
  }

  if (aiOn && !token) {
    return (
      <SiteShell>
        <p className="flex items-center justify-center gap-2 text-[15px] font-medium tracking-tight">
          <span className="inline-flex size-5 items-center justify-center rounded-full bg-[#30d158] text-[11px] text-white">✓</span>
          Subscribed
        </p>
        <h1 className="mx-auto mt-4 max-w-3xl text-[44px] leading-[1] font-bold tracking-[-0.04em] md:text-[64px]">
          AI is on.
        </h1>
        <p className="mx-auto mt-5 max-w-[46ch] text-[16px] leading-relaxed text-[#6b6b6b] md:text-[18px] dark:text-[#a1a1a6]">
          Go back to Sidenote — it picks this up on its own within a moment (or click{" "}
          <span className="font-medium text-[#111] dark:text-[#f5f5f7]">Check again</span> in
          Settings → AI). It&apos;s on{" "}
          <span className="font-medium text-[#111] dark:text-[#f5f5f7]">{email}</span>; cancel any
          time from the same place.
        </p>
      </SiteShell>
    );
  }

  return (
    <SiteShell>
      {token ? (
        <>
          <p className="flex items-center justify-center gap-2 text-[15px] font-medium tracking-tight">
            <span className="inline-flex size-5 items-center justify-center rounded-full bg-[#30d158] text-[11px] text-white">✓</span>
            Paid
          </p>
          <h1 className="mx-auto mt-4 max-w-3xl text-[44px] leading-[1] font-bold tracking-[-0.04em] md:text-[64px]">
            You&apos;re in.
          </h1>
          <p className="mx-auto mt-5 max-w-[46ch] text-[16px] leading-relaxed text-[#6b6b6b] md:text-[18px] dark:text-[#a1a1a6]">
            Sidenote is yours for good — one payment, every future update included. It&apos;s
            registered under{" "}
            <span className="font-medium text-[#111] dark:text-[#f5f5f7]">{email}</span> — that&apos;s
            the email you&apos;ll sign in with inside the app, and where Stripe sends your receipts.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3">
            <a
              href={`/api/download?t=${encodeURIComponent(token)}`}
              className="flex h-12 items-center gap-2 rounded-full bg-[#0a84ff] px-7 text-[15px] font-medium text-white shadow-[0_8px_24px_rgba(10,132,255,0.35)] transition-[transform,background-color] hover:scale-[1.03] hover:bg-[#0974df]"
            >
              <Download className="size-4" />
              Download Sidenote for macOS
            </a>
            <p className="text-[12.5px] text-[#8a8a8a] dark:text-[#7c7c80]">
              Lost the file later?{" "}
              <a href="/download" className="underline underline-offset-2">
                sidenote.lol/download
              </a>{" "}
              — sign in with your email, any time.
            </p>
          </div>

          {!aiOn && (
            <div className="mx-auto mt-10 max-w-md rounded-[24px] border border-[#0a84ff]/15 bg-[#0a84ff]/[0.05] p-6 text-left">
              <p className="flex items-center gap-2 text-[15px] font-semibold">
                <Sparkles className="size-4 text-[#0a84ff]" />
                Want AI? ${AI_MONTHLY_USD}/month, optional.
              </p>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#6e6e73] dark:text-[#a1a1a6]">
                Explain any message, ask about a whole conversation, draft replies. Search, pins,
                notes, and export are yours regardless. Start it now or later from Settings → AI
                in the app; cancel whenever.
              </p>
              <a
                href={`/api/checkout?plan=ai&email=${encodeURIComponent(email ?? "")}`}
                className="mt-4 inline-flex h-10 items-center gap-2 rounded-full bg-[#0a84ff] px-5 text-[13.5px] font-medium text-white hover:bg-[#0974df]"
              >
                <Sparkles className="size-3.5" />
                Turn on AI — ${AI_MONTHLY_USD}/mo
              </a>
            </div>
          )}

          <div className="mt-12">
            <FirstOpenSteps />
          </div>
        </>
      ) : (
        <>
          <h1 className="mx-auto mt-4 max-w-3xl text-[36px] leading-[1.05] font-bold tracking-[-0.04em] md:text-[48px]">
            Almost there
          </h1>
          <p className="mx-auto mt-5 max-w-[48ch] text-[16px] leading-relaxed text-[#6b6b6b] dark:text-[#a1a1a6]">
            {problem}
          </p>
          <div className="mt-8 flex items-center justify-center gap-3">
            <a
              href="/download"
              className="flex h-11 items-center rounded-full bg-[#0a84ff] px-6 text-[14px] font-medium text-white hover:bg-[#0974df]"
            >
              Download again
            </a>
            <Link href="/" className="flex h-11 items-center rounded-full px-5 text-[14px] font-medium text-[#0a84ff]">
              Back to sidenote.lol
            </Link>
          </div>
        </>
      )}
    </SiteShell>
  );
}
