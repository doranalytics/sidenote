import fs from "fs";
import os from "os";
import path from "path";
import type DatabaseType from "better-sqlite3";

// Semantic search over your own messages, computed and stored entirely on this
// Mac. Keyword search (FTS5, see store.ts) wins when your words appear
// literally; this wins when they don't — "money" finding "can you venmo me".
// Neither is reliably better, so retrieval merges both.
//
// Vectors live in their OWN database, NOT index.db: runSync() deletes and
// rebuilds index.db from scratch, which would throw away every embedding on
// each full re-sync. Message ids are chat.db ROWIDs and stay stable across
// rebuilds, so a separate file survives cleanly.
const VECTOR_DB = path.join(os.homedir(), ".sidenote", "vectors.db");
const MODEL_CACHE = path.join(os.homedir(), ".sidenote", "models");

const MODEL = "Xenova/bge-small-en-v1.5";
export const DIMS = 384;

// bge models are trained with an instruction prefix on the query side only.
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

type Db = InstanceType<typeof DatabaseType>;
let cached: Db | null = null;

function db(): Db {
  if (cached) return cached;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database: typeof DatabaseType = require("better-sqlite3");
  fs.mkdirSync(path.dirname(VECTOR_DB), { recursive: true });
  const open = new Database(VECTOR_DB);
  open.pragma("journal_mode = WAL");
  open.exec(`
    CREATE TABLE IF NOT EXISTS vectors(
      message_id INTEGER PRIMARY KEY,
      v          BLOB NOT NULL
    );
    CREATE TABLE IF NOT EXISTS caught_up(
      thread_id TEXT PRIMARY KEY,
      count     INT NOT NULL DEFAULT 0,
      done_at   INT NOT NULL
    );
  `);
  cached = open;
  return open;
}

// ---------- model ----------

type Extractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean }
) => Promise<{ data: Float32Array; dims: number[] }>;

let extractor: Extractor | null = null;
let loading: Promise<Extractor> | null = null;

// ~30 MB, fetched once into ~/.sidenote/models and reused forever after. This
// is the only network call the embedding path ever makes; the vectors
// themselves are computed locally and never leave the machine.
async function model(): Promise<Extractor> {
  if (extractor) return extractor;
  if (loading) return loading;
  loading = (async () => {
    const tf = await import("@huggingface/transformers");
    tf.env.cacheDir = MODEL_CACHE;
    tf.env.allowLocalModels = false;
    const pipe = (await tf.pipeline("feature-extraction", MODEL, {
      dtype: "q8",
    })) as unknown as Extractor;
    extractor = pipe;
    return pipe;
  })();
  return loading;
}

export function isModelReady(): boolean {
  return extractor !== null;
}

// ---------- int8 storage ----------
// Embeddings come out unit-normalised, so every component sits in [-1, 1] and
// a single byte per dimension is plenty. That is 75 MB for a 200k-message
// archive instead of 300 MB as float32, with no measurable ranking loss.

const toBlob = (v: Float32Array): Buffer => {
  const out = Buffer.allocUnsafe(DIMS);
  for (let i = 0; i < DIMS; i++) {
    out[i] = Math.max(0, Math.min(255, Math.round(v[i] * 127) + 128));
  }
  return out;
};

const dot = (blob: Buffer, q: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < DIMS; i++) s += ((blob[i] - 128) / 127) * q[i];
  return s;
};

// ---------- indexing ----------

export type CatchUpProgress = { done: number; total: number };

/** Embed every not-yet-embedded message in a thread. `onProgress` drives the
 *  "Embedding… 4,200 of 11,353" bar. */
export async function catchUpThread(
  threadId: string,
  messages: { id: number; text: string }[],
  onProgress?: (p: CatchUpProgress) => void
): Promise<number> {
  const have = new Set(
    (db().prepare("SELECT message_id FROM vectors").all() as { message_id: number }[]).map(
      (r) => r.message_id
    )
  );
  // Progress is reported against the WHOLE conversation, not the work left to
  // do. A resumed embed only has the remainder to process, and counting that
  // made a finished 42,000-message thread report "5,707 of 5,707" — which
  // reads as though 36,000 messages were skipped.
  const embeddable = messages.filter((m) => m.text.trim().length > 1);
  const todo = embeddable.filter((m) => !have.has(m.id));
  const already = embeddable.length - todo.length;
  const total = todo.length;
  if (!total) {
    onProgress?.({ done: embeddable.length, total: embeddable.length });
    markCaughtUp(threadId, messages.length);
    return 0;
  }

  const embed = await model();
  const insert = db().prepare("INSERT OR REPLACE INTO vectors(message_id, v) VALUES (?, ?)");
  const writeBatch = db().transaction((rows: { id: number; blob: Buffer }[]) => {
    for (const r of rows) insert.run(r.id, r.blob);
  });

  const BATCH = 64;
  for (let i = 0; i < total; i += BATCH) {
    const slice = todo.slice(i, i + BATCH);
    const out = await embed(
      slice.map((m) => m.text),
      { pooling: "mean", normalize: true }
    );
    writeBatch(
      slice.map((m, j) => ({
        id: m.id,
        blob: toBlob(out.data.subarray(j * DIMS, (j + 1) * DIMS) as Float32Array),
      }))
    );
    onProgress?.({
      done: already + Math.min(i + BATCH, total),
      total: embeddable.length,
    });
  }
  markCaughtUp(threadId, messages.length);
  return total;
}

function markCaughtUp(threadId: string, count: number) {
  db()
    .prepare("INSERT OR REPLACE INTO caught_up(thread_id, count, done_at) VALUES (?, ?, ?)")
    .run(threadId, count, Date.now());
}

export function isCaughtUp(threadId: string): boolean {
  return !!db().prepare("SELECT 1 FROM caught_up WHERE thread_id = ?").get(threadId);
}

export function caughtUpThreads(): string[] {
  return (db().prepare("SELECT thread_id FROM caught_up").all() as { thread_id: string }[]).map(
    (r) => r.thread_id
  );
}

export function forgetThread(threadId: string): void {
  db().prepare("DELETE FROM caught_up WHERE thread_id = ?").run(threadId);
}

/** Embed messages that arrived since the last catch-up. Called from the live
 *  sync, so a caught-up thread silently stays current — a tick is normally
 *  zero to five messages, which is milliseconds. */
export async function embedNewMessages(
  rows: { id: number; text: string }[]
): Promise<void> {
  if (!rows.length) return;
  const have = db().prepare("SELECT 1 FROM vectors WHERE message_id = ?");
  const todo = rows.filter((r) => r.text.trim().length > 1 && !have.get(r.id));
  if (!todo.length) return;
  const embed = await model();
  const out = await embed(
    todo.map((r) => r.text),
    { pooling: "mean", normalize: true }
  );
  const insert = db().prepare("INSERT OR REPLACE INTO vectors(message_id, v) VALUES (?, ?)");
  db().transaction(() => {
    todo.forEach((r, j) => {
      insert.run(r.id, toBlob(out.data.subarray(j * DIMS, (j + 1) * DIMS) as Float32Array));
    });
  })();
}

// ---------- search ----------

/** Rank a thread's embedded messages against a natural-language query.
 *  Returns message ids best-first. */
export async function semanticSearch(
  messageIds: number[],
  query: string,
  limit = 20
): Promise<{ id: number; score: number }[]> {
  if (!messageIds.length) return [];
  const embed = await model();
  const out = await embed([QUERY_PREFIX + query], { pooling: "mean", normalize: true });
  const q = out.data.subarray(0, DIMS) as Float32Array;

  // Chunked IN(...) keeps us under SQLite's variable limit on huge threads.
  const scored: { id: number; score: number }[] = [];
  const stmt = (n: number) =>
    db().prepare(
      `SELECT message_id, v FROM vectors WHERE message_id IN (${Array(n).fill("?").join(",")})`
    );
  for (let i = 0; i < messageIds.length; i += 800) {
    const chunk = messageIds.slice(i, i + 800);
    const rows = stmt(chunk.length).all(...chunk) as { message_id: number; v: Buffer }[];
    for (const r of rows) scored.push({ id: r.message_id, score: dot(r.v, q) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
