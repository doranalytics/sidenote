import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { entitlementForInstall, installFrom } from "@/lib/access";

export const dynamic = "force-dynamic";

// "Manage subscription" inside the app opens the browser here with the
// install token; this turns it into a Stripe customer-portal session (update
// card, cancel, see invoices) for the customer behind that account.
export async function GET(req: NextRequest) {
  const install = installFrom(req);
  if (!install) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const e = await entitlementForInstall(install, true);
  if (!e.stripeCustomerId) {
    return NextResponse.redirect(new URL("/thanks?canceled=ai", req.nextUrl.origin), 303);
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: e.stripeCustomerId,
    return_url: `${req.nextUrl.origin}/thanks?portal=done`,
  });
  return NextResponse.redirect(session.url, 303);
}
