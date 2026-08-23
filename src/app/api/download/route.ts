import { NextRequest, NextResponse } from "next/server";
import { logDownload, releaseUrl, verifyDownload } from "@/lib/access";

export const dynamic = "force-dynamic";

// Hands out the DMG to someone who has paid, then counts it.
//
// The build lives in a private bucket (it was a public GitHub Release, which
// is no paywall at all). A download token — minted by /thanks right after
// paying, or by /download after signing in with the purchase email — turns
// into a 60-second signed URL here. No token, or a stale one, and you're sent
// to the sign-in page rather than shown an error: "download it again" is the
// normal reason to arrive here without one.
//
// The PostHog capture is fire-and-forget and never delays the redirect.

const ASSETS: Record<string, string> = {
  dmg: "Sidenote.dmg",
  zip: "Sidenote.zip",
};

const HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

/** The id posthog-js already gave this browser, so a download joins up with
 *  the pageview that preceded it instead of looking like a stranger. */
function distinctId(req: NextRequest): string {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const raw = key ? req.cookies.get(`ph_${key}_posthog`)?.value : null;
  if (raw) {
    try {
      const id = (JSON.parse(raw) as { distinct_id?: string }).distinct_id;
      if (id) return id;
    } catch {
      // malformed cookie — fall through to anonymous
    }
  }
  return `anon-${crypto.randomUUID()}`;
}

export async function GET(req: NextRequest) {
  const file = ASSETS[req.nextUrl.searchParams.get("f") ?? "dmg"] ?? ASSETS.dmg;
  const grant = verifyDownload(req.nextUrl.searchParams.get("t"));
  if (!grant) {
    const to = new URL("/download", req.nextUrl.origin);
    to.searchParams.set("expired", req.nextUrl.searchParams.has("t") ? "1" : "0");
    return NextResponse.redirect(to, 303);
  }

  const url = await releaseUrl(file);
  if (!url) {
    return NextResponse.json(
      { error: "The download isn't available right now. Try again in a few minutes." },
      { status: 503 }
    );
  }

  void logDownload(grant.email, file, grant.via);

  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (key) {
    const referrer = req.headers.get("referer") ?? "";
    let source = "direct";
    try {
      if (referrer) source = new URL(referrer).hostname;
    } catch {
      // unparseable referrer — leave it as direct
    }
    void fetch(`${HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({
        api_key: key,
        event: "download",
        distinct_id: distinctId(req),
        properties: {
          file,
          format: file.endsWith(".dmg") ? "dmg" : "zip",
          source,
          via: grant.via,
          $referrer: referrer,
          $current_url: req.nextUrl.href,
        },
      }),
    }).catch(() => {});
  }

  return NextResponse.redirect(url, 307);
}
