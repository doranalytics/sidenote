import { NextRequest, NextResponse } from "next/server";
import { ensureUser, ownsApp, supabaseAuth, supabaseConfigured } from "@/lib/access";

export const dynamic = "force-dynamic";

// Step one of signing in, from the app or from sidenote.lol/download: email in,
// 6-digit code out (by email). Only emails with a purchase get a code — the
// code is how you prove you're the buyer, so there's nothing to send anyone
// else, and saying so plainly beats a code that then fails.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "Sign-in isn't set up yet." }, { status: 503 });
  }
  const { email } = (await req.json().catch(() => ({}))) as { email?: string };
  const clean = (email ?? "").trim().toLowerCase();
  if (!EMAIL.test(clean)) {
    return NextResponse.json({ error: "Enter the email you bought Sidenote with." }, { status: 400 });
  }
  if (!(await ownsApp(clean))) {
    return NextResponse.json(
      {
        error: "There's no Sidenote purchase under that email. Check the receipt from Stripe — it's the address you paid with.",
        code: "no_purchase",
      },
      { status: 404 }
    );
  }
  // Covers purchases recorded before the user existed (a manual grant, say).
  await ensureUser(clean);
  const { error } = await supabaseAuth().auth.signInWithOtp({
    email: clean,
    options: { shouldCreateUser: false },
  });
  if (error) {
    const tooMany = /rate|limit|too many|seconds/i.test(error.message);
    return NextResponse.json(
      {
        error: tooMany
          ? "A code was sent recently — check your inbox (and spam), or try again in a minute."
          : "Couldn't send the code. Try again in a moment.",
      },
      { status: tooMany ? 429 : 502 }
    );
  }
  return NextResponse.json({ sent: true });
}
