// One entry per shipped batch of features, newest first. The landing page
// renders this directly; installed apps read it from sidenote.lol via
// /api/changelog so update prompts can say what's actually new.

export type ChangelogEntry = {
  date: string; // display form, e.g. "Aug 5, 2026"
  title: string;
  points: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "Aug 23, 2026",
    title: "Sidenote has an account now — and AI is built in",
    points: [
      "Unlock once by signing in with the email you got Sidenote with — a 6-digit code arrives by email, no password, and this Mac stays unlocked",
      "AI no longer needs your own API key: turn it on in Settings → AI ($10/month, cancel any time) and Explain, Look up, Reply drafts, and Ask-a-thread just work",
      "Manage or cancel the AI subscription right from Settings; your own Anthropic key still works as before if you prefer it",
      "Download your copy again any time at sidenote.lol/download — sign in with the same email",
      "Existing invite-code users: nothing changes for you — your access carries over, no account needed",
    ],
  },
  {
    date: "Aug 8, 2026",
    title: "Right-click any message and ask what it means",
    points: [
      "“Explain this” decodes slang, references, and tone using the messages around it — the answer opens right on the bubble, with a follow-up box",
      "“Look this up” identifies a name, band, place, or event; “Help me reply” drafts a response in your voice",
      "Questions about a thread now search its entire history instead of the last few days",
      "Embed a conversation to make search find things by meaning, not just wording — runs on your Mac, keeps going in the background, and stays current on its own",
      "AI now runs on Claude with your own Anthropic key (Settings › AI); the 17 GB local model is gone",
      "Paste a screenshot into the AI chat and ask about it",
      "sidenote.lol is the homepage again — the live demo has its own page, and Sidenote opens as a Mac app rather than a browser tab",
      "The update banner can be dismissed, and points at the download when a new version ships",
    ],
  },
  {
    date: "Aug 6, 2026",
    title: "Full Disk Access setup that actually works",
    points: [
      "Sidenote offers to move itself into Applications on first open — one click",
      "Opened straight from the download, macOS runs apps from a temporary copy where the permission can never stick; Sidenote now spots that and says so",
      "The setup steps point at Sidenote itself in the permission list, not the engine file inside it",
      "Fixed the setup panel spilling outside its window",
    ],
  },
  {
    date: "Aug 6, 2026",
    title: "Sidenote is now a real Mac app",
    points: [
      "Download it from sidenote.lol, drag it into Applications, done — no Terminal, no installer command",
      "Signed and notarized by Apple's checks, with its own window, Dock icon, and ⌘-Tab presence",
      "At the time, everything ran on your Mac including AI, through a local Ollama model — replaced on Aug 8, 2026",
      "Already installed the Terminal way? The app takes over seamlessly — your synced messages stay put",
    ],
  },
  {
    date: "Aug 6, 2026",
    title: "Contact photos and read receipts",
    points: [
      "Your contacts' real photos now appear on threads — in the list, chat headers, and search",
      "Group chats show each sender's photo next to their messages",
      "Sent messages show “Read” with the time once the other person has seen them",
      "Photos come straight from your Mac's Contacts during sync — nothing to set up",
    ],
  },
  {
    date: "Aug 6, 2026",
    title: "Live threads, sending, and photos",
    points: [
      "New texts appear on their own, seconds after they arrive — no Sync button",
      "Reply right from Sidenote: messages send through your real iMessage account",
      "Photos and attachments now show up in conversations (HEIC included)",
      "Links get rich previews with images, like the real Messages app",
    ],
  },
  {
    date: "Aug 5, 2026",
    title: "Sidenote updates itself",
    points: [
      "An update banner appears in the app whenever a new version ships",
      "One click in Settings pulls, rebuilds, and relaunches — no Terminal",
      "What's-new notes right here on the homepage",
    ],
  },
  {
    date: "Aug 5, 2026",
    title: "Ask AI sees your whole history",
    points: [
      "Questions now search the entire conversation — years back, not just recent texts",
      "Exports no longer have a size limit: the full thread, however big",
      "A bigger recent-context window for summaries and answers",
    ],
  },
  {
    date: "Aug 5, 2026",
    title: "Way easier setup",
    points: [
      "Full Disk Access is now a guided two-step: flip one switch, click restart",
      "Sidenote starts at login and keeps running",
      "In-app Settings, with sync status at a glance",
    ],
  },
];
