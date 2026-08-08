"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpCircle,
  ChevronLeft,
  MessageCircleHeart,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import type { AppStatus, Thread, UpdateInfo } from "@/lib/types";
import { ThreadList } from "@/components/thread-list";
import { ThreadView } from "@/components/thread-view";
import { NotesPanel } from "@/components/notes-panel";
import { AiPanel } from "@/components/ai-panel";
import { SettingsDialog } from "@/components/settings-dialog";
import { FdaGuide } from "@/components/fda-guide";
import { importLegacyNotes } from "@/lib/notes";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export function SidenoteApp() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncPermission, setSyncPermission] = useState(false);
  const [fdaOpen, setFdaOpen] = useState(false);
  const [active, setActive] = useState<{ threadId: string; messageId: number | null } | null>(null);
  const [panel, setPanel] = useState<"notes" | "ai">("notes");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updating, setUpdating] = useState(false);
  // The sha whose update banner has been dismissed. A new release writes a
  // different sha, so the banner returns once per version instead of nagging.
  const [dismissed, setDismissed] = useState<string | null>(null);
  // Which threads have been embedded, for the sidebar badge.
  const [caughtUp, setCaughtUp] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([
        fetch("/api/status").then((r) => r.json()),
        fetch("/api/threads").then((r) => r.json()),
      ]);
      setStatus(s);
      setThreads(t.threads ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Finish the Full Disk Access flow: after the guide restarts the server,
  // sync kicks off on its own so the user never has to know to re-click it.
  useEffect(() => {
    if (status?.mode === "local" && localStorage.getItem("sidenote-fda-resync")) {
      localStorage.removeItem("sidenote-fda-resync");
      sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  // Rescue notes from the era when they lived in localStorage, before the
  // vault existed. No-op after the first successful run.
  useEffect(() => {
    if (status?.mode !== "local") return;
    importLegacyNotes().catch(() => {
      // nothing lost — the sweep retries on the next launch
    });
  }, [status?.mode]);

  // Live mode: keep the sidebar fresh as new texts sync in the background.
  useEffect(() => {
    if (status?.mode !== "local" || !status.synced) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      try {
        const s = (await fetch("/api/status").then((r) => r.json())) as AppStatus;
        if (s.lastSync !== status.lastSync) {
          setStatus(s);
          const tr = await fetch("/api/threads").then((r) => r.json());
          setThreads(tr.threads ?? []);
        }
      } catch {
        // transient — next tick
      }
    }, 10000);
    return () => clearInterval(t);
  }, [status?.mode, status?.synced, status?.lastSync]);

  useEffect(() => {
    if (status?.mode !== "local") return;
    fetch("/api/catchup")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setCaughtUp(new Set(d.threads ?? [])))
      .catch(() => {});
    fetch("/api/update/dismiss")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDismissed(d.dismissed))
      .catch(() => {});
  }, [status?.mode]);

  // Watch for a newer Sidenote (local installs only). This used to run once at
  // app load, which meant a copy left open all day never noticed a release —
  // the banner only appeared after a restart, or after hitting Check in
  // Settings. Sidenote is an app people leave running, so it re-checks on a
  // timer. The route caches for ten minutes, so the half-hour tick costs at
  // most one small request an hour.
  useEffect(() => {
    if (status?.mode !== "local") return;
    let alive = true;
    const look = () =>
      fetch("/api/update")
        .then((r) => (r.ok ? r.json() : null))
        .then((u: UpdateInfo | null) => {
          if (alive && u) setUpdate(u);
        })
        .catch(() => {});
    look();
    const t = setInterval(look, 30 * 60_000);
    // Coming back to a window that has been in the background for hours is the
    // moment a stale version is most likely, and most worth saying so.
    const onFocus = () => look();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener("focus", onFocus);
    };
  }, [status?.mode]);

  // A thread finishing its catch-up badges immediately in the sidebar.
  useEffect(() => {
    const reload = () =>
      fetch("/api/catchup")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setCaughtUp(new Set(d.threads ?? [])))
        .catch(() => {});
    window.addEventListener("sidenote:caught-up", reload);
    return () => window.removeEventListener("sidenote:caught-up", reload);
  }, []);

  const checkForUpdate = async () => {
    const u = await fetch("/api/update?fresh=1")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    if (u) setUpdate(u);
    return u as UpdateInfo | null;
  };

  const applyUpdate = async () => {
    if (updating) return;
    setUpdating(true);
    const res = await fetch("/api/update", { method: "POST" })
      .then((r) => r.json())
      .catch(() => null);
    if (!res?.ok) {
      setUpdating(false);
      setSyncError(
        res?.error === "notfound"
          ? "Couldn't find Sidenote on disk to update."
          : `Couldn't install the update${res?.error ? ` — ${res.error}` : ""}. Download it from sidenote.lol instead.`
      );
      return;
    }
    // The .app path replaces the bundle and relaunches, which means this
    // process is about to be killed. There is nothing to poll for — the new
    // copy comes up on its own.
    if (res.relaunching) return;
    // Pull + rebuild + relaunch runs in the background; when the server
    // comes back on the new commit, reload into it.
    const target = update?.latest;
    for (;;) {
      await new Promise((r) => setTimeout(r, 8000));
      try {
        const u = (await fetch("/api/update", { cache: "no-store" }).then((r) =>
          r.json()
        )) as UpdateInfo;
        if (u.current && (!target || u.current === target)) {
          location.reload();
          return;
        }
      } catch {
        // server mid-restart — keep waiting
      }
    }
  };

  const sync = async () => {
    setSyncing(true);
    setSyncError(null);
    setSyncPermission(false);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSyncPermission(!!data.permission);
        throw new Error(data.error ?? "Sync failed.");
      }
      await refresh();
    } catch (e) {
      setSyncError((e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  const select = (threadId: string, messageId?: number) => {
    setActive({ threadId, messageId: messageId ?? null });
  };

  const activeThread = threads.find((t) => t.id === active?.threadId) ?? null;
  const demo = status?.mode === "demo";
  const needsSetup = !loading && status?.mode === "local" && !status.synced;

  if (needsSetup) {
    return (
      <SetupScreen
        syncing={syncing}
        error={syncError}
        permission={syncPermission}
        engine={status?.engine}
        translocated={status?.translocated}
        onSync={sync}
      />
    );
  }

  return (
    <div className="flex h-dvh overflow-hidden">
      {/* sidebar */}
      <aside
        className={cn(
          "w-full shrink-0 border-r bg-[#f5f5f7] md:w-80 lg:w-[340px] dark:bg-[#1c1c1e]",
          active && "hidden md:block"
        )}
      >
        <div className="flex h-full flex-col">
          {status?.mode === "demo" && (
            <a
              href="/"
              className="flex shrink-0 items-center justify-center gap-1.5 bg-[#0a84ff] px-4 py-1.5 text-center text-[12px] font-medium text-white transition-colors hover:bg-[#0974df]"
            >
              <ChevronLeft className="size-3.5" />
              Back to Sidenote — this is sample data
            </a>
          )}
          {status?.mode === "local" &&
            update?.updateAvailable &&
            update.latest !== dismissed && (
              <div className="flex shrink-0 items-stretch bg-[#0a84ff] text-white">
                <button
                  onClick={applyUpdate}
                  disabled={updating}
                  className="flex flex-1 items-center justify-center gap-1.5 px-4 py-1.5 text-center text-[12px] font-medium transition-colors hover:bg-[#0974df] disabled:opacity-80"
                >
                  {updating ? (
                    <>
                      <RefreshCw className="size-3.5 animate-spin" />
                      {update.app
                        ? "Downloading the new version — Sidenote will restart…"
                        : "Updating — Sidenote will reload itself…"}
                    </>
                  ) : (
                    <>
                      <ArrowUpCircle className="size-3.5" />
                      A newer version of Sidenote is available — install now
                    </>
                  )}
                </button>
                {!updating && (
                  <button
                    onClick={() => {
                      setDismissed(update.latest);
                      fetch("/api/update/dismiss", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ sha: update.latest }),
                      }).catch(() => {});
                    }}
                    aria-label="Dismiss update notice"
                    title="Dismiss until the next version"
                    className="px-2.5 transition-colors hover:bg-[#0974df]"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
          {syncError && (
            <div className="shrink-0 bg-amber-100 px-4 py-2 text-[12px] leading-snug text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              {syncError}
              {syncPermission && (
                <>
                  {" "}
                  <button
                    onClick={() => setFdaOpen(true)}
                    className="font-semibold underline underline-offset-2"
                  >
                    Show me how to grant it
                  </button>
                </>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <ThreadList
              status={status}
              threads={threads}
              loading={loading}
              activeId={active?.threadId ?? null}
              syncing={syncing}
              onSync={sync}
              onSelect={select}
              onOpenSettings={() => setSettingsOpen(true)}
            caughtUp={caughtUp}
            />
          </div>
        </div>
      </aside>

      {/* thread */}
      <main className={cn("min-w-0 flex-1", !active && "hidden md:block")}>
        {active ? (
          <ThreadView
            key={`${active.threadId}:${active.messageId ?? "latest"}`}
            threadId={active.threadId}
            initialAnchor={active.messageId}
            canSend={status?.mode === "local"}
            demo={demo}
            onBack={() => setActive(null)}
            onOpenPanel={(tab) => {
              setPanel(tab);
              setSheetOpen(true);
            }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <div className="flex size-16 items-center justify-center rounded-3xl bg-[#0a84ff]/10">
              <MessageCircleHeart className="size-8 text-[#0a84ff]" />
            </div>
            <p className="text-[15px] font-semibold">Pick a conversation</p>
            <p className="max-w-[32ch] text-sm text-muted-foreground">
              Search everything you&apos;ve ever texted, keep notes on the people you care about,
              and ask AI about any thread.
            </p>
          </div>
        )}
      </main>

      {/* notes / AI side sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b px-4 py-3">
            <SheetTitle className="text-[15px]">{activeThread?.name ?? "Conversation"}</SheetTitle>
          </SheetHeader>
          {active && (
            <Tabs value={panel} onValueChange={(v) => setPanel(v as "notes" | "ai")} className="min-h-0 flex-1 gap-0">
              <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2 self-stretch">
                <TabsTrigger value="notes">Notes</TabsTrigger>
                <TabsTrigger value="ai">Ask AI</TabsTrigger>
              </TabsList>
              <TabsContent value="notes" className="min-h-0 flex-1">
                <NotesPanel
                  threadId={active.threadId}
                  threadName={activeThread?.name ?? ""}
                  demo={demo}
                  onJump={(messageId) => {
                    setSheetOpen(false);
                    select(active.threadId, messageId);
                  }}
                />
              </TabsContent>
              <TabsContent value="ai" className="min-h-0 flex-1">
                <AiPanel
                  threadId={active.threadId}
                  threadName={activeThread?.name ?? "this chat"}
                  status={status}
                />
              </TabsContent>
            </Tabs>
          )}
        </SheetContent>
      </Sheet>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        status={status}
        update={update}
        updating={updating}
        onUpdate={applyUpdate}
        onCheckUpdate={checkForUpdate}
      />

      <Dialog open={fdaOpen} onOpenChange={setFdaOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[15px]">Grant Full Disk Access</DialogTitle>
            <DialogDescription className="sr-only">
              Steps to let Sidenote read your Messages.
            </DialogDescription>
          </DialogHeader>
          <FdaGuide engine={status?.engine} translocated={status?.translocated} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SetupScreen({
  syncing,
  error,
  permission,
  engine,
  translocated,
  onSync,
}: {
  syncing: boolean;
  error: string | null;
  permission: boolean;
  engine?: string;
  translocated?: boolean;
  onSync: () => void;
}) {
  return (
    <div className="flex h-dvh items-center justify-center bg-[#f5f5f7] p-6 dark:bg-[#1c1c1e]">
      <div className="w-full max-w-md rounded-3xl border bg-background p-8 shadow-sm">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-[#0a84ff]">
          <MessageCircleHeart className="size-7 text-white" />
        </div>
        <h1 className="mt-5 text-2xl font-bold tracking-tight">Welcome to Sidenote</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground">
          Your iMessage companion. Sidenote copies your Messages history into a private local
          index so you can actually find things — then layers on notes, pins, and AI that
          can explain any message you don't understand.
        </p>
        <ul className="mt-4 space-y-2 text-[13.5px] text-muted-foreground">
          <li className="flex gap-2">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[#0a84ff]" />
            Everything stays on your Mac — nothing is uploaded, ever.
          </li>
          <li className="flex gap-2">
            <RefreshCw className="mt-0.5 size-4 shrink-0 text-[#0a84ff]" />
            Re-sync any time to pull in new messages.
          </li>
        </ul>
        <Button
          onClick={onSync}
          disabled={syncing}
          className="mt-6 h-11 w-full rounded-xl bg-[#0a84ff] text-[15px] hover:bg-[#0974df]"
        >
          {syncing ? (
            <>
              <RefreshCw className="mr-2 size-4 animate-spin" /> Syncing your Messages…
            </>
          ) : (
            "Sync your Messages"
          )}
        </Button>
        {error && !permission && (
          <div className="mt-4 rounded-xl bg-amber-50 p-3 text-[13px] leading-relaxed text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            {error}
          </div>
        )}
        {permission ? (
          <div className="mt-4">
            <FdaGuide engine={engine} translocated={translocated} />
          </div>
        ) : (
          <p className="mt-4 text-[12px] leading-relaxed text-muted-foreground">
            First sync needs one macOS permission (
            <span className="font-medium text-foreground">Full Disk Access</span>
            ). If it&apos;s missing, Sidenote will walk you through granting it —
            two steps, one time. The grant is to Sidenote on this Mac, not to a server.
          </p>
        )}
      </div>
    </div>
  );
}
