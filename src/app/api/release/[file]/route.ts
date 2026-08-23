import { NextRequest, NextResponse } from "next/server";
import { installOwnsApp, installFrom, logDownload, releaseUrl } from "@/lib/access";

export const dynamic = "force-dynamic";

// What the in-app updater downloads from. Same private bucket as the DMG,
// but authorized by the install token the app already holds — so an update
// is never a second purchase, and an install that isn't signed in (or whose
// purchase was refunded) is told so instead of handed the build.
export async function GET(req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const install = installFrom(req);
  if (!install) {
    return NextResponse.json(
      { error: "Sign in to Sidenote (Settings → AI) to download updates." },
      { status: 401 }
    );
  }
  if (!(await installOwnsApp(install))) {
    return NextResponse.json(
      { error: "This Sidenote account no longer has an active purchase." },
      { status: 403 }
    );
  }
  const { file } = await ctx.params;
  const url = await releaseUrl(file);
  if (!url) return NextResponse.json({ error: "Not found." }, { status: 404 });
  void logDownload(null, file, "update");
  return NextResponse.redirect(url, 307);
}
