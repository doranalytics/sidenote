import { NextRequest, NextResponse } from "next/server";
import { getThread, getThreadTexts, isDemo } from "@/lib/store";

export const dynamic = "force-dynamic";

// Embedding a conversation makes semantic search work on it. It's opt-in per
// thread and nothing is embedded out of the box: most people talk to a dozen
// people, not five hundred, and a ten-minute wait on first launch would be a
// tax on anyone who never asks a question. Explaining a message needs none of
// this.
//
// The work runs as a background job rather than inside the HTTP response.
// Streaming progress down the response tied the job's life to whoever was
// watching it, so closing the AI panel killed the embed mid-way. Now the
// request just starts it; the panel polls, and can come and go freely.

type Job = {
  threadId: string;
  done: number;
  total: number;
  running: boolean;
  error?: string;
  startedAt: number;
};

// Module scope: one long-lived Node server per Mac app, so this persists for
// as long as the app is open.
const jobs = new Map<string, Job>();

function startJob(threadId: string, messages: { id: number; text: string }[]) {
  const job: Job = {
    threadId,
    done: 0,
    // Replaced by the first progress callback with the true embeddable count;
    // this is just so the bar has a sane denominator before that arrives.
    total: messages.length,
    running: true,
    startedAt: Date.now(),
  };
  jobs.set(threadId, job);

  // Deliberately not awaited — the response returns immediately and this keeps
  // going on its own.
  void (async () => {
    try {
      const { catchUpThread } = await import("@/lib/embeddings");
      await catchUpThread(threadId, messages, (p) => {
        job.done = p.done;
        job.total = p.total;
      });
      job.done = job.total;
    } catch (e) {
      job.error = (e as Error).message;
    } finally {
      job.running = false;
    }
  })();
}

export async function GET(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  // No threadId → every embedded thread, so the sidebar can badge them.
  if (!threadId) {
    if (isDemo) return NextResponse.json({ threads: [] });
    const { caughtUpThreads } = await import("@/lib/embeddings");
    return NextResponse.json({ threads: caughtUpThreads() });
  }
  if (isDemo) {
    return NextResponse.json({ embedded: false, available: false, count: 0, job: null });
  }
  const { isCaughtUp } = await import("@/lib/embeddings");
  const job = jobs.get(threadId) ?? null;
  return NextResponse.json({
    embedded: isCaughtUp(threadId),
    available: true,
    count: getThreadTexts(threadId).length,
    job: job && { running: job.running, done: job.done, total: job.total, error: job.error },
  });
}

export async function POST(req: NextRequest) {
  if (isDemo) {
    return NextResponse.json({ error: "Only available on your Mac." }, { status: 400 });
  }
  const { threadId } = (await req.json()) as { threadId: string };
  if (!getThread(threadId)) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  const existing = jobs.get(threadId);
  if (existing?.running) {
    return NextResponse.json({ started: false, running: true, done: existing.done, total: existing.total });
  }
  const messages = getThreadTexts(threadId);
  startJob(threadId, messages);
  return NextResponse.json({ started: true, running: true, done: 0, total: messages.length });
}

export async function DELETE(req: NextRequest) {
  const threadId = req.nextUrl.searchParams.get("threadId");
  if (!threadId || isDemo) return NextResponse.json({ ok: false });
  const { forgetThread } = await import("@/lib/embeddings");
  forgetThread(threadId);
  jobs.delete(threadId);
  return NextResponse.json({ ok: true });
}
