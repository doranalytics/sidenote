import fs from "fs";
import type DatabaseType from "better-sqlite3";
import type { AppStatus, Message, Reaction, SearchResult, Thread } from "./types";
import { demoMessages, demoThreads } from "./demo-data";

export const isDemo =
  !!process.env.VERCEL || process.env.KEEPSAKE_DEMO === "1";

const PAGE = 100;
const AROUND = 50;

// ---------- local (synced index.db) ----------

type Db = InstanceType<typeof DatabaseType>;
let cached: { db: Db; mtimeMs: number } | null = null;

function openIndex(): Db | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database: typeof DatabaseType = require("better-sqlite3");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { INDEX_DB } = require("./local-sync") as typeof import("./local-sync");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(INDEX_DB);
  } catch {
    return null;
  }
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.db;
  cached?.db.close();
  cached = { db: new Database(INDEX_DB, { readonly: true }), mtimeMs: stat.mtimeMs };
  return cached.db;
}

// Called by the sync route so reads pick up the fresh database.
export function invalidateStore() {
  cached?.db.close();
  cached = null;
}

type ThreadRow = {
  id: string;
  name: string;
  participants: string;
  is_group: number;
  last_date: number;
  last_text: string;
  message_count: number;
};
type MsgRow = {
  id: number;
  thread_id: string;
  sender: string;
  is_from_me: number;
  date: number;
  text: string;
  date_read?: number; // absent in pre-receipt indexes
};

const toThread = (r: ThreadRow): Thread => ({
  id: r.id,
  name: r.name,
  participants: JSON.parse(r.participants),
  isGroup: !!r.is_group,
  lastDate: r.last_date,
  lastText: r.last_text,
  messageCount: r.message_count,
});
const toMessage = (r: MsgRow): Message => ({
  id: r.id,
  threadId: r.thread_id,
  sender: r.sender,
  isFromMe: !!r.is_from_me,
  date: r.date,
  text: r.text,
  ...(r.date_read ? { dateRead: r.date_read } : {}),
});

// ---------- public API ----------

export function getStatus(): AppStatus {
  if (isDemo) {
    return {
      mode: "demo",
      synced: true,
      lastSync: Date.now(),
      threadCount: demoThreads.length,
      messageCount: [...demoMessages.values()].reduce((n, m) => n + m.length, 0),
      ai: { configured: false },
    };
  }
  const db = openIndex();
  if (!db) {
    return {
      mode: "local",
      synced: false,
      lastSync: null,
      threadCount: 0,
      messageCount: 0,
      ai: { configured: false },
    };
  }
  const lastSync = db
    .prepare("SELECT value FROM meta WHERE key = 'lastSync'")
    .get() as { value: string } | undefined;
  return {
    mode: "local",
    synced: true,
    lastSync: lastSync ? Number(lastSync.value) : null,
    threadCount: (db.prepare("SELECT COUNT(*) c FROM threads").get() as { c: number }).c,
    messageCount: (db.prepare("SELECT COUNT(*) c FROM messages").get() as { c: number }).c,
    ai: { configured: false }, // filled in by the status route
  };
}

export function getThreads(query?: string): Thread[] {
  if (isDemo) {
    const q = query?.trim().toLowerCase();
    if (!q) return demoThreads;
    return demoThreads.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.participants.some((p) => p.toLowerCase().includes(q))
    );
  }
  const db = openIndex();
  if (!db) return [];
  const q = query?.trim();
  const rows = (
    q
      ? db
          .prepare(
            `SELECT * FROM threads
             WHERE name LIKE ? OR participants LIKE ?
             ORDER BY last_date DESC LIMIT 500`
          )
          .all(`%${q}%`, `%${q}%`)
      : db.prepare("SELECT * FROM threads ORDER BY last_date DESC LIMIT 500").all()
  ) as ThreadRow[];
  return rows.map(toThread);
}

export function getThread(id: string): Thread | null {
  if (isDemo) return demoThreads.find((t) => t.id === id) ?? null;
  const db = openIndex();
  if (!db) return null;
  const row = db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as
    | ThreadRow
    | undefined;
  return row ? toThread(row) : null;
}

export type MessagePage = {
  messages: Message[];
  hasEarlier: boolean;
  hasLater: boolean;
};

export function getMessages(
  threadId: string,
  opts: { before?: number; around?: number } = {}
): MessagePage {
  if (isDemo) {
    const all = demoMessages.get(threadId) ?? [];
    return { messages: all, hasEarlier: false, hasLater: false };
  }
  const db = openIndex();
  if (!db) return { messages: [], hasEarlier: false, hasLater: false };

  if (opts.around) {
    const anchor = db
      .prepare("SELECT * FROM messages WHERE id = ? AND thread_id = ?")
      .get(opts.around, threadId) as MsgRow | undefined;
    if (anchor) {
      const before = db
        .prepare(
          `SELECT * FROM messages WHERE thread_id = ? AND (date < ? OR (date = ? AND id < ?))
           ORDER BY date DESC, id DESC LIMIT ?`
        )
        .all(threadId, anchor.date, anchor.date, anchor.id, AROUND) as MsgRow[];
      const after = db
        .prepare(
          `SELECT * FROM messages WHERE thread_id = ? AND (date > ? OR (date = ? AND id > ?))
           ORDER BY date ASC, id ASC LIMIT ?`
        )
        .all(threadId, anchor.date, anchor.date, anchor.id, AROUND) as MsgRow[];
      return {
        messages: attachMedia(db, [...before.reverse(), anchor, ...after].map(toMessage)),
        hasEarlier: before.length === AROUND,
        hasLater: after.length === AROUND,
      };
    }
  }

  const rows = (
    opts.before
      ? db
          .prepare(
            `SELECT * FROM messages WHERE thread_id = ? AND date < ?
             ORDER BY date DESC, id DESC LIMIT ?`
          )
          .all(threadId, opts.before, PAGE)
      : db
          .prepare(
            `SELECT * FROM messages WHERE thread_id = ?
             ORDER BY date DESC, id DESC LIMIT ?`
          )
          .all(threadId, PAGE)
  ) as MsgRow[];
  return {
    messages: attachMedia(db, rows.reverse().map(toMessage)),
    hasEarlier: rows.length === PAGE,
    hasLater: false,
  };
}

// Decorate a page of messages with their attachments in one query.
// Older indexes (pre-attachments) just return the messages unchanged.
/** Everything a page of messages needs beyond its own row: files and
 *  tapbacks. Each pass is independent — a page with no attachments still has
 *  to get its reactions. */
function attachMedia(db: Db, messages: Message[]): Message[] {
  if (messages.length === 0) return messages;
  try {
    const rows = db
      .prepare(
        `SELECT id, message_id, mime, name FROM attachments
         WHERE message_id IN (${messages.map(() => "?").join(",")})`
      )
      .all(...messages.map((m) => m.id)) as {
      id: number;
      message_id: number;
      mime: string;
      name: string;
    }[];
    const byMsg = new Map<number, { id: number; mime: string; name: string }[]>();
    for (const r of rows) {
      const list = byMsg.get(r.message_id) ?? [];
      list.push({ id: r.id, mime: r.mime, name: r.name });
      byMsg.set(r.message_id, list);
    }
    for (const m of messages) {
      const list = byMsg.get(m.id);
      if (list) m.attachments = list;
    }
  } catch {
    // attachments table missing — re-sync will add it
  }
  attachReactions(db, messages);
  return messages;
}

/** Hang tapbacks off the messages they belong to. Same shape as attachMedia:
 *  one query for the whole page, and a missing table is survivable. */
function attachReactions(db: Db, messages: Message[]): void {
  if (messages.length === 0) return;
  try {
    const rows = db
      .prepare(
        `SELECT message_id, kind, emoji, sender, is_from_me FROM reactions
         WHERE message_id IN (${messages.map(() => "?").join(",")})
         ORDER BY date ASC`
      )
      .all(...messages.map((m) => m.id)) as {
      message_id: number;
      kind: string;
      emoji: string;
      sender: string | null;
      is_from_me: number;
    }[];
    if (rows.length === 0) return;
    const byMsg = new Map<number, Reaction[]>();
    for (const r of rows) {
      const list = byMsg.get(r.message_id) ?? [];
      list.push({
        kind: r.kind,
        emoji: r.emoji,
        sender: r.sender ?? "",
        isFromMe: !!r.is_from_me,
      });
      byMsg.set(r.message_id, list);
    }
    for (const m of messages) {
      const list = byMsg.get(m.id);
      if (list) m.reactions = list;
    }
  } catch {
    // reactions table missing — the next sync creates and backfills it
  }
}

export function getAvatar(name: string): { data: Buffer; mime: string } | null {
  if (isDemo) return null;
  const db = openIndex();
  if (!db) return null;
  try {
    const row = db.prepare("SELECT data FROM avatars WHERE name = ?").get(name) as
      | { data: Buffer }
      | undefined;
    if (!row?.data) return null;
    const mime = row.data[0] === 0x89 ? "image/png" : "image/jpeg";
    return { data: row.data, mime };
  } catch {
    return null; // avatars table missing — re-sync will add it
  }
}

export function getAttachment(
  id: number
): { path: string; mime: string; name: string } | null {
  if (isDemo) return null;
  const db = openIndex();
  if (!db) return null;
  try {
    return (
      (db
        .prepare("SELECT path, mime, name FROM attachments WHERE id = ?")
        .get(id) as { path: string; mime: string; name: string } | undefined) ?? null
    );
  } catch {
    return null;
  }
}

// Recent context for AI summarize / ask.
const aiLine = (m: Message) =>
  `[${new Date(m.date).toLocaleDateString()}] ${
    m.isFromMe ? "Me" : m.sender || "Them"
  }: ${m.text}`;

// The recent window is deliberately modest: on a 42,000-message thread even
// 200k characters only reaches back two months, so widening this can't be the
// answer to "it doesn't know our history". Depth comes from searchThread(),
// which the model calls as a tool and which reaches the entire archive. This
// window just supplies the last little while so follow-ups make sense.
export function getRecentText(
  threadId: string,
  maxChars = 32000
): { text: string; earliest: number } {
  // Queried directly (not via the paged reader) so the AI window isn't
  // capped at one UI page of messages.
  let messages: Message[];
  if (isDemo) {
    messages = demoMessages.get(threadId) ?? [];
  } else {
    const db = openIndex();
    if (!db) return { text: "", earliest: 0 };
    messages = (
      db
        .prepare(
          `SELECT * FROM messages WHERE thread_id = ? AND text != ''
           ORDER BY date DESC, id DESC LIMIT 800`
        )
        .all(threadId) as MsgRow[]
    )
      .map(toMessage)
      .reverse();
  }
  const lines: string[] = [];
  let total = 0;
  let earliest = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const line = aiLine(m);
    total += line.length;
    if (total > maxChars) break;
    lines.push(line);
    earliest = m.date;
  }
  return { text: lines.reverse().join("\n"), earliest };
}

const STOPWORDS = new Set(
  ("a an and are as at be been but by can could did do does for from get got had has have he her him " +
    "his how i in is it its me my of on or our she should so tell that the their them then there these " +
    "they this those to us was we were what when where which who why will with would you your").split(" ")
);

// Lexical RAG: search the thread's ENTIRE history for messages matching the
// question, pull each hit with a couple of neighbors for context, and format
// them for the model prompt. beforeDate excludes the recent window the model
// already sees, so no tokens are wasted on duplicates.
export function retrieveRelevantText(
  threadId: string,
  question: string,
  beforeDate: number,
  maxChars = 12000
): string {
  if (isDemo) return "";
  const db = openIndex();
  if (!db) return "";
  const terms = Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 3 || /^\d+$/.test(t))
        .filter((t) => !STOPWORDS.has(t))
    )
  ).slice(0, 12);
  if (!terms.length) return "";
  const ftsQuery = terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" OR ");

  let hits: MsgRow[];
  try {
    hits = db
      .prepare(
        `SELECT m.* FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
         WHERE messages_fts MATCH ? AND m.thread_id = ? AND m.date < ?
         ORDER BY bm25(messages_fts) LIMIT 24`
      )
      .all(ftsQuery, threadId, beforeDate) as MsgRow[];
  } catch {
    return ""; // malformed FTS query
  }
  if (!hits.length) return "";

  const beforeStmt = db.prepare(
    `SELECT * FROM messages WHERE thread_id = ? AND text != '' AND (date < ? OR (date = ? AND id < ?))
     ORDER BY date DESC, id DESC LIMIT 2`
  );
  const afterStmt = db.prepare(
    `SELECT * FROM messages WHERE thread_id = ? AND text != '' AND (date > ? OR (date = ? AND id > ?)) AND date < ?
     ORDER BY date ASC, id ASC LIMIT 2`
  );

  // Best-ranked hits first, each with surrounding context, until the budget
  // is spent; then everything is re-ordered chronologically for the model.
  const picked = new Map<number, Message>();
  let total = 0;
  for (const h of hits) {
    const window = [
      ...(beforeStmt.all(threadId, h.date, h.date, h.id) as MsgRow[]),
      h,
      ...(afterStmt.all(threadId, h.date, h.date, h.id, beforeDate) as MsgRow[]),
    ];
    let added = 0;
    for (const r of window) if (!picked.has(r.id)) added += r.text.length + 30;
    if (total + added > maxChars) break;
    total += added;
    for (const r of window) if (!picked.has(r.id)) picked.set(r.id, toMessage(r));
  }
  return [...picked.values()]
    .sort((a, b) => a.date - b.date || a.id - b.id)
    .map(aiLine)
    .join("\n");
}

// The messages immediately around one bubble — the entire context the
// right-click popover needs. Explaining "that fit was chopped" takes the
// conversation around it, not the whole eight-year history, which is why
// Explain works instantly on a thread that was never embedded.
export function getMessageWindow(
  threadId: string,
  messageId: number,
  before = 30,
  after = 10
): { text: string; target: string } {
  const lines: string[] = [];
  let target = "";
  if (isDemo) {
    const all = demoMessages.get(threadId) ?? [];
    const idx = all.findIndex((m) => m.id === messageId);
    if (idx === -1) return { text: "", target: "" };
    target = all[idx].text;
    for (const m of all.slice(Math.max(0, idx - before), idx + after + 1)) lines.push(aiLine(m));
    return { text: lines.join("\n"), target };
  }
  const db = openIndex();
  if (!db) return { text: "", target: "" };
  const hit = db.prepare("SELECT * FROM messages WHERE id = ?").get(messageId) as
    | MsgRow
    | undefined;
  if (!hit) return { text: "", target: "" };
  target = hit.text;
  const prev = (
    db
      .prepare(
        `SELECT * FROM messages WHERE thread_id = ? AND text != '' AND (date < ? OR (date = ? AND id < ?))
         ORDER BY date DESC, id DESC LIMIT ?`
      )
      .all(threadId, hit.date, hit.date, hit.id, before) as MsgRow[]
  ).reverse();
  const next = db
    .prepare(
      `SELECT * FROM messages WHERE thread_id = ? AND text != '' AND (date > ? OR (date = ? AND id > ?))
       ORDER BY date ASC, id ASC LIMIT ?`
    )
    .all(threadId, hit.date, hit.date, hit.id, after) as MsgRow[];
  for (const r of [...prev, hit, ...next]) lines.push(aiLine(toMessage(r)));
  return { text: lines.join("\n"), target };
}

/** Every message in a thread, for the embedding pass. */
export function getThreadTexts(threadId: string): { id: number; text: string }[] {
  if (isDemo) return (demoMessages.get(threadId) ?? []).map((m) => ({ id: m.id, text: m.text }));
  const db = openIndex();
  if (!db) return [];
  return db
    .prepare(
      "SELECT id, text FROM messages WHERE thread_id = ? AND text != '' ORDER BY date ASC"
    )
    .all(threadId) as { id: number; text: string }[];
}

export function getThreadMessageIds(threadId: string): number[] {
  if (isDemo) return (demoMessages.get(threadId) ?? []).map((m) => m.id);
  const db = openIndex();
  if (!db) return [];
  return (
    db
      .prepare("SELECT id FROM messages WHERE thread_id = ? AND text != ''")
      .all(threadId) as { id: number }[]
  ).map((r) => r.id);
}

function formatByIds(threadId: string, ids: number[]): string {
  if (!ids.length) return "";
  if (isDemo) {
    const all = demoMessages.get(threadId) ?? [];
    return all
      .filter((m) => ids.includes(m.id))
      .sort((a, b) => a.date - b.date)
      .map(aiLine)
      .join("\n");
  }
  const db = openIndex();
  if (!db) return "";
  const rows = db
    .prepare(
      `SELECT * FROM messages WHERE id IN (${ids.map(() => "?").join(",")}) ORDER BY date ASC, id ASC`
    )
    .all(...ids) as MsgRow[];
  return rows.map((r) => aiLine(toMessage(r))).join("\n");
}

// Keyword hits only — the lexical half of the merge, unscoped by date so it
// can reach the full history rather than the recent window.
function ftsIds(threadId: string, query: string, limit: number): number[] {
  const db = openIndex();
  if (!db) return [];
  const terms = Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length >= 3 || /^\d+$/.test(t))
        .filter((t) => !STOPWORDS.has(t))
    )
  ).slice(0, 12);
  if (!terms.length) return [];
  try {
    return (
      db
        .prepare(
          `SELECT m.id FROM messages_fts JOIN messages m ON m.id = messages_fts.rowid
           WHERE messages_fts MATCH ? AND m.thread_id = ?
           ORDER BY bm25(messages_fts) LIMIT ?`
        )
        .all(terms.map((t) => `"${t.replace(/"/g, "")}"*`).join(" OR "), threadId, limit) as {
        id: number;
      }[]
    ).map((r) => r.id);
  } catch {
    return []; // malformed FTS query
  }
}

/** Searches the thread's whole history and returns formatted messages for the
 *  model. Keyword and semantic each win different questions — keyword when
 *  your words appear literally, semantic when they don't — so both run and the
 *  results are merged. Semantic is skipped silently on threads that were never
 *  embedded, which keeps this working everywhere. */
export async function searchThread(
  threadId: string,
  query: string,
  limit = 24
): Promise<string> {
  const ids = new Set<number>(ftsIds(threadId, query, limit));
  if (!isDemo) {
    try {
      const { isCaughtUp, semanticSearch } = await import("@/lib/embeddings");
      if (isCaughtUp(threadId)) {
        const hits = await semanticSearch(getThreadMessageIds(threadId), query, limit);
        for (const h of hits) ids.add(h.id);
      }
    } catch {
      // Semantic search is an enhancement — never let it take keyword down.
    }
  }
  return formatByIds(threadId, [...ids].slice(0, limit * 2));
}

export function exportThread(
  threadId: string,
  since?: number
): { name: string; text: string; count: number } | null {
  const thread = getThread(threadId);
  if (!thread) return null;
  let msgs: Message[];
  if (isDemo) {
    msgs = (demoMessages.get(threadId) ?? []).filter((m) => !since || m.date >= since);
  } else {
    const db = openIndex();
    if (!db) return null;
    msgs = (
      db
        .prepare(
          `SELECT * FROM messages WHERE thread_id = ? AND date >= ? AND text != ''
           ORDER BY date ASC, id ASC`
        )
        .all(threadId, since ?? 0) as MsgRow[]
    ).map(toMessage);
  }
  const lines = msgs.map((m) => {
    const when = new Date(m.date).toLocaleString([], {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
    return `[${when}] ${m.isFromMe ? "Me" : m.sender || thread.name}: ${m.text}`;
  });
  const header = `Conversation with ${thread.name}${
    thread.isGroup ? ` (${thread.participants.join(", ")})` : ""
  }\n${msgs.length} messages · exported from Sidenote on ${new Date().toLocaleDateString()}\n\n`;
  return { name: thread.name, text: header + lines.join("\n"), count: msgs.length };
}

export function search(q: string, threadId?: string): SearchResult[] {
  const query = q.trim();
  if (!query) return [];
  if (isDemo) {
    const needle = query.toLowerCase();
    const results: SearchResult[] = [];
    for (const t of demoThreads) {
      if (threadId && t.id !== threadId) continue;
      for (const m of demoMessages.get(t.id) ?? []) {
        const idx = m.text.toLowerCase().indexOf(needle);
        if (idx === -1) continue;
        const from = Math.max(0, idx - 40);
        results.push({
          message: m,
          threadName: t.name,
          snippet:
            (from > 0 ? "…" : "") +
            m.text.slice(from, idx) +
            "[" + m.text.slice(idx, idx + query.length) + "]" +
            m.text.slice(idx + query.length, idx + query.length + 60),
        });
      }
    }
    return results.sort((a, b) => b.message.date - a.message.date).slice(0, 60);
  }
  const db = openIndex();
  if (!db) return [];
  const ftsQuery = query
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t.replace(/"/g, "")}"*`)
    .join(" ");
  try {
    const rows = db
      .prepare(
        `SELECT m.*, t.name as thread_name,
                snippet(messages_fts, 0, '[', ']', '…', 14) as snip
         FROM messages_fts f
         JOIN messages m ON m.id = f.rowid
         JOIN threads t ON t.id = m.thread_id
         WHERE messages_fts MATCH ? ${threadId ? "AND m.thread_id = ?" : ""}
         ORDER BY m.date DESC LIMIT 60`
      )
      .all(...(threadId ? [ftsQuery, threadId] : [ftsQuery])) as (MsgRow & {
      thread_name: string;
      snip: string;
    })[];
    return rows.map((r) => ({
      message: toMessage(r),
      threadName: r.thread_name,
      snippet: r.snip,
    }));
  } catch {
    return []; // malformed FTS query
  }
}
