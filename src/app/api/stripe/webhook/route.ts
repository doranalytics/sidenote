import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import { markRefunded, recordAiSubscription, recordAppPurchase } from "@/lib/access";

export const dynamic = "force-dynamic";

// Stripe tells us here when someone has paid, subscribed, lapsed, canceled,
// or been refunded. This is the system of record for who gets what: the
// thanks page also records a purchase, for the person sitting there waiting,
// but a closed tab, a delayed payment method, or a card that fails on renewal
// all end up reflected in the table because of this.

async function emailForCustomer(customerId: string): Promise<string | null> {
  const c = await stripe().customers.retrieve(customerId);
  return c.deleted ? null : (c.email?.toLowerCase() ?? null);
}

async function mirrorSubscription(sub: Stripe.Subscription, livemode: boolean) {
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const email = await emailForCustomer(customerId);
  if (!email) return;
  const item = sub.items.data[0];
  await recordAiSubscription({
    email,
    subscriptionId: sub.id,
    customerId,
    status: sub.status,
    periodEnd: item?.current_period_end ?? null,
    amountCents: item?.price.unit_amount ?? 0,
    currency: item?.price.currency ?? "usd",
    livemode,
  });
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const sig = req.headers.get("stripe-signature");
  if (!secret || !sig) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  }
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(await req.text(), sig, secret);
  } catch (e) {
    return NextResponse.json({ error: `Bad signature: ${(e as Error).message}` }, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const s = event.data.object;
        if (s.payment_status !== "paid") break;
        const email = s.customer_details?.email ?? s.customer_email;
        if (!email) break;
        if (s.mode === "subscription") {
          // The subscription.created event carries the full state; but it can
          // arrive after this one, and this one has the email for sure.
          const subId = typeof s.subscription === "string" ? s.subscription : s.subscription?.id;
          if (subId) {
            const sub = await stripe().subscriptions.retrieve(subId);
            await mirrorSubscription(sub, event.livemode);
          }
          break;
        }
        await recordAppPurchase({
          email,
          sessionId: s.id,
          customerId: typeof s.customer === "string" ? s.customer : (s.customer?.id ?? null),
          paymentIntentId:
            typeof s.payment_intent === "string" ? s.payment_intent : (s.payment_intent?.id ?? null),
          amountCents: s.amount_total ?? 0,
          currency: s.currency ?? "usd",
          livemode: event.livemode,
        });
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted":
      case "customer.subscription.paused":
      case "customer.subscription.resumed": {
        await mirrorSubscription(event.data.object, event.livemode);
        break;
      }
      case "charge.refunded": {
        const c = event.data.object;
        // Partial refunds keep the license; a full one revokes it.
        if (c.amount_refunded >= c.amount && c.payment_intent) {
          await markRefunded(
            typeof c.payment_intent === "string" ? c.payment_intent : c.payment_intent.id
          );
        }
        break;
      }
      default:
        break;
    }
  } catch (e) {
    // A 500 makes Stripe retry, which is what we want for a database blip.
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
  return NextResponse.json({ received: true });
}
