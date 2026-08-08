"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BookOpenCheck,
  Check,
  ChevronDown,
  CircleStop,
  RefreshCw,
  MessageSquarePlus,
  Pencil,
  Send,
  Sparkles,
  X,
  Trash2,
} from "lucide-react";
import type { AppStatus } from "@/lib/types";
import {
  createConversation,
  deleteConversation as deleteConversationApi,
  listConversations,
  loadConversation,
  renameConversation as renameConversationApi,
  type AiConversation,
} from "@/lib/ai-threads";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { registerPasteTarget, type Pasted } from "@/lib/clipboard-image";
import { Markdown } from "@/components/markdown";

type Entry = { role: "user" | "ai"; text: string };
type JobState = { running: boolean; done: number; total: number; error?: string } | null;
type EmbedState = {
  embedded: boolean;
  available: boolean;
  count: number;
  job: JobState;
};
export function AiPanel({
  threadId,
  threadName,
  status,
}: {
  threadId: string;
  threadName: string;
  status: AppStatus | null;
}) {
  const demo = status?.mode === "demo";
  const registered = !!status?.ai?.configured;
  const [code, setCode] = useState("");
  const [redeeming, setRedeeming] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const redeem = async () => {
    const value = code.trim();
    if (!value) return;
    setRedeeming(true);
    setCodeError(null);
    try {
      const res = await fetch("/api/ai/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Couldn't check that code.");
      // The status poll in the app shell picks the change up; reload so every
      // AI surface unlocks at once.
      window.location.reload();
    } catch (e) {
      setCodeError((e as Error).message);
    } finally {
      setRedeeming(false);
    }
  };
  const [entries, setEntries] = useState<Entry[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<AiConversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [embed, setEmbed] = useState<EmbedState | null>(null);
  const [job, setJob] = useState<JobState>(null);
  const [image, setImage] = useState<Pasted | null>(null);
  // The conversation whose answer is being generated right now, or null.
  // Generation lives on the server, so this is a subscription, not ownership.
  const [watching, setWatching] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** If an answer for this chat is still being generated on the server, pick
   *  it back up. This is what makes leaving the panel mid-question safe: the
   *  work never belonged to the panel, so there is something to return to. */
  const resume = useCallback(async (convId: string) => {
    try {
      const s = (await fetch(`/api/ai?key=${encodeURIComponent(convId)}`, {
        cache: "no-store",
      }).then((r) => r.json())) as { running: boolean; text: string; prompt?: string };
      if (!s.running) return;
      setEntries((e) => [
        ...e,
        ...(s.prompt ? [{ role: "user" as const, text: s.prompt }] : []),
        { role: "ai" as const, text: s.text ?? "" },
      ]);
      setBusy(true);
      setWatching(convId);
    } catch {
      // nothing in flight, or the server restarted — the vault has the rest
    }
  }, []);

  // Open the thread's most recent AI chat. Chats are per iMessage thread and
  // live in ~/.sidenote/vault.db, so switching away and back keeps them.
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    // Stop following, but leave the answer generating — it finishes and saves
    // itself, and is here when you come back.
    setWatching(null);
    setBusy(false);
    setError(null);
    setEntries([]);
    setCurrentId(null);
    setPickerOpen(false);
    setJob(null);
    setImage(null);
    (async () => {
      try {
        const list = await listConversations(threadId);
        if (cancelled) return;
        setConversations(list);
        if (list.length) {
          const { messages } = await loadConversation(list[0].id);
          if (cancelled) return;
          setCurrentId(list[0].id);
          setEntries(messages.map((m) => ({ role: m.role, text: m.text })));
          void resume(list[0].id);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
      try {
        const c = (await fetch(
          `/api/catchup?threadId=${encodeURIComponent(threadId)}`
        ).then((r) => r.json())) as EmbedState;
        if (cancelled) return;
        setEmbed(c);
        // An embed started earlier may still be running — pick the progress
        // back up rather than pretending nothing is happening.
        if (c.job?.running) setJob(c.job);
      } catch {
        // embedding is optional — questions still work without it
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [threadId, demo, resume]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries]);

  const openConversation = useCallback(async (id: string) => {
    setWatching(null);
    setBusy(false);
    setPickerOpen(false);
    setError(null);
    try {
      const { messages } = await loadConversation(id);
      setCurrentId(id);
      setEntries(messages.map((m) => ({ role: m.role, text: m.text })));
      void resume(id);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [resume]);

  const startNewChat = useCallback(() => {
    setWatching(null);
    setBusy(false);
    setPickerOpen(false);
    setError(null);
    // Created lazily on the first question, so empty chats never pile up.
    setCurrentId(null);
    setEntries([]);
  }, []);

  const removeConversation = async (id: string) => {
    try {
      await deleteConversationApi(id);
      const list = await listConversations(threadId);
      setConversations(list);
      if (id !== currentId) return;
      if (list.length) {
        await openConversation(list[0].id);
      } else {
        setCurrentId(null);
        setEntries([]);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const rename = async (id: string, title: string) => {
    try {
      await renameConversationApi(id, title);
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, title } : c)));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Starts the embed as a background job on the server and follows it by
  // polling. The work is no longer tied to this component being mounted, so
  // closing the AI panel — or switching threads — leaves it running.
  const startEmbed = async () => {
    setError(null);
    setJob({ running: true, done: 0, total: embed?.count ?? 0 });
    try {
      const res = await fetch("/api/catchup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId }),
      });
      if (!res.ok) throw new Error("Couldn't start embedding.");
    } catch (e) {
      setError((e as Error).message);
      setJob(null);
    }
  };

  // Poll while a job is running for the thread on screen.
  useEffect(() => {
    if (!job?.running) return;
    let alive = true;
    const tick = async () => {
      try {
        const c = (await fetch(
          `/api/catchup?threadId=${encodeURIComponent(threadId)}`
        ).then((r) => r.json())) as EmbedState;
        if (!alive) return;
        setEmbed(c);
        setJob(c.job);
        if (c.job?.error) setError(c.job.error);
        if (!c.job?.running && c.embedded) {
          window.dispatchEvent(new Event("sidenote:caught-up"));
        }
      } catch {
        // transient — next tick
      }
    };
    const t = setInterval(tick, 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [job?.running, threadId]);

  // Paste a screenshot anywhere in this panel to ask about it. Registered
  // second so it wins over the message composer while focus is in here.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (demo) return;
    return registerPasteTarget({
      container: () => panelRef.current,
      onImage: setImage,
      onError: setError,
    });
  }, [demo]);

  const run = async (mode: "summarize" | "ask", q?: string) => {
    if (busy) return;
    const attached = image;
    setImage(null);
    setError(null);
    setBusy(true);

    // Give the exchange a home before it starts, so the server can write the
    // answer straight into the vault as it finishes.
    let conversationId = currentId;
    if (!conversationId) {
      try {
        const conv = await createConversation(threadId);
        conversationId = conv.id;
        setCurrentId(conv.id);
        setConversations((list) => [conv, ...list]);
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
        return;
      }
    }

    setEntries((e) => [
      ...e,
      {
        role: "user",
        text: mode === "summarize" ? `Summarize my conversation with ${threadName}` : q!,
      },
      { role: "ai", text: "" },
    ]);
    try {
      const res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          mode,
          question: q,
          conversationId,
          ...(attached ? { image: { data: attached.data, mime: attached.mime } } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error ?? "AI request failed.");
      }
      // The answer is generated server-side and survives this panel closing;
      // watching it is just polling for how far it has got.
      setWatching(conversationId);
    } catch (e) {
      setError((e as Error).message);
      setEntries((en) => (en[en.length - 1]?.text === "" ? en.slice(0, -2) : en));
      setBusy(false);
    }
  };

  // Follow an answer that is being generated. Mounting with a job already in
  // flight picks it back up, which is what makes leaving the panel — or the
  // thread — safe mid-question.
  useEffect(() => {
    if (!watching) return;
    let alive = true;
    const tick = async () => {
      try {
        const s = (await fetch(`/api/ai?key=${encodeURIComponent(watching)}`, {
          cache: "no-store",
        }).then((r) => r.json())) as {
          running: boolean;
          text: string;
          error?: string;
          missing?: boolean;
        };
        if (!alive) return;
        if (s.text) {
          setEntries((e) => {
            const copy = [...e];
            if (copy[copy.length - 1]?.role === "ai") {
              copy[copy.length - 1] = { role: "ai", text: s.text };
            }
            return copy;
          });
        }
        if (!s.running) {
          if (s.error) setError(s.error);
          setBusy(false);
          setWatching(null);
          // The server retitled and reordered this chat as it saved.
          listConversations(threadId).then(setConversations).catch(() => {});
        }
      } catch {
        // transient — next tick
      }
    };
    void tick();
    const t = setInterval(tick, 350);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [watching, threadId]);

  // ---------- not registered yet ----------
  if (!demo && !registered) {
    return (
      <SetupShell
        title="Turn on AI"
        body="Enter the invite code you were given. One time, then AI works everywhere in Sidenote."
      >
        <div className="mt-1 flex w-full max-w-[260px] items-center gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") redeem();
            }}
            placeholder="Invite code"
            autoComplete="off"
            spellCheck={false}
            className="h-9 flex-1 text-[13px]"
          />
          <Button
            size="sm"
            onClick={redeem}
            disabled={redeeming || !code.trim()}
            className="h-9 shrink-0 rounded-lg bg-[#0a84ff] text-[12.5px] hover:bg-[#0974df]"
          >
            {redeeming ? <RefreshCw className="size-3.5 animate-spin" /> : "Turn on"}
          </Button>
        </div>
        {codeError && <p className="text-[12.5px] text-red-500">{codeError}</p>}
      </SetupShell>
    );
  }

  // ---------- demo mode ----------
  if (demo) {
    return (
      <SetupShell
        title="Ask about any conversation"
        body="On your Mac, Sidenote answers questions about a thread by searching its whole history — years of it — and right-clicking any message explains what it means."
      />
    );
  }

  const current = conversations.find((c) => c.id === currentId) ?? null;

  // ---------- ready ----------
  return (
    <div ref={panelRef} className="flex h-full flex-col">
      {/* chat switcher */}
      <div className="relative flex shrink-0 items-center gap-1 border-b px-2 py-2">
        <button
          onClick={() => setPickerOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 py-1 text-left hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
          title="Switch between AI chats for this conversation"
        >
          <span className="truncate text-[13px] font-medium">
            {current?.title ?? "New chat"}
          </span>
          {conversations.length > 0 && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {conversations.length}
            </span>
          )}
          <ChevronDown
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              pickerOpen && "rotate-180"
            )}
          />
        </button>
        <Button
          size="icon"
          variant="ghost"
          onClick={startNewChat}
          aria-label="New chat"
          title="Start another chat about this thread"
          className="size-8 shrink-0"
        >
          <MessageSquarePlus className="size-4" />
        </Button>

        {pickerOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
            <div className="absolute top-full left-2 z-50 mt-1 max-h-72 w-[calc(100%-1rem)] overflow-y-auto rounded-xl border bg-background py-1 shadow-lg">
              {conversations.length === 0 ? (
                <p className="px-3 py-2 text-[12.5px] text-muted-foreground">
                  No saved chats yet. Ask something and it&apos;s kept here.
                </p>
              ) : (
                conversations.map((c) => (
                  <ConversationRow
                    key={c.id}
                    conversation={c}
                    active={c.id === currentId}
                    onOpen={() => openConversation(c.id)}
                    onRename={(title) => rename(c.id, title)}
                    onDelete={() => removeConversation(c.id)}
                  />
                ))
              )}
              <button
                onClick={startNewChat}
                className="mt-1 flex w-full items-center gap-2 border-t px-3 py-2 text-left text-[13px] text-[#0a84ff] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
              >
                <MessageSquarePlus className="size-3.5" />
                New chat
              </button>
            </div>
          </>
        )}
      </div>

      {/* embed this conversation */}
      {embed?.available && !embed.embedded && (
        <div className="shrink-0 border-b bg-black/[0.02] px-4 py-2.5 dark:bg-white/[0.03]">
          {job?.running ? (
            <>
              <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-[#0a84ff] transition-all duration-300"
                  style={{
                    width: `${job.total ? Math.round((job.done / job.total) * 100) : 0}%`,
                  }}
                />
              </div>
              <p className="mt-1.5 text-[12px] text-muted-foreground">
                Embedding… {job.done.toLocaleString()} of {job.total.toLocaleString()} messages —
                keeps going if you close this panel
              </p>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[12px] leading-snug text-muted-foreground">
                Embed this conversation so questions can find things by meaning,
                not just wording.
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={startEmbed}
                className="h-7 shrink-0 rounded-lg text-[12px]"
              >
                Embed convo
              </Button>
            </div>
          )}
        </div>
      )}
      {embed?.embedded && !job?.running && (
        <div className="flex shrink-0 items-center gap-1.5 border-b px-4 py-1.5 text-[11.5px] text-muted-foreground">
          <BookOpenCheck className="size-3.5 text-[#0a84ff]" />
          Conversation embedded
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
        {entries.length === 0 ? (
          <div className="pt-6 text-center">
            <p className="text-sm font-semibold">Ask about this thread</p>
            <p className="mx-auto mt-1 max-w-[30ch] text-[13px] text-muted-foreground">
              Questions search this conversation&apos;s entire history — every
              message, however far back.
            </p>
            <Button
              size="sm"
              className="mt-4 rounded-full bg-[#0a84ff] hover:bg-[#0974df]"
              onClick={() => run("summarize")}
            >
              <Sparkles className="mr-1.5 size-3.5" />
              Summarize this thread
            </Button>
            <div className="mx-auto mt-5 max-w-[32ch] space-y-1.5">
              {["What plans did we make?", "What should I remember about them?"].map((s) => (
                <button
                  key={s}
                  onClick={() => run("ask", s)}
                  className="block w-full rounded-lg border px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((e, i) => (
            <div key={i} className={cn("flex", e.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[90%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-relaxed",
                  // The user's own question is literal text; only the answer
                  // comes back as markdown.
                  e.role === "user"
                    ? "bg-[#0a84ff] whitespace-pre-wrap text-white"
                    : "bg-black/[0.05] dark:bg-white/[0.08]"
                )}
              >
                {e.text ? (
                  e.role === "ai" ? (
                    <Markdown text={e.text} />
                  ) : (
                    e.text
                  )
                ) : (
                  (busy && i === entries.length - 1 ? (
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
            </div>
          ))
        )}
        {error && <p className="text-center text-[13px] text-red-500">{error}</p>}
      </div>
      {image && (
        <div className="flex shrink-0 items-center gap-2 border-t px-3 pt-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.url}
            alt="Pasted screenshot"
            className="h-12 w-auto rounded-lg border object-cover"
          />
          <span className="flex-1 text-[12px] text-muted-foreground">
            Screenshot attached — ask about it below
          </span>
          <button
            onClick={() => setImage(null)}
            aria-label="Remove screenshot"
            className="rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <form
        className="flex shrink-0 items-center gap-2 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const q = question.trim();
          if (!q && !image) return;
          setQuestion("");
          run("ask", q || "What is this?");
        }}
      >
        <Input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={`Ask about ${threadName}…`}
          disabled={busy}
          className="h-9 rounded-full border-none bg-black/[0.06] shadow-none dark:bg-white/10"
        />
        {busy ? (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={() => {
              if (watching) {
                void fetch(`/api/ai?key=${encodeURIComponent(watching)}`, {
                  method: "DELETE",
                }).catch(() => {});
              }
            }}
            aria-label="Stop"
          >
            <CircleStop className="size-5 text-[#0a84ff]" />
          </Button>
        ) : (
          <Button
            type="submit"
            size="icon"
            disabled={!question.trim() && !image}
            className="rounded-full bg-[#0a84ff] hover:bg-[#0974df]"
            aria-label="Send"
          >
            <Send className="size-4" />
          </Button>
        )}
      </form>
    </div>
  );
}

function ConversationRow({
  conversation,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  conversation: AiConversation;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(conversation.title);

  const commit = () => {
    const title = draft.trim();
    setEditing(false);
    if (title && title !== conversation.title) onRename(title);
    else setDraft(conversation.title);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 px-2 py-1">
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setDraft(conversation.title);
              setEditing(false);
            }
          }}
          className="h-7 text-[13px]"
        />
        <button
          onClick={commit}
          aria-label="Save name"
          className="shrink-0 rounded p-1 text-[#0a84ff] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
        >
          <Check className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-1 px-1",
        active && "bg-black/[0.04] dark:bg-white/[0.06]"
      )}
    >
      <button
        onClick={onOpen}
        className="min-w-0 flex-1 truncate px-2 py-2 text-left text-[13px]"
        title={conversation.title}
      >
        {conversation.title}
      </button>
      <button
        onClick={() => setEditing(true)}
        aria-label="Rename chat"
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
      >
        <Pencil className="size-3.5" />
      </button>
      <button
        onClick={onDelete}
        aria-label="Delete chat"
        className="mr-1 shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  );
}

function SetupShell({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl bg-[#0a84ff]/10">
        <Sparkles className="size-6 text-[#0a84ff]" />
      </div>
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-[30ch] text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      {children}
    </div>
  );
}
