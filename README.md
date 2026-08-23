# Sidenote

The iMessage companion for your Mac. Search everything you've ever texted, pin
the messages worth remembering, keep notes on the people you care about, and
ask on-device AI about any thread.

**Get it:** https://sidenote.lol — $39 once for the app; AI is an optional
$10/month you turn on from inside it. The site has a live demo with sample
conversations. Sidenote itself runs 100% locally; a web server can't (and
shouldn't) read your Messages database.

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

Buy it at https://sidenote.lol → download the DMG → drag Sidenote to
Applications → open it. It updates itself after that. Bought it already and
lost the file? https://sidenote.lol/download — sign in with the purchase
email (a 6-digit code arrives by email) and download again.

Two things matter after it opens:

1. **Full Disk Access**, so Sidenote can read the Messages database. The
   app's setup screen has a button that opens the exact System Settings pane
   — macOS requires you to flip the toggle yourself. The grant goes to
   Sidenote on your Mac, never to any cloud service.
2. **AI (optional, $10/month)**: Settings → AI → sign in with the email you
   bought with → Turn on AI. Checkout opens in your browser; come back and AI
   is on. Manage or cancel from the same place. Without it, everything else —
   sync, search, notes, pins, export — works normally.

Power users can still paste their own Anthropic key into Settings (or set
`ANTHROPIC_API_KEY`); that bypasses the subscription and bills Anthropic
directly. Running from a git checkout (`npm run dev`) works too, but AI still
needs an account.

### How the paywall is wired (for whoever maintains this)

- **Stripe** (doranalytics account): products "Sidenote for Mac" ($39 once)
  and "Sidenote AI" ($10/month). `/api/checkout` starts either; the webhook at
  `/api/stripe/webhook` mirrors purchases and subscription state into
  Supabase. Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
  `STRIPE_PRICE_APP`, `STRIPE_PRICE_AI` (test keys on Preview, live on
  Production).
- **Supabase** (project `sidenote`, ref `dvmpjltqemrrrbrbmnhf`): table
  `purchases` (kind `app` | `ai`), table `downloads`, private bucket
  `releases` holding `Sidenote.dmg` / `Sidenote.zip`. Auth is email OTP; the
  code template is `supabase/templates/signin-code.html`. Env: `SUPABASE_URL`,
  `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Migrations in
  `supabase/migrations`; `supabase db push` / `supabase config push`.
- **Tokens** (`src/lib/access.ts`): install tokens `v2.<install>.<user>.<sig>`
  (what the app keeps; sent to the AI relay and the updater endpoint) and
  24-hour download tokens. Legacy invite tokens (`v1.…`) still verify.
- **Releases**: `scripts/release.sh` uploads to the private bucket. Pass
  `--github` only for the one transition build that pre-paywall installs
  update from.
- **Letting someone in by hand**: `node scripts/grant.mjs <email>`.
- Supabase's built-in mailer is rate-limited (a handful of emails per hour).
  Before real volume, put custom SMTP (Resend etc.) in `supabase/config.toml`
  under `[auth.email.smtp]` and push.

## Privacy

Sidenote is read-only over your Messages data. Your archive is indexed,
searched, and embedded entirely on your Mac: the message index lives in
`~/.sidenote/index.db`, semantic vectors in `~/.sidenote/vectors.db`, and your
notes, pinned messages, and AI chats in `~/.sidenote/vault.db`.

The one exception is AI, and it is opt-in and narrow. When you ask about a
message, Sidenote sends that message and roughly forty around it — via a relay
on sidenote.lol that holds the Anthropic key, or straight to Anthropic if you
supplied your own — to get an answer. Nothing more, and only at the moment you
ask. Tapping **Search the web** additionally sends the search terms Claude
writes. The relay meters tokens per install for cost; it never stores message
content. With AI off, no message ever goes anywhere.

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
