import { NextRequest, NextResponse } from "next/server";
import { isDemo } from "@/lib/store";
import { getInstallToken, hasOwnKey, setInstallToken } from "@/lib/claude";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

// Redeems an invite code with sidenote.lol and stores the resulting token in
// the vault, so it survives app updates and re-syncs. Done once per install.
const HOME = process.env.SIDENOTE_HOME ?? "https://sidenote.lol";

function shape() {
  return {
    registered: !!getInstallToken(),
    ownKey: hasOwnKey(),
  };
}

export async function GET() {
  if (isDemo) return NextResponse.json({ registered: false, ownKey: false });
  return NextResponse.json(shape());
}

export async function POST(req: NextRequest) {
  if (isDemo) return NextResponse.json({ error: "Not available here." }, { status: 400 });
  const { code } = (await req.json()) as { code?: string };
  const clean = (code ?? "").trim();
  if (!clean) return NextResponse.json({ error: "Enter your invite code." }, { status: 400 });

  try {
    const res = await fetch(`${HOME}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: clean }),
      signal: AbortSignal.timeout(15000),
    });
    const data = (await res.json()) as { token?: string; error?: string };
    if (!res.ok || !data.token) {
      return NextResponse.json(
        { error: data.error ?? "Couldn't check that code." },
        { status: res.status === 403 ? 403 : 400 }
      );
    }
    setInstallToken(data.token);
    // After the token is stored, so the event carries the new install id.
    track("code_redeemed", {});
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
  return NextResponse.json(shape());
}
