"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleStop, Copy, Globe, Send, Sparkles } from "lucide-react";
import type { Message } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Markdown, toPlainText } from "@/components/markdown";

export type ExplainMode = "explain" | "lookup" | "reply";

const TITLE: Record<ExplainMode, string> = {
  explain: "What this means",
  lookup: "Looking this up",
  reply: "A reply you could send",
};

type Turn = { role: "user" | "ai"; text: string };

const WIDTH = 340;

// What the demo shows instead of calling the API. The demo has no key and only
// fictional messages, so a canned line that describes the feature is more
// honest than a red error — and more useful than hiding the menu entirely.
const DEMO_COPY: Record<ExplainMode, string> = {
  explain:
    "On your Mac, this reads the messages around this one and explains what it means — slang, references, tone, in-jokes — so you never have to paste a text into another app to work out what someone meant.",
  lookup:
    "On your Mac, this identifies the people, places, bands, and events in a message, searching both the web and your own history for earlier mentions.",
  reply:
    "On your Mac, this drafts a reply in your voice, matching how you actually write to this person.",
};

// A small card anchored to the bubble you right-clicked. It exists because the
// alternative — copy the message, switch to another app, paste, come back — is
// the exact friction this feature was asked for. Follow-ups stay in the card so
// the back-and-forth happens in place; when it turns into a real conversation,
// "Continue in panel" hands it to the bigger surface.
export function ExplainPopover({
  threadId,
  message,
  mode,
  x,
  y,
  demo,
  onClose,
  onOpenPanel,
}: {
  threadId: string;
  message: Message;
  mode: ExplainMode;
  x: number;
  y: number;
  demo?: boolean;
  onClose: () => void;
  onOpenPanel: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState("");
  const [usedWeb, setUsedWeb] = useState(mode === "lookup");
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const startedRef = useRef(false);

  const ask = async (opts: { question?: string; web?: boolean; reset?: boolean } = {}) => {
    if (demo) {
      setTurns([{ role: "ai", text: DEMO_COPY[mode] }]);
      return;
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setBusy(true);

    const history = opts.reset ? [] : turns;
    setTurns(
      opts.question
        ? [...history, { role: "user", text: opts.question }, { role: "ai", text: "" }]
        : [{ role: "ai", text: "" }]
    );

    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          messageId: message.id,
          mode,
          web: opts.web ?? usedWeb,
          history: opts.question ? history : [],
          question: opts.question,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "Couldn't get an answer.");
      }
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setTurns((t) => {
          const copy = [...t];
          copy[copy.length - 1] = { role: "ai", text: copy[copy.length - 1].text + chunk };
          return copy;
        });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  // Fire once on open. StrictMode double-invokes effects in dev, and this one
  // costs money, so it's guarded rather than keyed on a dependency.
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    ask();
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const answer = turns.filter((t) => t.role === "ai").at(-1)?.text ?? "";

  const copy = () => {
    // Strip the markup on the way out — this text is headed for a message box,
    // which will show "**birthday**" literally.
    navigator.clipboard.writeText(toPlainText(answer));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  // Keep the card fully on screen. This has to account for the card's real
  // maximum height, not a guess: the messages people right-click are usually
  // the recent ones at the bottom of the thread, so clamping too low clips the
  // follow-up box off the bottom of the window exactly when it's most used.
  const maxHeight = Math.min(420, window.innerHeight * 0.7);
  const left = Math.max(8, Math.min(x, window.innerWidth - WIDTH - 8));
  const top = Math.max(8, Math.min(y, window.innerHeight - maxHeight - 12));

  return (
    <>
      <div className="fixed inset-0 z-50" onClick={onClose} />
      <div
        className="fixed z-50 flex max-h-[min(420px,70vh)] flex-col overflow-hidden rounded-2xl border bg-background shadow-xl"
        style={{ left, top, width: WIDTH }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2">
          <Sparkles className="size-3.5 shrink-0 text-[#0a84ff]" />
          <span className="flex-1 truncate text-[12.5px] font-medium">{TITLE[mode]}</span>
          {usedWeb && (
            <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-muted-foreground">
              <Globe className="size-3" />
              web
            </span>
          )}
        </div>

        <div ref={bodyRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-3 py-2.5">
          <p className="border-l-2 border-black/10 pl-2 text-[12px] leading-snug text-muted-foreground italic dark:border-white/15">
            {message.text.length > 130 ? `${message.text.slice(0, 130)}…` : message.text}
          </p>

          {turns.map((t, i) =>
            t.role === "user" ? (
              <p key={i} className="text-right text-[12.5px] font-medium text-[#0a84ff]">
                {t.text}
              </p>
            ) : (
              <div key={i} className="text-[13.5px] leading-relaxed">
                {t.text ? (
                  <Markdown text={t.text} />
                ) : (
                  (busy && i === turns.length - 1 ? (
                    <span className="inline-flex gap-1 py-1">
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:0ms]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:120ms]" />
                      <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 [animation-delay:240ms]" />
                    </span>
                  ) : (
                    ""
                  ))
                )}
              </div>
            )
          )}

          {error && <p className="text-[12.5px] text-red-500">{error}</p>}
        </div>

        <div className="shrink-0 border-t">
          {/* The one action that costs meaningfully more, so it's never automatic. */}
          {!usedWeb && !busy && !demo && (
            <button
              onClick={() => {
                setUsedWeb(true);
                ask({ web: true, reset: true });
              }}
              className="flex w-full items-center gap-2 border-b px-3 py-2 text-left text-[12.5px] hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
            >
              <Globe className="size-3.5 text-muted-foreground" />
              Search the web
            </button>
          )}
          <form
            className={cn("flex items-center gap-1.5 p-2", demo && "hidden")}
            onSubmit={(e) => {
              e.preventDefault();
              const q = followUp.trim();
              if (!q || busy) return;
              setFollowUp("");
              ask({ question: q });
            }}
          >
            <Input
              value={followUp}
              onChange={(e) => setFollowUp(e.target.value)}
              placeholder="Ask a follow-up…"
              className="h-8 rounded-full border-none bg-black/[0.06] text-[12.5px] shadow-none dark:bg-white/10"
            />
            {busy ? (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                onClick={() => abortRef.current?.abort()}
                aria-label="Stop"
                className="size-8 shrink-0"
              >
                <CircleStop className="size-4 text-[#0a84ff]" />
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon"
                disabled={!followUp.trim()}
                aria-label="Send follow-up"
                className="size-8 shrink-0 rounded-full bg-[#0a84ff] hover:bg-[#0974df]"
              >
                <Send className="size-3.5" />
              </Button>
            )}
          </form>
          <div className="flex items-center justify-between gap-2 border-t px-2 py-1.5">
            <button
              onClick={copy}
              disabled={!answer}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground disabled:opacity-40",
                copied && "text-[#0a84ff]"
              )}
            >
              <Copy className="size-3" />
              {copied ? "Copied" : mode === "reply" ? "Copy reply" : "Copy"}
            </button>
            <button
              onClick={() => {
                onClose();
                onOpenPanel();
              }}
              className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11.5px] text-muted-foreground hover:text-foreground"
            >
              Continue in panel
              <ArrowRight className="size-3" />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
