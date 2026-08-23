import { getSetting, setSetting } from "@/lib/vault";
import { getInstallToken } from "@/lib/claude";

// What this install is allowed to do, as last confirmed by sidenote.lol.
//
// The relay is the real gate — it re-checks the subscription on every AI
// call — but the app needs to know too, to draw Settings → AI honestly
// ("signed in, AI off, $10/month") instead of letting you type a question and
// handing back an error. So the answer is cached in the vault (survives
// restarts, works offline) and refreshed in the background every ten minutes,
// or on demand right after you come back from subscribing.
const HOME = process.env.SIDENOTE_HOME ?? "https://sidenote.lol";
const SETTING = "entitlement";
const TTL = 10 * 60_000;

export type Entitlement = {
  app: boolean;
  ai: boolean;
  aiStatus: string | null;
  aiPeriodEnd: string | null;
  checkedAt: number;
};

export function cachedEntitlement(): Entitlement | null {
  const raw = getSetting(SETTING);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Entitlement;
  } catch {
    return null;
  }
}

export function storeEntitlement(e: Omit<Entitlement, "checkedAt">): Entitlement {
  const full = { ...e, checkedAt: Date.now() };
  setSetting(SETTING, JSON.stringify(full));
  return full;
}

export function clearEntitlement(): void {
  setSetting(SETTING, null);
}

let inflight: Promise<Entitlement | null> | null = null;

/** Asks sidenote.lol. `fresh` skips its cache too (right after subscribing). */
export async function refreshEntitlement(fresh = false): Promise<Entitlement | null> {
  const token = getInstallToken();
  if (!token) return null;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch(`${HOME}/api/auth/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, fresh }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 401) {
        // The token no longer verifies at all (secret rotated, say).
        return storeEntitlement({ app: false, ai: false, aiStatus: null, aiPeriodEnd: null });
      }
      if (!res.ok) return cachedEntitlement();
      const d = (await res.json()) as Omit<Entitlement, "checkedAt">;
      return storeEntitlement({ app: !!d.app, ai: !!d.ai, aiStatus: d.aiStatus ?? null, aiPeriodEnd: d.aiPeriodEnd ?? null });
    } catch {
      return cachedEntitlement(); // offline: last known answer
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Synchronous read for hot paths (the status poll). Kicks off a refresh in
 *  the background when the cached answer is stale or missing. */
export function aiEntitled(): boolean {
  if (!getInstallToken()) return false;
  const c = cachedEntitlement();
  if (!c || Date.now() - c.checkedAt > TTL) void refreshEntitlement();
  // Never checked yet (an install signed in before this code existed): let
  // the relay decide rather than showing a paywall to someone who's paid.
  return c ? c.ai : true;
}
