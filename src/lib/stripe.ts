import Stripe from "stripe";

// One Stripe account just for Sidenote — its own balance, payouts, and
// reporting, not mixed in with anything else. Keys come from the Vercel env:
// test keys on preview deploys, live keys in production.
let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("Stripe isn't configured.");
  cached = new Stripe(key, { typescript: true });
  return cached;
}

export const stripeConfigured = () =>
  !!process.env.STRIPE_SECRET_KEY &&
  !!process.env.STRIPE_PRICE_APP &&
  !!process.env.STRIPE_PRICE_AI;

export { PRICE_USD, AI_MONTHLY_USD } from "@/lib/pricing";
