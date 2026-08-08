import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { getThread, isDemo } from "@/lib/store";

export const dynamic = "force-dynamic";

const run = promisify(execFile);

// Sends through the real Messages app via AppleScript, so texts come from the
// user's own number. First use triggers macOS's Automation permission prompt.
//
// Attachments go as a POSIX file: Messages reads it off disk when it sends, so
// the file has to still exist at that moment — it's written to an outbox and
// swept later rather than deleted straight after the call returns.
const SCRIPT = `
on run argv
  set theText to item 1 of argv
  set theKind to item 2 of argv
  set theTarget to item 3 of argv
  set theFile to item 4 of argv
  tell application "Messages"
    if theKind is "group" then
      set theChat to chat id theTarget
      if theFile is not "" then send (POSIX file theFile) to theChat
      if theText is not "" then send theText to theChat
    else
      try
        set theBuddy to participant theTarget of (1st account whose service type = iMessage and enabled is true)
      on error
        set theBuddy to participant theTarget of (1st account whose enabled is true)
      end try
      if theFile is not "" then send (POSIX file theFile) to theBuddy
      if theText is not "" then send theText to theBuddy
    end if
  end tell
end run`;

const OUTBOX = path.join(os.homedir(), ".sidenote", "outbox");
const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
};

/** Remove anything left over from earlier sends. Messages has long since read
 *  them, and this is the user's own screenshot sitting on disk. */
function sweepOutbox() {
  try {
    const cutoff = Date.now() - 60 * 60 * 1000;
    for (const name of fs.readdirSync(OUTBOX)) {
      const file = path.join(OUTBOX, name);
      if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
    }
  } catch {
    // nothing to sweep
  }
}

export async function POST(req: NextRequest) {
  if (isDemo) {
    return NextResponse.json(
      { error: "Sending works when Sidenote runs on your Mac." },
      { status: 400 }
    );
  }
  const body = (await req.json()) as {
    threadId?: string;
    text?: string;
    image?: { data: string; mime: string };
  };
  const text = body.text?.trim() ?? "";
  const image = body.image && EXT[body.image.mime] ? body.image : undefined;
  if (!body.threadId || (!text && !image)) {
    return NextResponse.json({ error: "Nothing to send." }, { status: 400 });
  }
  if (!getThread(body.threadId)) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  const [kind, target] = body.threadId.startsWith("group:")
    ? ["group", body.threadId.slice("group:".length)]
    : ["direct", body.threadId.slice("direct:".length)];

  let filePath = "";
  if (image) {
    try {
      fs.mkdirSync(OUTBOX, { recursive: true });
      sweepOutbox();
      filePath = path.join(OUTBOX, `paste-${Date.now()}.${EXT[image.mime]}`);
      fs.writeFileSync(filePath, Buffer.from(image.data, "base64"));
    } catch {
      return NextResponse.json({ error: "Couldn't prepare that image." }, { status: 500 });
    }
  }

  try {
    await run("osascript", ["-e", SCRIPT, text, kind, target, filePath], {
      timeout: 30000,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = (e as Error).message ?? "";
    const friendly = msg.includes("1743")
      ? "macOS blocked Sidenote from controlling Messages. Allow it in System Settings → Privacy & Security → Automation, then try again."
      : "Couldn't send — make sure the Messages app is signed in.";
    return NextResponse.json({ error: friendly }, { status: 502 });
  }
}
