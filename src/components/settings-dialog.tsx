"use client";

import { useState } from "react";
import { ArrowUpCircle, RefreshCw, Sparkles } from "lucide-react";
import type { AppStatus, UpdateInfo } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { AiAccess } from "@/components/ai-access";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

function UpdatesSection({
  update,
  updating,
  onUpdate,
  onCheckUpdate,
}: {
  update: UpdateInfo | null;
  updating: boolean;
  onUpdate?: () => void;
  onCheckUpdate?: () => Promise<UpdateInfo | null>;
}) {
  const [checking, setChecking] = useState(false);
  const [checked, setChecked] = useState(false);

  const checkNow = async () => {
    if (!onCheckUpdate) return;
    setChecking(true);
    try {
      await onCheckUpdate();
      setChecked(true);
    } finally {
      setChecking(false);
    }
  };

  return (
    <section>
      <h3 className="text-[13px] font-semibold">Updates</h3>
      {update?.currentDate && (
        <p className="mt-1 text-[12px] text-muted-foreground">
          Installed version: {update.currentDate}
          {update.current && (
            <span className="font-mono"> · {update.current.slice(0, 7)}</span>
          )}
        </p>
      )}
      {update?.updateAvailable ? (
        <>
          <div className="mt-2.5 rounded-xl border border-[#0a84ff]/25 bg-[#0a84ff]/5 p-3">
            <p className="text-[13px] font-medium">
              A new version is ready
              {update.news[0] ? `: ${update.news[0].title}` : ""}
            </p>
            {update.news[0]?.points?.length ? (
              <ul className="mt-1.5 space-y-1 text-[12.5px] text-muted-foreground">
                {update.news[0].points.slice(0, 3).map((p) => (
                  <li key={p} className="flex gap-1.5">
                    <span className="text-[#0a84ff]">•</span>
                    {p}
                  </li>
                ))}
              </ul>
            ) : null}
            {update.app ? (
              <Button
                size="sm"
                asChild
                className="mt-2.5 h-8 rounded-lg bg-[#0a84ff] text-[12.5px] hover:bg-[#0974df]"
              >
                <a href="https://sidenote.lol">
                  <ArrowUpCircle className="mr-1.5 size-3.5" /> Download the new version
                </a>
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={onUpdate}
                disabled={updating || !update.managed}
                className="mt-2.5 h-8 rounded-lg bg-[#0a84ff] text-[12.5px] hover:bg-[#0974df]"
              >
                {updating ? (
                  <>
                    <RefreshCw className="mr-1.5 size-3.5 animate-spin" />
                    Updating — reloads when done…
                  </>
                ) : (
                  <>
                    <ArrowUpCircle className="mr-1.5 size-3.5" /> Update now
                  </>
                )}
              </Button>
            )}
            {update.app && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Grab the new Sidenote and drag it into Applications — it replaces
                this one, and your messages, notes, and pins stay put.
              </p>
            )}
            {!update.managed && !update.app && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                You&apos;re running Sidenote by hand — update in Terminal with{" "}
                <code className="rounded bg-black/[0.06] px-1 py-0.5 text-[11.5px] dark:bg-white/10">
                  git pull && npm run build
                </code>
                , then restart it.
              </p>
            )}
          </div>
          {!update.app && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Takes about a minute; Sidenote restarts and reloads on its own.
            </p>
          )}
        </>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[13px] text-muted-foreground">
            {checked ? "You're up to date." : "Updates install with one click from here."}
          </p>
          <Button
            size="sm"
            variant="ghost"
            onClick={checkNow}
            disabled={checking}
            className="h-7 shrink-0 rounded-lg px-2 text-[12.5px] text-muted-foreground"
          >
            <RefreshCw className={cn("mr-1 size-3.5", checking && "animate-spin")} />
            Check now
          </Button>
        </div>
      )}
    </section>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
  status,
  update,
  updating,
  onUpdate,
  onCheckUpdate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: AppStatus | null;
  update?: UpdateInfo | null;
  updating?: boolean;
  onUpdate?: () => void;
  onCheckUpdate?: () => Promise<UpdateInfo | null>;
}) {
  const isDemo = status?.mode === "demo";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] gap-0 overflow-y-auto p-0 sm:max-w-md">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="text-[15px]">Settings</DialogTitle>
          <DialogDescription className="sr-only">
            Connect AI, and see app info.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 px-5 py-5">
          {/* ---------- AI ---------- */}
          <section>
            <h3 className="text-[13px] font-semibold">AI</h3>
            {isDemo ? (
              <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                This is the demo. On your Mac, right-click any message and Sidenote explains it
                using the conversation around it.
              </p>
            ) : (
              <AiAccess />
            )}
          </section>

          {/* ---------- Getting back in ---------- */}
          <section>
            <h3 className="text-[13px] font-semibold">Opening Sidenote</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
              {isDemo ? (
                <>
                  Sidenote is a Mac app. Download it, drag it into{" "}
                  <span className="font-medium text-foreground">Applications</span>, and open it
                  like anything else — from Launchpad, Spotlight, or your Dock.
                </>
              ) : (
                <>
                  Closed the window? Sidenote is in your{" "}
                  <span className="font-medium text-foreground">Applications</span> folder — open
                  it from there, Spotlight, or the Dock, the same as any other Mac app.
                </>
              )}
            </p>
          </section>

          {/* ---------- Updates ---------- */}
          {!isDemo && (
            <>
              <Separator />
              <UpdatesSection
                update={update ?? null}
                updating={!!updating}
                onUpdate={onUpdate}
                onCheckUpdate={onCheckUpdate}
              />
            </>
          )}

          {/* ---------- Your data ---------- */}
          {!isDemo && status && (
            <>
              <Separator />
              <section>
                <h3 className="text-[13px] font-semibold">Your data</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                  {status.synced ? (
                    <>
                      {status.messageCount.toLocaleString()} messages across{" "}
                      {status.threadCount.toLocaleString()} conversations,
                      indexed privately on this Mac.
                      {status.lastSync && (
                        <>
                          {" "}
                          Last synced{" "}
                          {new Date(status.lastSync).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                          .
                        </>
                      )}
                    </>
                  ) : (
                    <>Not synced yet — use the Sync button to index your Messages.</>
                  )}{" "}
                  Nothing is uploaded, ever.
                </p>
              </section>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 border-t bg-black/[0.02] px-5 py-3 dark:bg-white/[0.03]">
          <Sparkles className="size-3.5 text-[#0a84ff]" />
          <p className="text-[12px] text-muted-foreground">
            Sidenote — your archive lives on this Mac.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
