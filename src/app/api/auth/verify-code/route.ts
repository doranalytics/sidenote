import { NextRequest, NextResponse } from "next/server";
import {
  attachUser,
  entitlementFor,
  newInstallId,
  signAccount,
  signDownload,
  supabaseAuth,
  supabaseConfigured,
} from "@/lib/access";

export const dynamic = "force-dynamic";

// Step two: the emailed code comes back, and if it checks out — and the email
// has a purchase — the caller gets an install token (what the app keeps, and
// sends with AI calls and updates) and a download token (what the web page
// turns into the DMG). The app ignores the second; the web page the first.
export async function POST(req: NextRequest) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Sign-in isn't set up yet." }, { status: 503 });
  }
  const { email, code } = (await req.json().catch(() => ({}))) as {
    email?: string;
    code?: string;
  };
  const clean = (email ?? "").trim().toLowerCase();
  const digits = (code ?? "").replace(/\D/g, "");
  if (!clean || digits.length < 6) {
    return NextResponse.json({ error: "Enter the 6-digit code from the email." }, { status: 400 });
  }
  const { data, error } = await supabaseAuth().auth.verifyOtp({
    email: clean,
    token: digits,
    type: "email",
  });
  if (error || !data.user) {
    return NextResponse.json(
      { error: "That code didn't work. Codes expire after 30 minutes — ask for a new one." },
      { status: 401 }
    );
  }
  const ent = await entitlementFor(clean);
  if (!ent.app) {
    return NextResponse.json(
      { error: "That email is signed in, but has no Sidenote purchase.", code: "no_purchase" },
      { status: 403 }
    );
  }
  await attachUser(clean, data.user.id);
  return NextResponse.json({
    email: clean,
    token: signAccount(newInstallId(), data.user.id),
    download: signDownload(clean, "signin", 60 * 60_000),
    ai: ent.ai,
    aiStatus: ent.aiStatus,
    aiPeriodEnd: ent.aiPeriodEnd,
  });
}
