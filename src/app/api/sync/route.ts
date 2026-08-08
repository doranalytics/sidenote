import { NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import { invalidateStore, isDemo } from "@/lib/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  if (isDemo) {
    return NextResponse.json(
      { error: "Demo mode uses sample data. Run Sidenote on your Mac to sync your own messages." },
      { status: 400 }
    );
  }
  try {
    const { runSync, startLiveSync } = await import("@/lib/local-sync");
    const started = Date.now();
    const result = runSync();
    invalidateStore();
    startLiveSync();
    track("sync_completed", {
      threads: result.threads,
      messages: result.messages,
      duration_ms: Date.now() - started,
    });
    return NextResponse.json(result);
  } catch (e) {
    const err = e as Error;
    const isPermission = err.name === "PermissionError";
    return NextResponse.json(
      { error: err.message, permission: isPermission },
      { status: isPermission ? 403 : 500 }
    );
  }
}
