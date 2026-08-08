import { NextRequest, NextResponse } from "next/server";
import { verifyInstall } from "@/app/api/register/route";
import { meterJson, meterStream, report } from "@/lib/meter";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Relays Anthropic calls so installed copies of Sidenote don't each need their
// own API key. The app points the Anthropic SDK's baseURL here; this adds the
// real key server-side and streams the response straight back, so the SDK —
// including its tool loop — works unchanged. Tools still execute on the user's
// Mac: only the model call crosses the wire.
//
// Access is per install: a copy of Sidenote redeems an invite code once (see
// /api/register) and sends the resulting signed token here. Removing a code
// from SIDENOTE_INVITE_CODES revokes every install that used it, which is the
// answer to "my friend forwarded the app to someone".
//
// ⚠️  Still not a hard boundary: whoever holds a valid code — or extracts a
// token from their own install — can call this directly and spend the
// operator's Anthropic balance. Per-IP limits and a billing cap on the
// Anthropic key are what actually bound the damage until usage metering exists.

const UPSTREAM = "https://api.anthropic.com";
const ALLOWED = new Set(["v1/messages"]);

// Per-install sliding window, sized to what a person actually does: asking
// about your own texts is a handful of questions a minute, not thirty.
// In-memory, so it resets on cold start and isn't shared across regions.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const hits = new Map<string, number[]>();

function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear(); // crude bound on memory
  return recent.length > MAX_PER_WINDOW;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return NextResponse.json(
      { error: { message: "This Sidenote server has no API key configured." } },
      { status: 503 }
    );
  }

  const install = verifyInstall(req.headers.get("x-sidenote-install"));
  if (!install) {
    return NextResponse.json(
      { error: { message: "This copy of Sidenote isn't registered." } },
      { status: 401 }
    );
  }

  if (rateLimited(install.installId)) {
    return NextResponse.json(
      { error: { message: "Too many requests — give it a minute." } },
      { status: 429 }
    );
  }

  const path = (await ctx.params).path.join("/");
  if (!ALLOWED.has(path)) {
    return NextResponse.json({ error: { message: "Not found." } }, { status: 404 });
  }

  const body = await req.text();
  // Bound what a single call can cost, whatever the client asked for.
  let payload = body;
  try {
    const parsed = JSON.parse(body) as { max_tokens?: number };
    if (typeof parsed.max_tokens === "number" && parsed.max_tokens > 4000) {
      payload = JSON.stringify({ ...parsed, max_tokens: 4000 });
    }
  } catch {
    return NextResponse.json({ error: { message: "Bad request." } }, { status: 400 });
  }

  const started = Date.now();
  const model = (() => {
    try {
      return (JSON.parse(payload) as { model?: string }).model ?? "unknown";
    } catch {
      return "unknown";
    }
  })();
  // Which feature made the call, so cost can be attributed to Explain vs a
  // thread question vs a web look-up. Sent by the app; unknown if absent.
  const fn = (req.headers.get("x-sidenote-fn") ?? "unknown").slice(0, 32);

  const upstream = await fetch(`${UPSTREAM}/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01",
      "x-api-key": key,
      ...(req.headers.get("anthropic-beta")
        ? { "anthropic-beta": req.headers.get("anthropic-beta")! }
        : {}),
    },
    body: payload,
  });

  const contentType = upstream.headers.get("content-type") ?? "application/json";
  const finish = (usage: Awaited<ReturnType<typeof meterStream>>) =>
    report({
      installId: install.installId,
      code: install.code,
      fn,
      model,
      usage,
      ms: Date.now() - started,
      status: upstream.status,
    });

  // Non-streaming: read it, measure it, hand it on.
  if (!contentType.includes("event-stream") || !upstream.body) {
    const text = await upstream.text();
    void finish(meterJson(text));
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": contentType, "cache-control": "no-store" },
    });
  }

  // Streaming: tee it. One copy goes to the app untouched so nothing about the
  // response changes; the other is read only to total up tokens.
  const [toClient, toMeter] = upstream.body.tee();
  void meterStream(toMeter).then(finish);
  return new Response(toClient, {
    status: upstream.status,
    headers: { "content-type": contentType, "cache-control": "no-store" },
  });
}
