import fs from "fs";
import os from "os";
import path from "path";
import type DatabaseType from "better-sqlite3";

// Everything in this file runs only on a Mac in local mode. better-sqlite3 is
// loaded lazily so the module can be imported safely in the demo deployment.
function sqlite(): typeof DatabaseType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("better-sqlite3");
}

export const KEEPSAKE_DIR = path.join(os.homedir(), ".sidenote");
const RAW_DIR = path.join(KEEPSAKE_DIR, "raw");
export const INDEX_DB = path.join(KEEPSAKE_DIR, "index.db");

const CHAT_DB = path.join(os.homedir(), "Library", "Messages", "chat.db");
const ADDRESSBOOK_DIR = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "AddressBook"
);

// ---------------------------------------------------------------- tapbacks
//
// Hearts, thumbs-up and the rest are not properties of a message in Apple's
// schema — each one is its OWN row in `message`, pointing at its target
// through `associated_message_guid`. The main message query filters those rows
// out (they have no text and would show as blank bubbles), which is why they
// have to be collected separately and re-attached here.
//
// The guid carries a part prefix — "p:0/UUID" on a normal message, "bp:UUID"
// on some older ones — so it has to be stripped before it will match
// `message.guid`.
export const REACTIONS_SCHEMA = `
    CREATE TABLE IF NOT EXISTS reactions(
      id INTEGER PRIMARY KEY, message_id INT, kind TEXT, emoji TEXT,
      sender TEXT, is_from_me INT, date INT
    );
    CREATE INDEX IF NOT EXISTS idx_react_msg ON reactions(message_id);
`;

// 2000-2006 add a tapback; 3000-3006 take the same one back.
const TAPBACKS: Record<number, { kind: string; emoji: string }> = {
  0: { kind: "love", emoji: "❤️" },
  1: { kind: "like", emoji: "👍" },
  2: { kind: "dislike", emoji: "👎" },
  3: { kind: "laugh", emoji: "😂" },
  4: { kind: "emphasize", emoji: "‼️" },
  5: { kind: "question", emoji: "❓" },
};

const TAPBACK_SQL = `
  SELECT t.ROWID as id, t.associated_message_type as type,
         t.associated_message_emoji as custom, t.is_from_me, t.date,
         h.id as handle, target.ROWID as target_id
  FROM message t
  JOIN message target ON target.guid = CASE
        WHEN instr(t.associated_message_guid, '/') > 0
        THEN substr(t.associated_message_guid, instr(t.associated_message_guid, '/') + 1)
        ELSE replace(t.associated_message_guid, 'bp:', '') END
  LEFT JOIN handle h ON h.ROWID = t.handle_id
  WHERE t.associated_message_type BETWEEN 2000 AND 3999`;

type TapRow = {
  id: number;
  type: number;
  custom: string | null;
  is_from_me: number;
  date: number;
  handle: string | null;
  target_id: number;
};

/** Copy tapbacks across for messages already in the index. `sinceRowid` limits
 *  the scan on a live tick; pass 0 to take everything. Returns rows applied. */
function syncReactions(
  src: DatabaseType.Database,
  out: DatabaseType.Database,
  names: Map<string, string>,
  sinceRowid = 0
): number {
  let rows: TapRow[];
  try {
    rows = src
      .prepare(sinceRowid ? `${TAPBACK_SQL} AND t.ROWID > ?` : TAPBACK_SQL)
      .all(...(sinceRowid ? [sinceRowid] : [])) as TapRow[];
  } catch {
    // associated_message_emoji only exists on macOS 14+. Reactions are
    // decoration; an older schema must not take the whole sync down.
    return 0;
  }
  if (!rows.length) return 0;

  const known = out.prepare("SELECT 1 FROM messages WHERE id = ?");
  const add = out.prepare(
    `INSERT OR REPLACE INTO reactions(id, message_id, kind, emoji, sender, is_from_me, date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  // A removal names the tapback it undoes only by (target, kind, sender), so
  // that triple is what gets deleted rather than a row id.
  const remove = out.prepare(
    `DELETE FROM reactions
     WHERE message_id = ? AND kind = ? AND COALESCE(sender, '') = ? AND is_from_me = ?`
  );

  let applied = 0;
  // Oldest first, so a later removal always lands after the add it cancels.
  rows.sort((a, b) => a.date - b.date);
  for (const r of rows) {
    if (!known.get(r.target_id)) continue; // target lives in a chat we skipped
    const removing = r.type >= 3000;
    const slot = r.type % 1000;
    const spec = TAPBACKS[slot];
    // Slot 6 is a free-form emoji tapback, which only the sender's own copy of
    // the string can describe.
    const kind = spec ? spec.kind : "emoji";
    const emoji = spec ? spec.emoji : (r.custom ?? "❤️");
    if (!spec && slot !== 6) continue; // unknown future tapback type
    const sender = r.is_from_me || !r.handle ? "" : resolveName(r.handle, names);
    if (removing) remove.run(r.target_id, kind, sender, r.is_from_me ? 1 : 0);
    else {
      add.run(
        r.id,
        r.target_id,
        kind,
        emoji,
        sender,
        r.is_from_me ? 1 : 0,
        appleToUnixMs(r.date)
      );
    }
    applied++;
  }
  return applied;
}

const APPLE_EPOCH_MS = 978307200000; // 2001-01-01 in unix ms

function appleToUnixMs(d: number): number {
  if (!d) return 0;
  // Modern macOS stores nanoseconds since 2001; very old exports used seconds.
  if (d > 1e12) return Math.round(d / 1e6) + APPLE_EPOCH_MS;
  return d * 1000 + APPLE_EPOCH_MS;
}

// Extract the visible text from an NSKeyedArchiver/typedstream attributedBody
// blob (used when message.text is NULL on newer macOS versions).
export function extractText(
  text: string | null,
  attributedBody: Buffer | null
): string | null {
  if (text && text.trim()) return text;
  if (!attributedBody) return null;
  const marker = Buffer.from("NSString");
  let i = attributedBody.indexOf(marker);
  if (i === -1) return null;
  i += marker.length + 5; // skip typedstream class bytes
  if (i >= attributedBody.length) return null;
  let len = attributedBody[i];
  let start = i + 1;
  if (len === 0x81) {
    len = attributedBody.readUInt16LE(i + 1);
    start = i + 3;
  } else if (len === 0x82) {
    len = attributedBody.readUInt32LE(i + 1);
    start = i + 5;
  }
  const out = attributedBody
    .toString("utf8", start, Math.min(start + len, attributedBody.length))
    .replace(/￼/g, "")
    .trim();
  return out || null;
}

function normalizePhone(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function formatIdentifier(id: string): string {
  if (id.includes("@")) return id;
  const digits = normalizePhone(id);
  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return id;
}

export class PermissionError extends Error {
  constructor() {
    super("Sidenote needs Full Disk Access to read your Messages.");
    this.name = "PermissionError";
  }
}

type AttRow = {
  id: number;
  filename: string | null;
  mime_type: string | null;
  transfer_name: string | null;
};

const expandHome = (p: string) =>
  p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;

// Link-preview payloads and sticker plumbing aren't viewable files.
function displayableAttachment(a: AttRow): boolean {
  if (!a.filename) return false;
  if (a.filename.includes("pluginPayload")) return false;
  return true;
}

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
  heic: "image/heic", heif: "image/heif", webp: "image/webp", tiff: "image/tiff",
  mov: "video/quicktime", mp4: "video/mp4", m4a: "audio/mp4", caf: "audio/x-caf",
  pdf: "application/pdf",
};

function attMime(a: AttRow): string {
  if (a.mime_type) return a.mime_type;
  const ext = (a.filename ?? "").split(".").pop()?.toLowerCase() ?? "";
  return EXT_MIME[ext] ?? "application/octet-stream";
}

const attName = (a: AttRow) =>
  a.transfer_name || path.basename(a.filename ?? "attachment");

function copyIntoRaw(src: string, destName: string): string {
  const dest = path.join(RAW_DIR, destName);
  fs.copyFileSync(src, dest);
  for (const suffix of ["-wal", "-shm"]) {
    if (fs.existsSync(src + suffix)) {
      fs.copyFileSync(src + suffix, dest + suffix);
    } else {
      fs.rmSync(dest + suffix, { force: true });
    }
  }
  return dest;
}

type Contacts = {
  names: Map<string, string>; // phone-digits / email → display name
  photos: Map<string, Buffer>; // display name → contact photo (jpeg/png)
};

let contactsCache: Contacts | null = null;

// AddressBook image blobs carry a 1-byte marker: 0x01 + image bytes, or a
// short 0x02-prefixed reference we can't resolve. Only real images pass.
function photoBuffer(blob: Buffer | null): Buffer | null {
  if (!blob || blob.length < 64) return null;
  const b = blob[0] === 0x01 || blob[0] === 0x02 ? blob.subarray(1) : blob;
  const jpeg = b[0] === 0xff && b[1] === 0xd8;
  const png = b[0] === 0x89 && b[1] === 0x50;
  return jpeg || png ? Buffer.from(b) : null;
}

function loadContacts(): Contacts {
  const map = new Map<string, string>();
  const photos = new Map<string, Buffer>();
  let dbFiles: string[] = [];
  try {
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name === "AddressBook-v22.abcddb") dbFiles.push(p);
      }
    };
    walk(ADDRESSBOOK_DIR);
  } catch {
    dbFiles = [];
  }
  const Database = sqlite();
  dbFiles.forEach((file, n) => {
    try {
      const copy = copyIntoRaw(file, `contacts-${n}.abcddb`);
      const db = new Database(copy, { readonly: true });
      const name = (r: {
        ZFIRSTNAME: string | null;
        ZLASTNAME: string | null;
        ZORGANIZATION: string | null;
      }) =>
        [r.ZFIRSTNAME, r.ZLASTNAME].filter(Boolean).join(" ").trim() ||
        (r.ZORGANIZATION ?? "").trim();
      try {
        for (const row of db
          .prepare(
            `SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, p.ZFULLNUMBER as val
             FROM ZABCDPHONENUMBER p JOIN ZABCDRECORD r ON p.ZOWNER = r.Z_PK`
          )
          .iterate() as IterableIterator<never>) {
          const r = row as {
            ZFIRSTNAME: string | null;
            ZLASTNAME: string | null;
            ZORGANIZATION: string | null;
            val: string | null;
          };
          const n2 = name(r);
          if (!n2 || !r.val) continue;
          const digits = normalizePhone(r.val);
          if (digits.length >= 7) {
            map.set(digits, n2);
            map.set(digits.slice(-10), n2);
          }
        }
        for (const row of db
          .prepare(
            `SELECT r.ZFIRSTNAME, r.ZLASTNAME, r.ZORGANIZATION, e.ZADDRESS as val
             FROM ZABCDEMAILADDRESS e JOIN ZABCDRECORD r ON e.ZOWNER = r.Z_PK`
          )
          .iterate() as IterableIterator<never>) {
          const r = row as {
            ZFIRSTNAME: string | null;
            ZLASTNAME: string | null;
            ZORGANIZATION: string | null;
            val: string | null;
          };
          const n2 = name(r);
          if (n2 && r.val) map.set(r.val.toLowerCase(), n2);
        }
        for (const row of db
          .prepare(
            `SELECT ZFIRSTNAME, ZLASTNAME, ZORGANIZATION,
                    ZTHUMBNAILIMAGEDATA as thumb, ZIMAGEDATA as img
             FROM ZABCDRECORD
             WHERE ZTHUMBNAILIMAGEDATA IS NOT NULL OR ZIMAGEDATA IS NOT NULL`
          )
          .iterate() as IterableIterator<never>) {
          const r = row as {
            ZFIRSTNAME: string | null;
            ZLASTNAME: string | null;
            ZORGANIZATION: string | null;
            thumb: Buffer | null;
            img: Buffer | null;
          };
          const n2 = name(r);
          if (!n2 || photos.has(n2)) continue;
          const photo = photoBuffer(r.thumb) ?? photoBuffer(r.img);
          if (photo) photos.set(n2, photo);
        }
      } finally {
        db.close();
      }
    } catch {
      // one unreadable source shouldn't kill the sync
    }
  });
  return { names: map, photos };
}

export function resolveName(
  identifier: string,
  contacts: Map<string, string>
): string {
  if (identifier.includes("@")) {
    return contacts.get(identifier.toLowerCase()) ?? identifier;
  }
  const digits = normalizePhone(identifier);
  return (
    contacts.get(digits) ??
    contacts.get(digits.slice(-10)) ??
    formatIdentifier(identifier)
  );
}

export function runSync(): { threads: number; messages: number } {
  fs.mkdirSync(RAW_DIR, { recursive: true });

  let chatCopy: string;
  try {
    chatCopy = copyIntoRaw(CHAT_DB, "chat.db");
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EPERM" || err.code === "EACCES" || err.code === "ENOENT") {
      throw new PermissionError();
    }
    throw e;
  }

  const contacts = loadContacts();
  const Database = sqlite();
  const src = new Database(chatCopy);
  // Recover any WAL content from the copied files, then read.
  try {
    src.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    /* readonly fallback is fine */
  }

  type ChatRow = {
    rowid: number;
    guid: string;
    chat_identifier: string | null;
    display_name: string | null;
    style: number;
  };
  const chats = src
    .prepare(
      "SELECT ROWID as rowid, guid, chat_identifier, display_name, style FROM chat"
    )
    .all() as ChatRow[];

  const participantsByChat = new Map<number, string[]>();
  for (const row of src
    .prepare(
      `SELECT chj.chat_id as chat_id, h.id as handle
       FROM chat_handle_join chj JOIN handle h ON h.ROWID = chj.handle_id`
    )
    .all() as { chat_id: number; handle: string }[]) {
    const list = participantsByChat.get(row.chat_id) ?? [];
    if (!list.includes(row.handle)) list.push(row.handle);
    participantsByChat.set(row.chat_id, list);
  }

  // Direct chats are merged by identifier so SMS + iMessage with the same
  // person become one thread. Groups keyed by guid.
  type ThreadAgg = {
    id: string;
    name: string;
    participants: string[];
    isGroup: boolean;
  };
  const threadByChatRowid = new Map<number, string>();
  const threads = new Map<string, ThreadAgg>();
  for (const c of chats) {
    const isGroup = c.style === 43;
    const identifier = c.chat_identifier ?? c.guid;
    const id = isGroup ? `group:${c.guid}` : `direct:${identifier}`;
    threadByChatRowid.set(c.rowid, id);
    if (!threads.has(id)) {
      const handles = participantsByChat.get(c.rowid) ?? [identifier];
      const names = handles.map((h) => resolveName(h, contacts.names));
      threads.set(id, {
        id,
        name: isGroup
          ? c.display_name?.trim() || names.slice(0, 4).join(", ")
          : names[0] ?? formatIdentifier(identifier),
        participants: names,
        isGroup,
      });
    }
  }

  fs.rmSync(INDEX_DB, { force: true });
  fs.rmSync(INDEX_DB + "-wal", { force: true });
  fs.rmSync(INDEX_DB + "-shm", { force: true });
  const out = new Database(INDEX_DB);
  out.pragma("journal_mode = WAL");
  out.exec(`
    CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE threads(
      id TEXT PRIMARY KEY, name TEXT, participants TEXT, is_group INT,
      last_date INT DEFAULT 0, last_text TEXT DEFAULT '', message_count INT DEFAULT 0
    );
    CREATE TABLE messages(
      id INTEGER PRIMARY KEY, thread_id TEXT, sender TEXT,
      is_from_me INT, date INT, text TEXT, date_read INT DEFAULT 0
    );
    CREATE INDEX idx_msg_thread ON messages(thread_id, date);
    CREATE TABLE attachments(
      id INTEGER PRIMARY KEY, message_id INT, path TEXT, mime TEXT, name TEXT
    );
    CREATE INDEX idx_att_msg ON attachments(message_id);
    CREATE TABLE avatars(name TEXT PRIMARY KEY, data BLOB);
    ${REACTIONS_SCHEMA}
    CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='id');
  `);

  const insertThread = out.prepare(
    "INSERT INTO threads(id, name, participants, is_group) VALUES (?, ?, ?, ?)"
  );
  const insertMsg = out.prepare(
    "INSERT OR IGNORE INTO messages(id, thread_id, sender, is_from_me, date, text, date_read) VALUES (?, ?, ?, ?, ?, ?, ?)"
  );
  const insertFts = out.prepare(
    "INSERT INTO messages_fts(rowid, text) VALUES (?, ?)"
  );
  const insertAtt = out.prepare(
    "INSERT OR IGNORE INTO attachments(id, message_id, path, mime, name) VALUES (?, ?, ?, ?, ?)"
  );
  const insertAvatar = out.prepare(
    "INSERT OR REPLACE INTO avatars(name, data) VALUES (?, ?)"
  );

  // message rowid → displayable attachments (link-preview payloads excluded)
  const attByMessage = new Map<number, AttRow[]>();
  for (const a of src
    .prepare(
      `SELECT maj.message_id as mid, a.ROWID as id, a.filename, a.mime_type, a.transfer_name
       FROM message_attachment_join maj JOIN attachment a ON a.ROWID = maj.attachment_id`
    )
    .all() as (AttRow & { mid: number })[]) {
    if (!displayableAttachment(a)) continue;
    const list = attByMessage.get(a.mid) ?? [];
    list.push(a);
    attByMessage.set(a.mid, list);
  }

  let messageCount = 0;
  let maxRowid = 0;
  const insertAll = out.transaction(() => {
    for (const t of threads.values()) {
      insertThread.run(t.id, t.name, JSON.stringify(t.participants), t.isGroup ? 1 : 0);
    }
    for (const [n, photo] of contacts.photos) insertAvatar.run(n, photo);
    type MsgRow = {
      id: number;
      text: string | null;
      attributedBody: Buffer | null;
      is_from_me: number;
      date: number;
      date_read: number;
      handle: string | null;
      chat_id: number;
    };
    const stmt = src.prepare(
      `SELECT m.ROWID as id, m.text, m.attributedBody, m.is_from_me, m.date,
              m.date_read, h.id as handle, cmj.chat_id as chat_id
       FROM message m
       JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
       LEFT JOIN handle h ON h.ROWID = m.handle_id
       WHERE COALESCE(m.associated_message_type, 0) = 0
         AND COALESCE(m.item_type, 0) = 0`
    );
    for (const row of stmt.iterate() as IterableIterator<MsgRow>) {
      if (row.id > maxRowid) maxRowid = row.id;
      const threadId = threadByChatRowid.get(row.chat_id);
      if (!threadId) continue;
      const text = extractText(row.text, row.attributedBody);
      const atts = attByMessage.get(row.id) ?? [];
      if (!text && atts.length === 0) continue; // reactions, edits, etc.
      const sender =
        row.is_from_me || !row.handle ? "" : resolveName(row.handle, contacts.names);
      insertMsg.run(
        row.id,
        threadId,
        sender,
        row.is_from_me ? 1 : 0,
        appleToUnixMs(row.date),
        text ?? "",
        row.is_from_me ? appleToUnixMs(row.date_read) : 0
      );
      if (text) insertFts.run(row.id, text);
      for (const a of atts) {
        insertAtt.run(a.id, row.id, expandHome(a.filename!), attMime(a), attName(a));
      }
      messageCount++;
    }
    out.exec(`
      UPDATE threads SET
        message_count = (SELECT COUNT(*) FROM messages m WHERE m.thread_id = threads.id),
        last_date = COALESCE((SELECT MAX(date) FROM messages m WHERE m.thread_id = threads.id), 0),
        last_text = COALESCE((SELECT text FROM messages m WHERE m.thread_id = threads.id ORDER BY date DESC LIMIT 1), '');
      DELETE FROM threads WHERE message_count = 0;
    `);
  });
  insertAll();
  // After the messages exist, so every tapback has a target to attach to.
  out.transaction(() => syncReactions(src, out, contacts.names))();

  out
    .prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('lastSync', ?)")
    .run(String(Date.now()));
  out
    .prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('maxMsgRowid', ?)")
    .run(String(maxRowid));
  contactsCache = contacts; // live sync reuses the fresh map

  const threadCount = (
    out.prepare("SELECT COUNT(*) as c FROM threads").get() as { c: number }
  ).c;
  src.close();
  out.close();
  return { threads: threadCount, messages: messageCount };
}

// ---------- live mode ----------
// A lightweight watcher: every few seconds, if Apple's chat.db changed, pull
// just the new rows straight from the original database (readonly WAL reads
// are snapshot-safe) into the existing index. Full syncs stay authoritative.

let liveTimer: NodeJS.Timeout | null = null;
let lastSeen = 0;
let ticking = false;

export function startLiveSync() {
  if (liveTimer) return;
  liveTimer = setInterval(() => {
    if (ticking) return;
    ticking = true;
    try {
      liveTick();
    } catch {
      // never let a bad tick kill the loop
    } finally {
      ticking = false;
    }
  }, 4000);
  liveTimer.unref?.();
}

function liveTick() {
  let mtime = 0;
  try {
    mtime = fs.statSync(CHAT_DB).mtimeMs;
    try {
      mtime = Math.max(mtime, fs.statSync(CHAT_DB + "-wal").mtimeMs);
    } catch {
      /* no WAL right now */
    }
  } catch {
    return; // no Full Disk Access yet — wait for a manual sync to sort it out
  }
  if (mtime <= lastSeen) return;
  if (!fs.existsSync(INDEX_DB)) return;
  runIncrementalSync();
  lastSeen = mtime;
}

export function runIncrementalSync(): number {
  const Database = sqlite();
  let src: InstanceType<typeof DatabaseType>;
  try {
    src = new Database(CHAT_DB, { readonly: true });
  } catch {
    return 0;
  }
  const out = new Database(INDEX_DB);
  let added = 0;
  try {
    // older indexes predate the attachments/avatars tables and date_read
    out.exec(`
      CREATE TABLE IF NOT EXISTS attachments(
        id INTEGER PRIMARY KEY, message_id INT, path TEXT, mime TEXT, name TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_att_msg ON attachments(message_id);
      CREATE TABLE IF NOT EXISTS avatars(name TEXT PRIMARY KEY, data BLOB);
      ${REACTIONS_SCHEMA}
    `);
    try {
      out.exec("ALTER TABLE messages ADD COLUMN date_read INT DEFAULT 0");
    } catch {
      /* column already exists */
    }
    const metaRow = out
      .prepare("SELECT value FROM meta WHERE key = 'maxMsgRowid'")
      .get() as { value: string } | undefined;
    let maxRowid = metaRow
      ? Number(metaRow.value)
      : ((out.prepare("SELECT COALESCE(MAX(id), 0) as m FROM messages").get() as { m: number }).m);

    // Read receipts land as updates to rows we already copied — refresh the
    // recent outgoing window so "Read" appears without a full sync.
    try {
      const updReceipt = out.prepare(
        "UPDATE messages SET date_read = ? WHERE id = ? AND COALESCE(date_read, 0) = 0"
      );
      const receipts = src
        .prepare(
          `SELECT ROWID as id, date_read FROM message
           WHERE is_from_me = 1 AND date_read > 0 AND ROWID > ?`
        )
        .all(Math.max(0, maxRowid - 400)) as { id: number; date_read: number }[];
      for (const r of receipts) updReceipt.run(appleToUnixMs(r.date_read), r.id);
    } catch {
      /* receipts are decoration — never block the sync */
    }

    // Tapbacks arrive as rows of their own, usually with no new message beside
    // them — someone hearts a text from yesterday — so this gets its own
    // watermark and runs on every tick, including the no-new-messages one.
    // With no watermark yet, it sweeps from zero: that is the one-time
    // backfill that gives an existing install its whole reaction history.
    const runReactions = () => {
      try {
        const mark = out.prepare("SELECT value FROM meta WHERE key = 'maxReactionRowid'").get() as
          | { value: string }
          | undefined;
        const since = mark ? Number(mark.value) : 0;
        const top = (
          src.prepare("SELECT COALESCE(MAX(ROWID), 0) as m FROM message").get() as { m: number }
        ).m;
        if (top <= since) return;
        if (!contactsCache) contactsCache = loadContacts();
        const names = contactsCache.names;
        out.transaction(() => {
          syncReactions(src, out, names, since);
          out.prepare(
            "INSERT OR REPLACE INTO meta(key, value) VALUES ('maxReactionRowid', ?)"
          ).run(String(top));
        })();
      } catch {
        /* reactions are decoration — never block the sync */
      }
    };

    type NewRow = {
      id: number;
      text: string | null;
      attributedBody: Buffer | null;
      is_from_me: number;
      date: number;
      date_read: number;
      handle: string | null;
      chat_id: number;
    };
    const rows = src
      .prepare(
        `SELECT m.ROWID as id, m.text, m.attributedBody, m.is_from_me, m.date,
                m.date_read, h.id as handle, cmj.chat_id as chat_id
         FROM message m
         JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
         LEFT JOIN handle h ON h.ROWID = m.handle_id
         WHERE m.ROWID > ?
           AND COALESCE(m.associated_message_type, 0) = 0
           AND COALESCE(m.item_type, 0) = 0
         ORDER BY m.ROWID ASC LIMIT 500`
      )
      .all(maxRowid) as NewRow[];
    if (rows.length === 0) {
      runReactions();
      return 0;
    }
    if (!contactsCache) contactsCache = loadContacts();
    const contacts = contactsCache;

    const chatStmt = src.prepare(
      "SELECT ROWID as rowid, guid, chat_identifier, display_name, style FROM chat WHERE ROWID = ?"
    );
    const partStmt = src.prepare(
      `SELECT h.id as handle FROM chat_handle_join chj
       JOIN handle h ON h.ROWID = chj.handle_id WHERE chj.chat_id = ?`
    );
    const attStmt = src.prepare(
      `SELECT a.ROWID as id, a.filename, a.mime_type, a.transfer_name
       FROM message_attachment_join maj JOIN attachment a ON a.ROWID = maj.attachment_id
       WHERE maj.message_id = ?`
    );
    const threadExists = out.prepare("SELECT 1 FROM threads WHERE id = ?");
    const insertThread = out.prepare(
      "INSERT OR IGNORE INTO threads(id, name, participants, is_group) VALUES (?, ?, ?, ?)"
    );
    const insertMsg = out.prepare(
      "INSERT OR IGNORE INTO messages(id, thread_id, sender, is_from_me, date, text, date_read) VALUES (?, ?, ?, ?, ?, ?, ?)"
    );
    const insertFts = out.prepare("INSERT INTO messages_fts(rowid, text) VALUES (?, ?)");
    const insertAtt = out.prepare(
      "INSERT OR IGNORE INTO attachments(id, message_id, path, mime, name) VALUES (?, ?, ?, ?, ?)"
    );

    const touched = new Set<string>();
    // New messages worth embedding, collected during the transaction and
    // handled after it commits — embedding is async and must not hold a write
    // lock open on the index.
    const fresh: { id: number; text: string; threadId: string }[] = [];
    const apply = out.transaction(() => {
      for (const row of rows) {
        if (row.id > maxRowid) maxRowid = row.id;
        const chat = chatStmt.get(row.chat_id) as
          | { rowid: number; guid: string; chat_identifier: string | null; display_name: string | null; style: number }
          | undefined;
        if (!chat) continue;
        const isGroup = chat.style === 43;
        const identifier = chat.chat_identifier ?? chat.guid;
        const threadId = isGroup ? `group:${chat.guid}` : `direct:${identifier}`;
        if (!threadExists.get(threadId)) {
          const handles = (partStmt.all(chat.rowid) as { handle: string }[]).map((h) => h.handle);
          const names = (handles.length ? handles : [identifier]).map((h) => resolveName(h, contacts.names));
          insertThread.run(
            threadId,
            isGroup
              ? chat.display_name?.trim() || names.slice(0, 4).join(", ")
              : names[0] ?? formatIdentifier(identifier),
            JSON.stringify(names),
            isGroup ? 1 : 0
          );
        }
        const text = extractText(row.text, row.attributedBody);
        const atts = (attStmt.all(row.id) as AttRow[]).filter(displayableAttachment);
        if (!text && atts.length === 0) continue;
        insertMsg.run(
          row.id,
          threadId,
          row.is_from_me || !row.handle ? "" : resolveName(row.handle, contacts.names),
          row.is_from_me ? 1 : 0,
          appleToUnixMs(row.date),
          text ?? "",
          row.is_from_me ? appleToUnixMs(row.date_read) : 0
        );
        if (text) {
          insertFts.run(row.id, text);
          fresh.push({ id: row.id, text, threadId });
        }
        for (const a of atts) {
          insertAtt.run(a.id, row.id, expandHome(a.filename!), attMime(a), attName(a));
        }
        touched.add(threadId);
        added++;
      }
      for (const id of touched) {
        out.prepare(
          `UPDATE threads SET
             message_count = (SELECT COUNT(*) FROM messages m WHERE m.thread_id = ?),
             last_date = COALESCE((SELECT MAX(date) FROM messages m WHERE m.thread_id = ?), 0),
             last_text = COALESCE((SELECT text FROM messages m WHERE m.thread_id = ? ORDER BY date DESC LIMIT 1), '')
           WHERE id = ?`
        ).run(id, id, id, id);
      }
      out.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('maxMsgRowid', ?)").run(String(maxRowid));
      if (added > 0) {
        out.prepare("INSERT OR REPLACE INTO meta(key, value) VALUES ('lastSync', ?)").run(String(Date.now()));
      }
    });
    apply();
    runReactions();
    if (fresh.length) void embedFresh(fresh);
  } finally {
    src.close();
    out.close();
  }
  return added;
}

// Keep already-embedded threads current as new texts arrive. Threads the user
// never embedded are skipped entirely, so for most people this does
// nothing; for the handful they use, a tick is a few messages and takes
// milliseconds. Fire-and-forget — a live tick must never wait on it.
async function embedFresh(rows: { id: number; text: string; threadId: string }[]) {
  try {
    const { caughtUpThreads, embedNewMessages } = await import("./embeddings");
    const active = new Set(caughtUpThreads());
    if (!active.size) return;
    const todo = rows.filter((r) => active.has(r.threadId));
    if (todo.length) await embedNewMessages(todo);
  } catch {
    // Semantic search going stale is survivable; a broken sync is not.
  }
}
