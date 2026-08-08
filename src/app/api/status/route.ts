import { NextResponse } from "next/server";
import { getStatus, isDemo } from "@/lib/store";
import { aiAvailable } from "@/lib/claude";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";

let launched = false;

export async function GET() {
  const status = getStatus();
  if (!isDemo) {
    status.ai = { configured: aiAvailable() };
    // In the Mac app it's the bundle that appears in the Full Disk Access
    // list, not the engine binary inside it.
    status.engine = process.env.SIDENOTE_APP_PATH ?? process.execPath;
    if (process.env.SIDENOTE_TRANSLOCATED === "1") status.translocated = true;
    // Once per server process, which is once per app launch.
    if (!launched) {
      launched = true;
      track("app_opened", { synced: status.synced, ai: status.ai.configured });
    }
    if (status.synced) {
      // live mode: new texts flow into the index within seconds
      const { startLiveSync } = await import("@/lib/local-sync");
      startLiveSync();
    }
  }
  return NextResponse.json(status);
}
