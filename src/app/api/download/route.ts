import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Counts a download, then sends the browser to the release asset.
//
// This exists because the download is a redirect to GitHub Releases. A plain
// redirect is handled before any page code runs, so a click from Product Hunt,
// a pasted link, or anything that isn't our own button would never be seen —
// downloads would look like whatever fraction happened to come through the
// landing page.
//
// The capture is fire-and-forget and never delays the redirect: a slow
// analytics call must not be the reason someone's download hangs.

const ASSETS: Record<string, string> = {
  dmg: "Sidenote.dmg",
  zip: "Sidenote.zip",
};

const RELEASE = "https://github.com/doranalytics/sidenote/releases/latest/download";
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
      signal: AbortSignal.timeout(3000),
      body: JSON.stringify({
        api_key: key,
        event: "download_started",
        distinct_id: distinctId(req),
        properties: {
          file,
          format: file.endsWith(".dmg") ? "dmg" : "zip",
          source,
          $referrer: referrer,
          // UTM tags survive the redirect, so a Product Hunt link stays
          // attributable all the way to the download.
          utm_source: req.nextUrl.searchParams.get("utm_source") ?? undefined,
          utm_campaign: req.nextUrl.searchParams.get("utm_campaign") ?? undefined,
          $current_url: req.nextUrl.href,
        },
      }),
    }).catch(() => {});
  }

  return NextResponse.redirect(`${RELEASE}/${file}`, 307);
}
