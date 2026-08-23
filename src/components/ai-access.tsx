"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, LogOut, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SignInForm, sendCodeLocal, verifyCodeLocal } from "@/components/sign-in-local";
import { AI_MONTHLY_USD } from "@/lib/pricing";
import { cn } from "@/lib/utils";

// The whole "is AI on for this copy?" story, in one place, drawn the same in
// Settings and in the Ask AI panel:
//
//   1. not signed in        → email → code
//   2. signed in, no plan   → AI is $10/month · [Turn on AI] (opens the
//                             browser into Stripe; we re-check on return)
//   3. signed in, AI on     → on until <date> · [Manage] · [Sign out]
//   4. own Anthropic key    → AI runs on it; none of the above applies
//
// Everything goes through this Mac's own server (/api/ai/access), which holds
// the token and relays to sidenote.lol.

export type Access = {
  registered: boolean;
  ownKey: boolean;
  email: string | null;
  ai: boolean;
  aiStatus: string | null;
  aiPeriodEnd: string | null;
  token: string | null;
  home: string;
};

async function load(fresh = false): Promise<Access | null> {
  try {
    const res = await fetch(`/api/ai/access${fresh ? "?fresh=1" : ""}`);
    if (!res.ok) return null;
    return (await res.json()) as Access;
  } catch {
    return null;
  }
}

function until(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function AiAccess({
  variant = "settings",
  onChange,
  className,
}: {
  /** "panel" centers and tightens copy for the Ask AI empty state. */
  variant?: "settings" | "panel";
  /** Called whenever AI flips on or off, so the shell can refresh. */
  onChange?: (access: Access) => void;
  className?: string;
}) {
  const [access, setAccess] = useState<Access | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(
    (fresh = false) =>
      Promise.resolve().then(async () => {
        setChecking(true);
        const a = await load(fresh);
        setChecking(false);
        if (a) {
          setAccess((prev) => {
            if (prev && (prev.ai !== a.ai || prev.registered !== a.registered)) onChange?.(a);
            return a;
          });
        }
      }),
    [onChange]
  );

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Back from the browser (Stripe, the portal): ask again, skipping caches.
  // Only while something could have changed — no point hammering when AI is
  // already on or nobody's signed in.
  useEffect(() => {
    if (!access?.registered || access.ownKey || access.ai) return;
    const onFocus = () => refresh(true);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [access?.registered, access?.ownKey, access?.ai, refresh]);

  const signOut = async () => {
    setError(null);
    try {
      const a = (await fetch("/api/ai/access", { method: "DELETE" }).then((r) => r.json())) as Access;
      setAccess(a);
      onChange?.(a);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const panel = variant === "panel";
  const muted = "text-[13px] leading-relaxed text-muted-foreground";
  const home = access?.home ?? "https://sidenote.lol";
  const t = access?.token ? `t=${encodeURIComponent(access.token)}` : "";

  if (!access) {
    return (
      <div className={cn(panel ? "text-center" : "", className)}>
        <p className={muted}>Checking…</p>
      </div>
    );
  }

  // ---- own key: nothing to sell ----
  if (access.ownKey) {
    return (
      <div className={cn(panel ? "text-center" : "", className)}>
        <p className={muted}>Running on your own Anthropic key, billed to you.</p>
      </div>
    );
  }

  // ---- 1. sign in ----
  if (!access.registered) {
    return (
      <div className={cn(panel ? "flex flex-col items-center text-center" : "", className)}>
        {!panel && (
          <p className={cn("mt-1.5", muted)}>
            Sign in with the email you bought Sidenote with. One time, then it sticks.
          </p>
        )}
        <SignInForm
          className={panel ? "mt-1" : "mt-3 max-w-none"}
          align={panel ? "center" : "left"}
          sendCode={sendCodeLocal}
          verifyCode={verifyCodeLocal}
          buyHref={`${home}/#pricing`}
          onSignedIn={(data) => {
            const a = data as unknown as Access;
            setAccess(a);
            onChange?.(a);
          }}
        />
      </div>
    );
  }

  // ---- 3. AI on ----
  if (access.ai) {
    const end = until(access.aiPeriodEnd);
    const invite = access.aiStatus === "invite";
    return (
      <div className={cn(panel ? "flex flex-col items-center text-center" : "", className)}>
        <p className={cn("mt-1.5", muted)}>
          {access.email ? (
            <>
              Signed in as <span className="font-medium text-foreground">{access.email}</span>.{" "}
            </>
          ) : null}
          AI is on
          {!invite && end
            ? access.aiStatus === "past_due"
              ? ` — payment didn't go through; update your card before ${end} to keep it.`
              : ` — renews ${end}.`
            : "."}{" "}
          Explaining a message sends only the few messages around it, and only when you ask — the
          rest of your archive stays on this Mac.
        </p>
        <div className={cn("mt-3 flex flex-wrap items-center gap-2", panel && "justify-center")}>
          {!invite && (
            <a
              href={`${home}/api/portal?${t}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12.5px] font-medium hover:bg-accent"
            >
              <ExternalLink className="size-3.5" />
              Manage subscription
            </a>
          )}
          <Button size="sm" variant="outline" onClick={signOut} className="h-8 rounded-lg text-[12.5px]">
            <LogOut className="mr-1.5 size-3.5" />
            Sign out
          </Button>
        </div>
        {error && <p className="mt-2.5 text-[12.5px] text-red-500">{error}</p>}
      </div>
    );
  }

  // ---- 2. signed in, subscribe ----
  const lapsed = access.aiStatus && access.aiStatus !== "invite";
  return (
    <div className={cn(panel ? "flex flex-col items-center text-center" : "", className)}>
      <p className={cn("mt-1.5", muted)}>
        {access.email ? (
          <>
            Signed in as <span className="font-medium text-foreground">{access.email}</span>.{" "}
          </>
        ) : null}
        {lapsed
          ? `Your AI subscription ${access.aiStatus === "canceled" ? "ended" : "lapsed"}. Turn it back on for $${AI_MONTHLY_USD}/month — cancel any time.`
          : `AI is $${AI_MONTHLY_USD}/month: explain any message, ask about a whole conversation, draft replies. Cancel any time. Search, notes, pins, and export work without it.`}
      </p>
      <div className={cn("mt-3 flex flex-wrap items-center gap-2", panel && "justify-center")}>
        <a
          href={`${home}/api/checkout?plan=ai&${t}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0a84ff] px-3.5 text-[12.5px] font-medium text-white hover:bg-[#0974df]"
        >
          <Sparkles className="size-3.5" />
          Turn on AI — ${AI_MONTHLY_USD}/mo
        </a>
        <Button
          size="sm"
          variant="outline"
          onClick={() => refresh(true)}
          disabled={checking}
          className="h-9 rounded-lg text-[12.5px]"
        >
          <RefreshCw className={cn("mr-1.5 size-3.5", checking && "animate-spin")} />
          Check again
        </Button>
        <Button size="sm" variant="ghost" onClick={signOut} className="h-9 rounded-lg text-[12.5px]">
          Sign out
        </Button>
      </div>
      <p className={cn("mt-2 text-[12px] text-muted-foreground", panel && "text-center")}>
        Opens in your browser; come back here after and AI switches on by itself.
      </p>
      {error && <p className="mt-2.5 text-[12.5px] text-red-500">{error}</p>}
    </div>
  );
}
