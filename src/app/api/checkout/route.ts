import { NextRequest, NextResponse } from "next/server";
import { stripe, stripeConfigured } from "@/lib/stripe";
import { entitlementFor, installFrom, emailForUser } from "@/lib/access";

export const dynamic = "force-dynamic";

// Sends you to Stripe. Two products, one door:
//
//   /api/checkout            — the app, $39 once. A plain link from the site.
//   /api/checkout?plan=ai    — AI, $10/month. Reached from inside the app
//                              (Settings → AI → Subscribe), which opens the
//                              browser with its install token so the
//                              subscription lands on the same email and the
//                              same Stripe customer as the purchase.
//
// After paying, Stripe sends you to /thanks, which verifies the session.
export async function GET(req: NextRequest) {
  if (!stripeConfigured()) {
    return NextResponse.json({ error: "Purchases aren't set up yet." }, { status: 503 });
  }
  const origin = req.nextUrl.origin;
  const plan = req.nextUrl.searchParams.get("plan") === "ai" ? "ai" : "app";
  const utm = new URLSearchParams();
  for (const k of ["utm_source", "utm_campaign", "utm_medium"]) {
    const v = req.nextUrl.searchParams.get(k);
    if (v) utm.set(k, v);
  }

  // Who's buying, when we already know: the app sends its token; the thanks
  // page sends the email it just saw. Prefilling means one fewer thing to
  // type and, more importantly, that AI attaches to the right account.
  let email: string | null = null;
  const install = installFrom(req);
  if (install?.kind === "account") email = await emailForUser(install.userId);
  if (!email) {
    const e = req.nextUrl.searchParams.get("email");
    if (e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) email = e.toLowerCase();
  }
  let customer: string | null = null;
  if (email) {
    try {
      customer = (await entitlementFor(email)).stripeCustomerId;
    } catch {
      // fine — Stripe will make a new customer
    }
  }

  const common = {
    allow_promotion_codes: true,
    billing_address_collection: "auto" as const,
    success_url: `${origin}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: plan === "ai" ? `${origin}/thanks?canceled=ai` : `${origin}/?canceled=1`,
    metadata: { product: "sidenote", plan, ...Object.fromEntries(utm) },
    ...(customer ? { customer } : email ? { customer_email: email } : {}),
  };

  const session =
    plan === "ai"
      ? await stripe().checkout.sessions.create({
          ...common,
          mode: "subscription",
          line_items: [{ price: process.env.STRIPE_PRICE_AI!, quantity: 1 }],
          subscription_data: { metadata: { product: "sidenote", plan: "ai" } },
        })
      : await stripe().checkout.sessions.create({
          ...common,
          mode: "payment",
          line_items: [{ price: process.env.STRIPE_PRICE_APP!, quantity: 1 }],
          // A Customer for every buyer, so the receipt, the refund, and the
          // later AI subscription all hang off one record.
          ...(customer ? {} : { customer_creation: "always" as const }),
          payment_intent_data: { description: "Sidenote for Mac" },
        });
  if (!session.url) {
    return NextResponse.json({ error: "Couldn't start checkout." }, { status: 502 });
  }
  return NextResponse.redirect(session.url, 303);
}
