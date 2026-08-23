import { NextRequest, NextResponse } from "next/server";
import { entitlementForInstall, verifyInstall } from "@/lib/access";

export const dynamic = "force-dynamic";

// What an install is entitled to right now. The app asks this (with its
// token) to draw Settings → AI correctly: signed in but not subscribed,
// subscribed until when, lapsed. Also asked right after someone comes back
// from subscribing, so "Subscribe" turns into "AI is on" without a restart.
export async function POST(req: NextRequest) {
  const { token, fresh } = (await req.json().catch(() => ({}))) as {
    token?: string;
    fresh?: boolean;
  };
  const install = verifyInstall(token);
  if (!install) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const e = await entitlementForInstall(install, !!fresh);
  return NextResponse.json({
    email: e.email || null,
    app: e.app,
    ai: e.ai,
    aiStatus: e.aiStatus,
    aiPeriodEnd: e.aiPeriodEnd,
  });
}
