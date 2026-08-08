import { getInstallToken } from "@/lib/claude";

// Product analytics for the app itself, sent from the local Node server rather
// than the page, so there's exactly one place to audit what leaves the machine.
//
// What is NEVER sent: message text, contact names, phone numbers, thread names,
// note contents, search queries, or anything derived from them. Only counts,
// durations, and feature names. That constraint is the whole reason this file
// exists instead of dropping posthog-js into the app — a snippet in the page
// would capture URLs, text, and autocapture events by default.
//
// Disclosed in the README and on the site. If POSTHOG_KEY isn't set, every
// call here is a no-op.

const HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

/** Stable per-install id, derived from the install token. Not reversible to a
 *  code and not tied to any personal detail. */
function installId(): string {
  const token = getInstallToken();
  if (!token) return "anonymous";
  const parts = token.split(".");
  return parts.length === 4 ? parts[1] : "anonymous";
}

export type AppEvent =
  | "app_opened"
  | "sync_completed"
  | "code_redeemed"
  | "embed_started"
  | "embed_completed"
  | "search_performed"
  | "message_pinned"
  | "note_saved"
  | "thread_exported";

export function track(event: AppEvent, properties: Record<string, unknown> = {}): void {
  const key = process.env.POSTHOG_KEY;
  if (process.env.SIDENOTE_DEBUG_ANALYTICS === "1") {
    console.error(`[analytics] ${event} key=${key ? "set" : "MISSING"}`);
  }
  if (!key) return;
  // Fire and forget — analytics must never slow down or break a user action.
  void fetch(`${HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(4000),
    body: JSON.stringify({
      api_key: key,
      event,
      distinct_id: installId(),
      properties: {
        ...properties,
        surface: "app",
        app_version: process.env.SIDENOTE_COMMIT_DATE ?? "dev",
        $process_person_profile: true,
      },
    }),
  })
    .then((r) => {
      if (process.env.SIDENOTE_DEBUG_ANALYTICS === "1") {
        console.error(`[analytics] ${event} -> ${r.status}`);
      }
    })
    .catch((e) => {
      if (process.env.SIDENOTE_DEBUG_ANALYTICS === "1") {
        console.error(`[analytics] ${event} FAILED: ${(e as Error).message}`);
      }
    });
}
