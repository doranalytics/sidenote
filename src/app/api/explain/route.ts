import { NextRequest, NextResponse } from "next/server";
import { getMessageWindow, getThread, isDemo, searchThread } from "@/lib/store";
import { friendlyError, streamClaude, type ToolSpec } from "@/lib/claude";
import type Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export type ExplainMode = "explain" | "lookup" | "reply";

// Deliberately short answers: this renders in a popover next to the message,
// not a document. Length is the first thing that makes an inline answer feel
// wrong.
const GUIDE: Record<ExplainMode, string> = {
  explain:
    "Explain what the highlighted message means. Decode any slang, abbreviations, references, or in-jokes, " +
    "then say what the person is actually getting at, including tone. Two or three sentences. " +
    "If a term genuinely isn't familiar to you, say so plainly rather than guessing — a confident wrong " +
    "definition is worse than admitting the gap, and the user can tap Search the web.",
  lookup:
    "Identify the people, places, bands, products, or events referenced in the highlighted message and say " +
    "what each one is. Use web search for anything you can't be sure about from memory, and search the " +
    "conversation history for anything they've mentioned before. Two or three sentences.",
  reply:
    "Draft a reply the user could send. Match how they already write in this conversation — their typical " +
    "length, punctuation, warmth, and whether they use emoji. Give the draft only, no preamble and no " +
    "quotation marks around it.",
};

export async function POST(req: NextRequest) {
  if (isDemo) {
    return NextResponse.json(
      { error: "AI runs when Sidenote is installed on your Mac, reading your own messages." },
      { status: 400 }
    );
  }

  const body = (await req.json()) as {
    threadId: string;
    messageId: number;
    mode: ExplainMode;
    /** Explicit user action — the only path that spends on web search. */
    web?: boolean;
    /** Follow-up turns typed into the popover. */
    history?: { role: "user" | "ai"; text: string }[];
    question?: string;
  };

  const thread = getThread(body.threadId);
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  const { text: context, target } = getMessageWindow(body.threadId, body.messageId);
  if (!context) {
    return NextResponse.json({ error: "Couldn't find that message." }, { status: 404 });
  }

  const search: ToolSpec = {
    name: "search_messages",
    description:
      "Search this conversation's full history for earlier mentions of a person, place, plan, or topic. " +
      "Use when the message refers back to something not visible in the surrounding messages.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for." } },
      required: ["query"],
    },
    run: async (input) => searchThread(body.threadId, String(input.query ?? ""), 12),
  };

  const system =
    `You are Sidenote, helping the user understand a message they just received. ` +
    `The conversation is between the user ("Me") and ${thread.name}. ` +
    `You are answering inline, right beside the message — keep it tight and plain-spoken. ` +
    `Never invent facts about the people involved.`;

  const opening =
    `Here are the messages around it, oldest first:\n\n${context}\n\n` +
    `The highlighted message is:\n"${target}"\n\n${GUIDE[body.mode]}`;

  const messages: Anthropic.MessageParam[] = [{ role: "user", content: opening }];
  for (const turn of body.history ?? []) {
    messages.push({
      role: turn.role === "user" ? "user" : "assistant",
      content: turn.text,
    });
  }
  if (body.question) messages.push({ role: "user", content: body.question });

  try {
    const stream = streamClaude({
      system,
      messages,
      tools: [search],
      webSearch: !!body.web || body.mode === "lookup",
      feature: body.web && body.mode !== "lookup" ? `${body.mode}_web` : body.mode,
      maxTokens: body.mode === "reply" ? 500 : 900,
      signal: req.signal,
    });
    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  } catch (e) {
    return NextResponse.json({ error: friendlyError(e as Error) }, { status: 502 });
  }
}
