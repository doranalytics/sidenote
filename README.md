# Sidenote

The iMessage companion for your Mac. Search everything you've ever texted, pin
the messages worth remembering, keep notes on the people you care about, and
ask on-device AI about any thread.

**Get it:** https://sidenote.lol — the site is a live demo with
sample conversations plus a one-command installer. Sidenote itself runs 100%
locally; a web server can't (and shouldn't) read your Messages database.

## What it does

- **Sync** — copies `~/Library/Messages/chat.db` into a private index at
  `~/.sidenote/` (SQLite + FTS5 full-text search). Your Contacts database
  resolves phone numbers and emails into names. Nothing leaves your Mac.
- **Search** — instant full-text search across every conversation, or scoped
  to one thread. Click a result to jump to that exact moment in the chat.
- **Remember** — right-click any message → "Remember this." It's pinned beside
  your notes on that person; clicking it jumps back to its place in the thread.
- **Export** — copy or download a plain-text transcript of any conversation
  (pick a time range), ready to paste into any AI.
- **Explain this** — right-click any message and Sidenote decodes it: slang,
  references, tone, in-jokes, using the conversation around it. The answer
  appears in a popover on the message itself, with a follow-up box, so you
  stop copying texts into another app to work out what someone meant. Also
  **Look this up** (searches the web and your own history) and **Help me
  reply** (drafts a response in your voice).
- **Ask a thread** — questions search a conversation's entire history, not just
  the recent window. Keep as many separate AI chats per conversation as you
  like; they're saved and picked back up where you left them.
- **Embed a conversation** — optionally embed one thread so search finds things
  by meaning, not just wording ("money" finding "can you venmo me"). Runs on
  your Mac, takes about thirty seconds for a big thread, keeps going in the
  background if you close the panel, and stays current on its own. Nothing is
  embedded until you ask for it.
- **Kept** — notes, pinned messages, and AI chats are written to
  `~/.sidenote/vault.db`, separate from the message index. They survive
  quitting, re-syncing, and updating the app.

## Install

Paste this into Terminal:

```bash
curl -fsSL https://sidenote.lol/install.sh | bash
```

It installs to `~/Sidenote`, starts the app at http://localhost:4747, and opens
it in your browser. Then click **Sync your Messages**.

Two permissions matter:

1. **Full Disk Access** for your terminal app, so Sidenote can read the
   Messages database. The app's setup screen has a button that opens the exact
   System Settings pane — macOS requires you to flip the toggle yourself. The
   grant goes to your terminal app on your Mac, never to any cloud service.
2. **An Anthropic API key** (optional, for AI): paste one into Settings › AI.
   Explaining a message costs a fraction of a cent; searching the web costs
   about a cent and only happens when you tap it. Without a key, everything
   else — sync, search, notes, pins, export — works normally.

`ANTHROPIC_API_KEY` in the environment overrides the key stored in Settings.

## Privacy

Sidenote is read-only over your Messages data. Your archive is indexed,
searched, and embedded entirely on your Mac: the message index lives in
`~/.sidenote/index.db`, semantic vectors in `~/.sidenote/vectors.db`, and your
notes, pinned messages, and AI chats in `~/.sidenote/vault.db`.

The one exception is AI, and it is opt-in and narrow. When you ask about a
message, Sidenote sends that message and roughly forty around it to Anthropic
to answer — nothing more, and only at the moment you ask. Tapping **Search the
web** additionally sends the search terms Claude writes. Your API key is stored
in the vault and never leaves your machine. With no key configured, no message
ever goes anywhere.

**Analytics.** Sidenote reports anonymous usage from the app: that it opened,
that a sync finished and how many messages it covered, that a conversation was
embedded, that a search ran and how many results it returned, and what each AI
call cost. It is keyed to a random per-install id, not to you.

It never includes message text, contact names, phone numbers, thread names,
note contents, or search queries — only counts, durations, and feature names.
All of it goes through `src/lib/analytics.ts` and the AI relay, so there is
exactly one place to audit. The website (sidenote.lol) uses ordinary web
analytics; the app does not load any tracking script into its own pages.

The deployed demo contains only fictional sample data and stores its throwaway
notes in the browser.
