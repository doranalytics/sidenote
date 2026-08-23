"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// The two-step sign-in used everywhere: email → 6-digit code. Inside the app
// it talks to the local server (/api/ai/access), which relays to sidenote.lol;
// on sidenote.lol/download it talks to /api/auth/* directly. Same shape, so
// the caller just supplies the two requests.

export type SignInResult = Record<string, unknown>;

export function SignInForm({
  sendCode,
  verifyCode,
  onSignedIn,
  buyHref = "https://sidenote.lol/#buy",
  align = "center",
  className,
}: {
  sendCode: (email: string) => Promise<{ ok: boolean; error?: string; code?: string }>;
  verifyCode: (email: string, code: string) => Promise<{ ok: boolean; error?: string; data?: SignInResult }>;
  onSignedIn: (data: SignInResult, email: string) => void;
  buyHref?: string;
  align?: "center" | "left";
  className?: string;
}) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noPurchase, setNoPurchase] = useState(false);

  const send = async () => {
    const value = email.trim().toLowerCase();
    if (!value) return;
    setBusy(true);
    setError(null);
    setNoPurchase(false);
    try {
      const r = await sendCode(value);
      if (!r.ok) {
        setError(r.error ?? "Couldn't send a code.");
        setNoPurchase(r.code === "no_purchase");
        return;
      }
      setStage("code");
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    const digits = code.replace(/\D/g, "");
    if (digits.length < 6) return;
    setBusy(true);
    setError(null);
    try {
      const r = await verifyCode(email.trim().toLowerCase(), digits);
      if (!r.ok) {
        setError(r.error ?? "That code didn't work.");
        return;
      }
      onSignedIn(r.data ?? {}, email.trim().toLowerCase());
    } finally {
      setBusy(false);
    }
  };

  const left = align === "left";

  return (
    <div className={cn("w-full max-w-[300px]", left ? "" : "mx-auto text-center", className)}>
      {stage === "email" ? (
        <div className="flex items-center gap-2">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder="Email you bought with"
            autoComplete="email"
            spellCheck={false}
            className="h-9 flex-1 text-[13px]"
          />
          <Button
            size="sm"
            onClick={send}
            disabled={busy || !email.trim()}
            className="h-9 shrink-0 rounded-lg bg-[#0a84ff] text-[12.5px] hover:bg-[#0974df]"
          >
            {busy ? <RefreshCw className="size-3.5 animate-spin" /> : "Send code"}
          </Button>
        </div>
      ) : (
        <>
          <p className={cn("mb-2 text-[12.5px] text-muted-foreground", left ? "" : "text-center")}>
            We emailed a 6-digit code to <span className="font-medium text-foreground">{email.trim()}</span>.
          </p>
          <div className="flex items-center gap-2">
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/[^\d\s-]/g, "").slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === "Enter") verify();
              }}
              placeholder="123456"
              autoFocus
              spellCheck={false}
              className="h-9 flex-1 text-[15px] tracking-[0.2em]"
            />
            <Button
              size="sm"
              onClick={verify}
              disabled={busy || code.replace(/\D/g, "").length < 6}
              className="h-9 shrink-0 rounded-lg bg-[#0a84ff] text-[12.5px] hover:bg-[#0974df]"
            >
              {busy ? <RefreshCw className="size-3.5 animate-spin" /> : "Sign in"}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => {
              setStage("email");
              setCode("");
              setError(null);
            }}
            className={cn(
              "mt-2 text-[12px] text-muted-foreground underline-offset-2 hover:underline",
              left ? "" : "mx-auto block"
            )}
          >
            Different email, or send it again
          </button>
        </>
      )}
      {error && (
        <p className={cn("mt-2.5 text-[12.5px] leading-relaxed text-red-500", left ? "" : "text-center")}>
          {error}
          {noPurchase && (
            <>
              {" "}
              <a
                href={buyHref}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-[#0a84ff] underline-offset-2 hover:underline"
              >
                Get Sidenote — $39
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
