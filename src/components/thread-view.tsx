"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BookmarkPlus,
  Check,
  ChevronLeft,
  Copy,
  FileDown,
  Globe,
  NotebookPen,
  Paperclip,
  Reply,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import type { Message, SearchResult, Thread } from "@/lib/types";
import { formatListDate, formatSeparator } from "@/lib/format";
import { saveMessage } from "@/lib/notes";
import { ExplainPopover, type ExplainMode } from "@/components/explain-popover";
import { registerPasteTarget, type Pasted } from "@/lib/clipboard-image";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AvatarBadge } from "@/components/avatar-badge";
import { Snippet } from "@/components/thread-list";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const GAP_FOR_SEPARATOR = 3600_000; // 1h

export function ThreadView({
  threadId,
  initialAnchor,
  canSend,
  demo,
  onBack,
  onOpenPanel,
}: {
  threadId: string;
  initialAnchor: number | null;
  canSend: boolean;
  demo: boolean;
  onBack: () => void;
  onOpenPanel: (tab: "notes" | "ai") => void;
}) {
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasEarlier, setHasEarlier] = useState(false);
  const [hasLater, setHasLater] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anchor, setAnchor] = useState<number | null>(initialAnchor);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; m: Message } | null>(null);
  const [explain, setExplain] = useState<{
    m: Message;
    mode: ExplainMode;
    x: number;
    y: number;
  } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<{ text: string; at: number }[]>([]);
  // A screenshot pasted into the composer, sent as an iMessage attachment.
  const [outgoing, setOutgoing] = useState<Pasted | null>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pendingScroll = useRef<"bottom" | number | null>("bottom");
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFlash = (text: string) => {
    setFlash(text);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(null), 2200);
  };

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", close);
    };
  }, [menu]);

  useEffect(() => {
    setAnchor(initialAnchor);
    setSearchOpen(false);
    setSearchQ("");
    setSearchResults(null);
  }, [threadId, initialAnchor]);

  const load = useCallback(
    async (around: number | null) => {
      setLoading(true);
      setError(null);
      try {
        const url = `/api/threads/${encodeURIComponent(threadId)}/messages${
          around ? `?around=${around}` : ""
        }`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("Couldn't load this conversation.");
        const data = await res.json();
        setThread(data.thread);
        setMessages(data.messages);
        setHasEarlier(data.hasEarlier);
        setHasLater(data.hasLater);
        pendingScroll.current = around ?? "bottom";
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [threadId]
  );

  useEffect(() => {
    load(anchor);
  }, [load, anchor]);

  // Live mode: while viewing the latest page, quietly refresh so incoming
  // texts appear on their own.
  useEffect(() => {
    if (!canSend || anchor !== null) return;
    const t = setInterval(async () => {
      if (document.hidden || loading) return;
      try {
        const res = await fetch(`/api/threads/${encodeURIComponent(threadId)}/messages`);
        if (!res.ok) return;
        const data = await res.json();
        const incoming = data.messages as Message[];
        setThread(data.thread);
        // drop optimistic bubbles once the real message lands (or times out)
        setPending((p) =>
          p.filter(
            (pm) =>
              !incoming.some((m) => m.isFromMe && m.text === pm.text) &&
              Date.now() - pm.at < 30000
          )
        );
        setMessages((prev) => {
          const prevLast = prev[prev.length - 1]?.id;
          const nextLast = incoming[incoming.length - 1]?.id;
          if (prevLast === nextLast && prev.length >= incoming.length) return prev;
          const el = scrollRef.current;
          if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
            pendingScroll.current = "bottom";
          }
          return incoming;
        });
      } catch {
        // transient — try again next tick
      }
    }, 5000);
    return () => clearInterval(t);
  }, [canSend, anchor, threadId, loading]);

  useEffect(() => setPending([]), [threadId]);
  useEffect(() => setOutgoing(null), [threadId]);

  // Paste a screenshot anywhere in the thread and it attaches to the composer.
  useEffect(() => {
    if (!canSend) return;
    return registerPasteTarget({
      container: () => composerRef.current,
      onImage: setOutgoing,
      onError: showFlash,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canSend]);

  const send = async () => {
    const text = draft.trim();
    const image = outgoing;
    if ((!text && !image) || sending) return;
    setSending(true);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          threadId,
          text,
          ...(image ? { image: { data: image.data, mime: image.mime } } : {}),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't send.");
      setDraft("");
      setOutgoing(null);
      if (text) setPending((p) => [...p, { text, at: Date.now() }]);
      pendingScroll.current = "bottom";
      setMessages((m) => [...m]); // trigger scroll
    } catch (e) {
      showFlash((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  // scroll into place after messages render
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || pendingScroll.current === null || loading) return;
    if (pendingScroll.current === "bottom") {
      el.scrollTop = el.scrollHeight;
    } else {
      const target = el.querySelector(`[data-mid="${pendingScroll.current}"]`);
      target?.scrollIntoView({ block: "center" });
    }
    pendingScroll.current = null;
  }, [messages, loading]);

  const loadEarlier = async () => {
    if (messages.length === 0 || loadingEarlier) return;
    setLoadingEarlier(true);
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    try {
      const res = await fetch(
        `/api/threads/${encodeURIComponent(threadId)}/messages?before=${messages[0].date}`
      );
      const data = await res.json();
      setMessages((m) => [...data.messages, ...m]);
      setHasEarlier(data.hasEarlier);
      requestAnimationFrame(() => {
        if (el) el.scrollTop += el.scrollHeight - prevHeight;
      });
    } finally {
      setLoadingEarlier(false);
    }
  };

  // in-thread search
  useEffect(() => {
    const q = searchQ.trim();
    if (!q) {
      setSearchResults(null);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q)}&threadId=${encodeURIComponent(threadId)}`
      );
      const data = await res.json();
      setSearchResults(data.results ?? []);
    }, 250);
    return () => clearTimeout(t);
  }, [searchQ, threadId]);

  const jumpTo = (id: number) => {
    setSearchOpen(false);
    setSearchQ("");
    setSearchResults(null);
    if (messages.some((m) => m.id === id)) {
      pendingScroll.current = id;
      setMessages((m) => [...m]); // trigger the scroll effect
      setAnchor(id);
    } else {
      setAnchor(id);
    }
  };

  // "Read" shows under your most recent sent message, iMessage-style
  let lastMineId: number | null = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].isFromMe) {
      lastMineId = messages[i].id;
      break;
    }
  }

  return (
    <div className="relative flex h-full min-w-0 flex-1 flex-col bg-background">
      {/* header */}
      <div className="z-10 flex shrink-0 items-center gap-2 border-b bg-background/90 px-3 py-2 backdrop-blur">
        <Button variant="ghost" size="icon" className="md:hidden" onClick={onBack} aria-label="Back">
          <ChevronLeft className="size-5" />
        </Button>
        {thread ? (
          <>
            <AvatarBadge name={thread.name} isGroup={thread.isGroup} className="size-9 text-xs" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] leading-tight font-semibold">{thread.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {thread.isGroup
                  ? thread.participants.join(", ")
                  : `${thread.messageCount.toLocaleString()} messages`}
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center gap-2">
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="h-4 w-36" />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSearchOpen((s) => !s)}
          aria-label="Search this conversation"
          className={cn(searchOpen && "bg-black/[0.06] dark:bg-white/10")}
        >
          <Search className="size-4.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setExportOpen(true)}
          aria-label="Export conversation"
        >
          <FileDown className="size-4.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onOpenPanel("notes")} aria-label="Notes">
          <NotebookPen className="size-4.5" />
        </Button>
        <Button variant="ghost" size="icon" onClick={() => onOpenPanel("ai")} aria-label="Ask AI">
          <Sparkles className="size-4.5" />
        </Button>
      </div>

      {/* in-thread search */}
      {searchOpen && (
        <div className="z-10 shrink-0 border-b bg-background px-3 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder={`Search with ${thread?.name ?? "this chat"}`}
              className="h-9 rounded-lg border-none bg-black/[0.06] pl-8 shadow-none dark:bg-white/10"
            />
            <button
              onClick={() => {
                setSearchOpen(false);
                setSearchQ("");
              }}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Close search"
            >
              <X className="size-4" />
            </button>
          </div>
          {searchResults && (
            <div className="mt-2 max-h-64 overflow-y-auto rounded-lg border bg-background shadow-sm">
              {searchResults.length === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                  No matches in this conversation.
                </p>
              ) : (
                searchResults.map((r) => (
                  <button
                    key={r.message.id}
                    onClick={() => jumpTo(r.message.id)}
                    className="block w-full border-b px-3 py-2 text-left last:border-b-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-xs font-medium">
                        {r.message.isFromMe ? "You" : r.message.sender || thread?.name}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatListDate(r.message.date)}
                      </span>
                    </div>
                    <p className="line-clamp-2 text-[13px] text-muted-foreground">
                      <Snippet text={r.snippet} />
                    </p>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="space-y-3 pt-6">
            {[64, 40, 56, 32, 72, 48].map((w, i) => (
              <div key={i} className={cn("flex", i % 2 ? "justify-end" : "justify-start")}>
                <Skeleton className="h-9 rounded-2xl" style={{ width: `${w}%` }} />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="pt-16 text-center">
            <p className="text-sm font-medium">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => load(anchor)}>
              Try again
            </Button>
          </div>
        ) : messages.length === 0 ? (
          <p className="pt-16 text-center text-sm text-muted-foreground">
            No text messages in this conversation.
          </p>
        ) : (
          <>
            {hasEarlier && (
              <div className="pb-3 text-center">
                <Button variant="ghost" size="sm" onClick={loadEarlier} disabled={loadingEarlier} className="text-[13px] text-[#0a84ff]">
                  {loadingEarlier ? "Loading…" : "Load earlier messages"}
                </Button>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const next = messages[i + 1];
              const showSep = !prev || m.date - prev.date > GAP_FOR_SEPARATOR;
              const showSender =
                thread?.isGroup && !m.isFromMe && (showSep || !prev || prev.sender !== m.sender);
              // in group chats the sender's photo sits beside their last bubble in a run
              const showAvatar =
                thread?.isGroup &&
                !m.isFromMe &&
                (!next || next.isFromMe || next.sender !== m.sender);
              const showRead =
                m.id === lastMineId && !!m.dateRead && !hasLater && pending.length === 0;
              return (
                <div key={m.id} data-mid={m.id}>
                  {showSep && (
                    <p className="py-3 text-center text-[11px] font-medium text-muted-foreground">
                      {formatSeparator(m.date)}
                    </p>
                  )}
                  {showSender && (
                    <p className="mb-0.5 ml-9 text-[11px] text-muted-foreground">{m.sender}</p>
                  )}
                  <div className={cn("flex pb-0.5", m.isFromMe ? "justify-end" : "justify-start")}>
                    {thread?.isGroup && !m.isFromMe && (
                      <div className="mr-1.5 flex w-7 shrink-0 items-end">
                        {showAvatar && (
                          <AvatarBadge name={m.sender || "?"} className="size-7 text-[10px]" />
                        )}
                      </div>
                    )}
                    <div
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({
                          x: Math.min(e.clientX, window.innerWidth - 216),
                          y: Math.min(e.clientY, window.innerHeight - 216),
                          m,
                        });
                      }}
                      className={cn(
                        "flex max-w-[78%] flex-col gap-1 md:max-w-[65%]",
                        m.isFromMe ? "items-end" : "items-start"
                      )}
                    >
                      {m.attachments
                        ?.filter((a) => a.mime.startsWith("image/"))
                        .map((a) => (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            key={a.id}
                            src={`/api/attachments/${a.id}`}
                            alt={a.name}
                            loading="lazy"
                            className="max-h-80 max-w-full rounded-2xl border border-black/[0.06] object-contain dark:border-white/10"
                          />
                        ))}
                      {m.attachments
                        ?.filter((a) => !a.mime.startsWith("image/"))
                        .map((a) => (
                          <a
                            key={a.id}
                            href={`/api/attachments/${a.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
                          >
                            <Paperclip className="size-3.5 shrink-0" />
                            <span className="max-w-[24ch] truncate">{a.name}</span>
                          </a>
                        ))}
                      {m.text && (
                        <div
                          className={cn(
                            "rounded-2xl px-3.5 py-1.5 text-[15px] leading-snug whitespace-pre-wrap",
                            m.isFromMe
                              ? "bg-[#0a84ff] text-white"
                              : "bg-[#e9e9eb] text-black dark:bg-[#26262a] dark:text-white",
                            anchor === m.id &&
                              "ring-2 ring-[#ffcc00] ring-offset-2 ring-offset-background"
                          )}
                        >
                          {m.text}
                        </div>
                      )}
                      {firstUrl(m.text) && <LinkPreview url={firstUrl(m.text)!} />}
                    </div>
                  </div>
                  {showRead && (
                    <p className="pt-0.5 pr-1 pb-1 text-right text-[11px] font-medium text-muted-foreground">
                      Read {formatListDate(m.dateRead!)}
                    </p>
                  )}
                </div>
              );
            })}
            {pending.map((p) => (
              <div key={p.at} className="flex justify-end pb-0.5">
                <div className="max-w-[78%] rounded-2xl bg-[#0a84ff]/70 px-3.5 py-1.5 text-[15px] leading-snug whitespace-pre-wrap text-white md:max-w-[65%]">
                  {p.text}
                </div>
              </div>
            ))}
            {hasLater && (
              <div className="sticky bottom-0 pt-2 text-center">
                <Button
                  size="sm"
                  variant="secondary"
                  className="rounded-full shadow-md"
                  onClick={() => setAnchor(null)}
                >
                  <ArrowDown className="mr-1 size-3.5" /> Jump to latest
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* compose */}
      {canSend && (
        <form
          ref={composerRef}
          className="flex shrink-0 flex-col gap-2 border-t bg-background p-3"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          {outgoing && (
            <div className="flex items-center gap-2 self-start rounded-xl border p-1.5 pr-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={outgoing.url}
                alt="Pasted screenshot"
                className="h-14 w-auto rounded-lg object-cover"
              />
              <button
                type="button"
                onClick={() => setOutgoing(null)}
                aria-label="Remove image"
                className="rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={outgoing ? "Add a message…" : `Message ${thread?.name ?? ""}…`}
            disabled={sending}
            className="h-9 rounded-full border-none bg-black/[0.06] shadow-none dark:bg-white/10"
          />
          <Button
            type="submit"
            size="icon"
            disabled={(!draft.trim() && !outgoing) || sending}
            aria-label="Send message"
            className="size-9 shrink-0 rounded-full bg-[#0a84ff] hover:bg-[#0974df]"
          >
            <ArrowUp className="size-4.5" />
          </Button>
          </div>
        </form>
      )}

      {/* right-click menu on a message */}
      {menu && (
        <div
          className="fixed z-50 w-52 overflow-hidden rounded-xl border bg-background py-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          {/* The reason this feature exists: stop copy-pasting a confusing
              text into another app just to find out what it means. */}
          {(
            [
              { mode: "explain" as const, label: "Explain this", Icon: Sparkles },
              { mode: "lookup" as const, label: "Look this up", Icon: Globe },
              { mode: "reply" as const, label: "Help me reply", Icon: Reply },
            ]
          ).map(({ mode, label, Icon }) => (
              <button
                key={mode}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                onClick={() => {
                  setExplain({ m: menu.m, mode, x: menu.x, y: menu.y });
                  setMenu(null);
                }}
              >
              <Icon className="size-4 text-[#0a84ff]" />
              {label}
            </button>
          ))}
          <div className="my-1 border-t" />
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            onClick={async () => {
              const m = menu.m;
              setMenu(null);
              try {
                const fresh = await saveMessage(threadId, m, demo);
                showFlash(fresh ? "Saved — find it in Notes" : "Already saved");
              } catch {
                showFlash("Couldn't save that — try again");
              }
            }}
          >
            <BookmarkPlus className="size-4 text-[#0a84ff]" />
            Remember this
          </button>
          <button
            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13.5px] hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
            onClick={() => {
              navigator.clipboard.writeText(menu.m.text);
              setMenu(null);
              showFlash("Copied");
            }}
          >
            <Copy className="size-4 text-muted-foreground" />
            Copy text
          </button>
        </div>
      )}

      {explain && (
        <ExplainPopover
          threadId={threadId}
          message={explain.m}
          mode={explain.mode}
          x={explain.x}
          y={explain.y}
          demo={demo}
          onClose={() => setExplain(null)}
          onOpenPanel={() => onOpenPanel("ai")}
        />
      )}

      {/* confirmation pill */}
      {flash && (
        <div className="pointer-events-none absolute bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-foreground px-4 py-2 text-[13px] font-medium text-background shadow-lg">
          <Check className="size-3.5" />
          {flash}
        </div>
      )}

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        threadId={threadId}
        threadName={thread?.name ?? "conversation"}
        onDone={showFlash}
      />
    </div>
  );
}

const RANGES = [
  { label: "Last 30 days", days: 30 },
  { label: "Last 3 months", days: 91 },
  { label: "Last year", days: 365 },
  { label: "Everything", days: null as number | null },
];

function ExportDialog({
  open,
  onOpenChange,
  threadId,
  threadName,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  threadId: string;
  threadName: string;
  onDone: (msg: string) => void;
}) {
  const [rangeIdx, setRangeIdx] = useState(1);
  const [busy, setBusy] = useState<"copy" | "download" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchExport = async () => {
    const days = RANGES[rangeIdx].days;
    const since = days ? Date.now() - days * 86400000 : 0;
    const res = await fetch(
      `/api/threads/${encodeURIComponent(threadId)}/export?since=${since}`
    );
    if (!res.ok) throw new Error("Export failed.");
    return (await res.json()) as { text: string; count: number };
  };

  const doCopy = async () => {
    setBusy("copy");
    setError(null);
    try {
      const { text, count } = await fetchExport();
      await navigator.clipboard.writeText(text);
      onOpenChange(false);
      onDone(`Copied ${count.toLocaleString()} messages — paste into any AI`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const doDownload = async () => {
    setBusy("download");
    setError(null);
    try {
      const { text, count } = await fetchExport();
      const blob = new Blob([text], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${threadName.replace(/[^\w -]/g, "")} - Sidenote export.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
      onOpenChange(false);
      onDone(`Downloaded ${count.toLocaleString()} messages`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="text-left">
          <DialogTitle>Export conversation</DialogTitle>
          <DialogDescription className="text-[13px]">
            A plain-text transcript of your chat with {threadName} — ready to paste into ChatGPT,
            Claude, or anywhere else.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              onClick={() => setRangeIdx(i)}
              className={cn(
                "rounded-xl border px-3 py-2 text-[13.5px] font-medium transition-colors",
                i === rangeIdx
                  ? "border-[#0a84ff] bg-[#0a84ff]/10 text-[#0a84ff]"
                  : "hover:bg-black/[0.03] dark:hover:bg-white/[0.05]"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <div className="flex gap-2">
          <Button
            onClick={doCopy}
            disabled={busy !== null}
            className="h-10 flex-1 rounded-xl bg-[#0a84ff] hover:bg-[#0974df]"
          >
            <Copy className="mr-1.5 size-4" />
            {busy === "copy" ? "Copying…" : "Copy for AI"}
          </Button>
          <Button
            onClick={doDownload}
            disabled={busy !== null}
            variant="outline"
            className="h-10 flex-1 rounded-xl"
          >
            <FileDown className="mr-1.5 size-4" />
            {busy === "download" ? "Exporting…" : "Download .txt"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------- link previews ----------

const URL_RE = /https?:\/\/[^\s<>"')\]]+/;
const firstUrl = (text: string): string | null => text.match(URL_RE)?.[0] ?? null;

type Og = {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  site: string;
};
const ogCache = new Map<string, Promise<Og>>();

function fetchOg(url: string): Promise<Og> {
  let p = ogCache.get(url);
  if (!p) {
    p = fetch(`/api/og?url=${encodeURIComponent(url)}`).then((r) => {
      if (!r.ok) throw new Error("no preview");
      return r.json();
    });
    ogCache.set(url, p);
  }
  return p;
}

function LinkPreview({ url }: { url: string }) {
  const [og, setOg] = useState<Og | null>(null);
  useEffect(() => {
    let alive = true;
    fetchOg(url)
      .then((o) => alive && setOg(o))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  if (!og || (!og.title && !og.image)) return null;
  return (
    <a
      href={og.url}
      target="_blank"
      rel="noreferrer"
      className="block max-w-[280px] overflow-hidden rounded-2xl border border-black/[0.08] bg-background text-left transition-shadow hover:shadow-md dark:border-white/10"
    >
      {og.image && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={og.image} alt="" loading="lazy" className="max-h-40 w-full object-cover" />
      )}
      <span className="block px-3 py-2">
        {og.title && (
          <span className="block truncate text-[13px] leading-snug font-medium">{og.title}</span>
        )}
        <span className="block truncate text-[11.5px] text-muted-foreground">{og.site}</span>
      </span>
    </a>
  );
}
