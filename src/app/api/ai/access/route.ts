import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/store";
import {
  getAccountEmail,
  getInstallToken,
  hasOwnKey,
  setAccountEmail,
  setInstallToken,
} from "@/lib/claude";
import { track } from "@/lib/analytics";
import {
  cachedEntitlement,
  clearEntitlement,
  refreshEntitlement,
  storeEntitlement,
} from "@/lib/entitlement";

export const dynamic = "force-dynamic";

// Signs this copy of Sidenote in. Two steps, both relayed to sidenote.lol:
// POST sends a code to the purchase email, PUT verifies it. The token that
// comes back is stored in the vault, so it survives app updates and re-syncs.
// Done once per install.
const HOME = process.env.SIDENOTE_HOME ?? "https://sidenote.lol";

function shape() {
  const ent = cachedEntitlement();
  return {
    registered: !!getInstallToken(),
    ownKey: hasOwnKey(),
    email: getAccountEmail(),
    ai: !!ent?.ai,
    aiStatus: ent?.aiStatus ?? null,
    aiPeriodEnd: ent?.aiPeriodEnd ?? null,
    token: getInstallToken(), // so the UI can open /api/checkout and /api/portal as this account
    home: HOME,
  };
}

async function home(path: string, body: unknown) {
  const res = await fetch(`${HOME}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, data };
}

/** Current state. `?fresh=1` re-asks sidenote.lol (after subscribing). */
export async function GET(req: NextRequest) {
  if (isDemo) return NextResponse.json({ registered: false, ownKey: false, email: null, ai: false });
  if (req.nextUrl.searchParams.get("fresh") === "1" && getInstallToken()) {
    await refreshEntitlement(true);
  }
  return NextResponse.json(shape());
}

/** Step one: send a sign-in code to the purchase email. */
export async function POST(req: NextRequest) {
  if (isDemo) return NextResponse.json({ error: "Not available here." }, { status: 400 });
  const { email } = (await req.json()) as { email?: string };
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean) return NextResponse.json({ error: "Enter your email." }, { status: 400 });
  try {
    const { res, data } = await home("/api/auth/send-code", { email: clean });
    if (!res.ok) {
      return NextResponse.json(
        { error: (data.error as string) ?? "Couldn't send a code.", code: data.code },
        { status: res.status === 404 ? 404 : 400 }
      );
    }
    return NextResponse.json({ sent: true });
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach Sidenote to send the code. Check your connection." },
      { status: 400 }
    );
  }
}

/** Step two: verify the code; store the token this install now owns. */
export async function PUT(req: NextRequest) {
  if (isDemo) return NextResponse.json({ error: "Not available here." }, { status: 400 });
  const { email, code } = (await req.json()) as { email?: string; code?: string };
  const clean = (email ?? "").trim().toLowerCase();
  if (!clean || !(code ?? "").trim()) {
    return NextResponse.json({ error: "Enter the code from the email." }, { status: 400 });
  }
  try {
    const { res, data } = await home("/api/auth/verify-code", { email: clean, code });
    if (!res.ok || !data.token) {
      return NextResponse.json(
        { error: (data.error as string) ?? "That code didn't work." },
        { status: 400 }
      );
    }
    setInstallToken(data.token as string);
    setAccountEmail(clean);
    storeEntitlement({
      app: true,
      ai: !!data.ai,
      aiStatus: (data.aiStatus as string | null) ?? null,
      aiPeriodEnd: (data.aiPeriodEnd as string | null) ?? null,
    });
    // After the token is stored, so the event carries the new install id.
    track("signed_in", {});
    return NextResponse.json(shape());
  } catch {
    return NextResponse.json(
      { error: "Couldn't reach Sidenote to check the code. Check your connection." },
      { status: 400 }
    );
  }
}

export async function DELETE() {
  if (isDemo) return NextResponse.json({ ok: false });
  setInstallToken(null);
  setAccountEmail(null);
  clearEntitlement();
  return NextResponse.json(shape());
}
