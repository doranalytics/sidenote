export type Thread = {
  id: string;
  name: string;
  participants: string[];
  isGroup: boolean;
  lastDate: number; // unix ms
  lastText: string;
  messageCount: number;
};

export type Attachment = {
  id: number;
  mime: string;
  name: string;
};

/** A tapback. `emoji` is what to draw; `kind` is the six built-in slots plus
 *  "emoji" for the free-form ones macOS 14 added. */
export type Reaction = {
  kind: string;
  emoji: string;
  sender: string; // display name ("" when from me)
  isFromMe: boolean;
};

export type Message = {
  id: number;
  threadId: string;
  sender: string; // display name of sender ("" when from me)
  isFromMe: boolean;
  date: number; // unix ms
  text: string; // "" for attachment-only messages
  dateRead?: number; // unix ms — when the recipient read it (outgoing only)
  attachments?: Attachment[];
  reactions?: Reaction[];
};

export type SearchResult = {
  message: Message;
  threadName: string;
  snippet: string;
};

export type AppStatus = {
  mode: "demo" | "local";
  synced: boolean;
  lastSync: number | null;
  threadCount: number;
  messageCount: number;
  ai: {
    configured: boolean; // an Anthropic API key is saved
  };
  engine?: string; // what macOS lists under Full Disk Access: the app bundle, or the node binary
  translocated?: boolean; // running from a temporary copy, where an FDA grant can't persist
};

export type UpdateInfo = {
  current: string | null; // installed git sha
  currentDate: string | null; // installed commit date (YYYY-MM-DD)
  latest: string | null; // newest sha on GitHub main
  updateAvailable: boolean;
  managed: boolean; // running under the LaunchAgent (can self-update)
  app: boolean; // running inside Sidenote.app (updates ship as a new download)
  news: { date: string; title: string; points: string[] }[];
};
