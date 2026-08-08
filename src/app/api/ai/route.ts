import { NextRequest, NextResponse } from "next/server";
import { getRecentText, getThread, isDemo, searchThread } from "@/lib/store";
import { friendlyError, streamClaude, type ToolSpec } from "@/lib/claude";
import { appendExchange, getConversationMessages } from "@/lib/vault";
import type Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// An answer in progress, keyed by conversation. Module scope: one long-lived
// Node server per Mac app, so it outlives any particular panel.
type Answer = {
  text: string;
  running: boolean;
  error?: string;
  startedAt: number;
  /** The question, so a panel that reopens mid-answer can show what was
   *  asked — it is not in the vault until the exchange finishes. */
  prompt: string;
  /** Lets Stop reach a generation nobody is currently watching. */
  abort: AbortController;
};
const answers = new Map<string, Answer>();

// A finished answer is already in the vault; this map only exists so a panel
// that comes back mid-generation can pick the thread back up. Drop the old
// ones rather than growing forever.
function sweep() {
  const cutoff = Date.now() - 30 * 60_000;
  for (const [k, a] of answers) {
    if (!a.running && a.startedAt < cutoff) answers.delete(k);
  }
}

export async function POST(req: NextRequest) {
  if (isDemo) {
    return NextResponse.json(
      {
        error:
          "AI runs when Sidenote is installed on your Mac, reading your own messages.",
      },
      { status: 400 }
    );
  }
  const body = (await req.json()) as {
    threadId: string;
    mode: "summarize" | "ask";
    question?: string;
    conversationId?: string;
    /** A screenshot pasted into the chat box. */
    image?: { data: string; mime: string };
  };
  const thread = getThread(body.threadId);
  if (!thread) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }

  const { text: recent } = getRecentText(body.threadId);

  // The whole history reaches the model through this tool rather than by
  // stuffing the prompt. On a 42,000-message thread even a very large window
  // covers only the last couple of months, so searching beats shipping.
  const search: ToolSpec = {
    name: "search_messages",
    description:
      "Search the full history of this conversation, going back years — far beyond the recent messages you were given. " +
      "Use it whenever the question refers to the past, to something you can't see, or to a person, place, or plan mentioned earlier. " +
      "Call it several times with different wordings if the first search comes back thin.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to look for, in natural language or keywords.",
        },
      },
      required: ["query"],
    },
    run: async (input) => searchThread(body.threadId, String(input.query ?? "")),
  };

  const system =
    `You are Sidenote, helping the user understand their own iMessage history. ` +
    `This conversation is between the user ("Me") and ${thread.name}. ` +
    `Be concise, warm, and concrete. Never invent details that aren't in the messages — ` +
    `if the answer isn't there, search once more, then say plainly that you couldn't find it.`;

  const prompt =
    body.mode === "summarize"
      ? `Summarize my conversation with ${thread.name}`
      : (body.question ?? "");

  const history: Anthropic.MessageParam[] = body.conversationId
    ? getConversationMessages(body.conversationId).map((m) => ({
        role: m.role === "user" ? ("user" as const) : ("assistant" as const),
        content: m.text,
      }))
    : [];

  const task =
    body.mode === "summarize"
      ? `Here are the most recent messages:\n\n${recent}\n\nSummarize this conversation: the key facts, plans, and anything worth remembering about ${thread.name}. Short bullet points.`
      : `Here are the most recent messages for context:\n\n${recent}\n\nQuestion: ${prompt}`;

  // A pasted screenshot rides along with the question. The image goes first —
  // Claude reads a leading image as the subject of the text that follows.
  const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];
  const turn: Anthropic.MessageParam =
    body.image && IMAGE_TYPES.includes(body.image.mime)
      ? {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: body.image.mime as "image/png",
                data: body.image.data,
              },
            },
            { type: "text", text: task },
          ],
        }
      : { role: "user", content: task };

  sweep();
  const key = body.conversationId ?? body.threadId;
  const existing = answers.get(key);
  if (existing?.running) {
    return NextResponse.json({ started: false, running: true });
  }

  const job: Answer = {
    text: "",
    running: true,
    startedAt: Date.now(),
    prompt,
    abort: new AbortController(),
  };
  answers.set(key, job);

  // Deliberately not awaited. Tying generation to the HTTP response meant
  // leaving the panel — or switching threads — aborted the answer mid-sentence,
  // which is the same thing that used to kill an embed. The request only
  // starts it now; the panel polls and can come and go.
  void (async () => {
    try {
      const stream = streamClaude({
        system,
        messages: [...history, turn],
        tools: [search],
        maxTokens: 2000,
        feature: body.mode === "summarize" ? "summarize" : "thread_question",
        // The job's own signal, not the request's: the client going away must
        // not stop this, but Stop still must.
        signal: job.abort.signal,
        onDone: (answer) => {
          if (body.conversationId && answer.trim()) {
            try {
              appendExchange(body.conversationId, prompt, answer);
            } catch {
              // never let a persistence hiccup lose an answer already produced
            }
          }
        },
      });
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        job.text += decoder.decode(value, { stream: true });
      }
    } catch (e) {
      job.error = friendlyError(e as Error);
    } finally {
      job.running = false;
    }
  })();

  return NextResponse.json({ started: true, running: true });
}

/** The current state of an answer, whether or not anyone is watching. */
export async function GET(req: NextRequest) {
  if (isDemo) return NextResponse.json({ running: false, text: "" });
  const key = req.nextUrl.searchParams.get("key");
  if (!key) return NextResponse.json({ running: false, text: "" });
  const job = answers.get(key);
  if (!job) return NextResponse.json({ running: false, text: "", missing: true });
  return NextResponse.json({
    running: job.running,
    text: job.text,
    prompt: job.prompt,
    error: job.error,
  });
}

/** Stop generating. The half-written answer is already saved by onDone, so
 *  this loses nothing that was produced. */
export async function DELETE(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  const job = key ? answers.get(key) : null;
  if (job?.running) job.abort.abort();
  return NextResponse.json({ ok: true });
}
