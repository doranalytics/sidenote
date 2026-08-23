import { NextRequest, NextResponse } from "next/server";
import { configured, newInstallId, signInvite } from "@/lib/access";

export const dynamic = "force-dynamic";

// Pre-paywall: trades an invite code for a token belonging to one install.
// Kept so copies of Sidenote built before accounts existed can still redeem
// a code; new builds sign in with the purchase email instead (/api/auth/*).
// Deleting a code from SIDENOTE_INVITE_CODES still kills every install that
// redeemed it.

const codes = () =>
  (process.env.SIDENOTE_INVITE_CODES ?? "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);

export async function POST(req: NextRequest) {
  if (!configured()) {
    return NextResponse.json({ error: "Sign-up isn't configured." }, { status: 503 });
  }
  const { code } = (await req.json()) as { code?: string };
  const clean = (code ?? "").trim();
  if (!clean || clean.includes(".")) {
    return NextResponse.json({ error: "Enter your invite code." }, { status: 400 });
  }
  if (!codes().includes(clean)) {
    return NextResponse.json(
      { error: "That code isn't valid. Check it and try again." },
      { status: 403 }
    );
  }
  return NextResponse.json({ token: signInvite(newInstallId(), clean) });
}
