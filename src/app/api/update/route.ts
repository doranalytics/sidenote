import { NextRequest, NextResponse } from "next/server";
import { exec, spawn } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { isDemo } from "@/lib/store";
import type { UpdateInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

const run = promisify(exec);
const REPO_API =
  "https://api.github.com/repos/doranalytics/sidenote/commits/main";

let cached: { at: number; body: UpdateInfo } | null = null;

async function check(fresh: boolean): Promise<UpdateInfo> {
  if (!fresh && cached && Date.now() - cached.at < 10 * 60_000) {
    return cached.body;
  }
  // Inside Sidenote.app there is no git checkout; the shell passes the
  // commit the bundle was built from through the environment.
  let current: string | null = process.env.SIDENOTE_COMMIT ?? null;
  let currentDate: string | null = process.env.SIDENOTE_COMMIT_DATE ?? null;
  if (!current) {
    try {
      const cwd = process.cwd();
      current = (await run("git rev-parse HEAD", { cwd })).stdout.trim();
      currentDate = (await run("git log -1 --format=%cs", { cwd })).stdout.trim();
    } catch {
      // not a git checkout — updates unavailable
    }
  }
  const isApp = process.env.SIDENOTE_APP === "1";
  let latest: string | null = null;

  // A .app install updates by downloading a new build, so the only version
  // that matters is the one behind the download button — published as
  // build.json when the app is built. Repo HEAD is the wrong comparison: it
  // moves on every docs or script commit, which made a freshly-downloaded app
  // announce an update to itself the moment it opened.
  if (isApp) {
    try {
      const r = await fetch("https://sidenote.lol/build.json", {
        signal: AbortSignal.timeout(6000),
        cache: "no-store",
      });
      if (r.ok) latest = ((await r.json()) as { commit?: string }).commit ?? null;
    } catch {
      // offline — no check, and no false alarm either
    }
    return finish(current, currentDate, latest, isApp);
  }

  // A git checkout genuinely does `git pull`, so main is the right target.
  try {
    const r = await fetch(REPO_API, {
      headers: { Accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (r.ok) latest = ((await r.json()) as { sha?: string }).sha ?? null;
  } catch {
    // offline — fine, we just can't check
  }
  let news: UpdateInfo["news"] = [];
  try {
    const r = await fetch("https://sidenote.lol/api/changelog", {
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (r.ok) {
      news = (((await r.json()) as { entries?: UpdateInfo["news"] }).entries ?? []).slice(0, 3);
    }
  } catch {
    // best effort
  }
  return finish(current, currentDate, latest, isApp, news);
}

function finish(
  current: string | null,
  currentDate: string | null,
  latest: string | null,
  isApp: boolean,
  news: UpdateInfo["news"] = []
): UpdateInfo {
  const body: UpdateInfo = {
    current,
    currentDate,
    latest,
    updateAvailable: !!(current && latest && current !== latest),
    managed: process.env.SIDENOTE_MANAGED === "1",
    app: isApp,
    news,
  };
  cached = { at: Date.now(), body };
  return body;
}

export async function GET(req: NextRequest) {
  if (isDemo) {
    return NextResponse.json({ error: "Only available when running locally." }, { status: 400 });
  }
  return NextResponse.json(
    await check(req.nextUrl.searchParams.get("fresh") === "1")
  );
}

// The Developer ID this app is signed with. A downloaded bundle is only
// installed if Gatekeeper accepts it AND it carries this team — otherwise a
// hijacked download would be enough to replace Sidenote with anything.
const TEAM_ID = "CUH66KFZ33";
const ZIP_URL = "https://sidenote.lol/Sidenote.zip";

/** Downloads the published build, checks its signature, and swaps it in.
 *
 *  Sending people to the website was the old behaviour, and it produced the
 *  worst possible outcome: they downloaded a new copy, double-clicked it, and
 *  landed back in the still-running old one — because LaunchServices will not
 *  start a second instance of a bundle id that is already running, so `open`
 *  simply focused the app they were trying to replace. Nothing looked broken,
 *  and nothing had changed. The swap therefore happens here, and the old
 *  process is killed before the new one is launched. */
async function installNewBuild() {
  const appPath = process.env.SIDENOTE_APP_PATH;
  if (!appPath || !fs.existsSync(appPath)) {
    return NextResponse.json({ ok: false, app: true, error: "notfound" });
  }
  const stage = path.join(os.homedir(), ".sidenote", "update");
  try {
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });

    const zip = path.join(stage, "Sidenote.zip");
    const res = await fetch(ZIP_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));

    await run(`/usr/bin/ditto -x -k "${zip}" "${stage}"`);
    const fresh = path.join(stage, "Sidenote.app");
    if (!fs.existsSync(fresh)) throw new Error("no app inside the download");

    // Gatekeeper first, then the team — accepted-but-someone-else's is still
    // a stranger's code.
    await run(`/usr/sbin/spctl -a -t exec "${fresh}"`);
    const { stdout } = await run(`/usr/bin/codesign -dv --verbose=2 "${fresh}" 2>&1`);
    if (!stdout.includes(`TeamIdentifier=${TEAM_ID}`)) {
      throw new Error("the download is signed by someone else");
    }

    const lsregister =
      "/System/Library/Frameworks/CoreServices.framework" +
      "/Frameworks/LaunchServices.framework/Support/lsregister";
    const exe = path.join(appPath, "Contents/MacOS/Sidenote");
    const stamp = Date.now();

    // Detached and in its own session: it outlives the app it is about to
    // quit, which includes this server.
    const log = fs.openSync(path.join(os.homedir(), ".sidenote", "update.log"), "a");
    spawn(
      "/bin/bash",
      [
        "-c",
        `
        sleep 1
        # Every running copy has to go before the new one can start.
        pkill -f "${exe}" 2>/dev/null
        for i in $(seq 1 60); do
          pgrep -f "${exe}" >/dev/null 2>&1 || break
          sleep 0.2
        done
        pkill -9 -f "${exe}" 2>/dev/null
        sleep 0.5
        # Keep the old bundle in the Trash rather than deleting it, so a bad
        # build is recoverable by hand.
        /bin/mv -f "${appPath}" "$HOME/.Trash/Sidenote-${stamp}.app" 2>/dev/null
        if ! /usr/bin/ditto "${fresh}" "${appPath}"; then
          /bin/mv -f "$HOME/.Trash/Sidenote-${stamp}.app" "${appPath}" 2>/dev/null
          /usr/bin/open -R "${fresh}"
          exit 1
        fi
        "${lsregister}" -f "${appPath}" 2>/dev/null
        for i in 1 2 3 4 5 6 7 8 9 10; do
          /usr/bin/open "${appPath}" 2>/dev/null
          sleep 1
          if pgrep -f "${exe}" >/dev/null 2>&1; then
            /bin/rm -rf "${stage}"
            exit 0
          fi
        done
        /usr/bin/open -R "${appPath}"
        `,
      ],
      { detached: true, stdio: ["ignore", log, log] }
    ).unref();

    cached = null;
    return NextResponse.json({ ok: true, app: true, relaunching: true });
  } catch (e) {
    fs.rmSync(stage, { recursive: true, force: true });
    return NextResponse.json({
      ok: false,
      app: true,
      error: (e as Error).message,
    });
  }
}

// Applies the update: pull, install, rebuild, then kick the LaunchAgent so
// launchd relaunches on the new build. Runs detached (its own session) so it
// survives the server it's about to restart.
export async function POST() {
  if (isDemo) {
    return NextResponse.json({ error: "Only available when running locally." }, { status: 400 });
  }
  if (process.env.SIDENOTE_APP === "1") return installNewBuild();
  if (process.env.SIDENOTE_MANAGED !== "1") {
    return NextResponse.json({ ok: false, managed: false });
  }
  const dir = process.cwd();
  const log = fs.openSync(path.join(dir, "sidenote.log"), "a");
  spawn(
    "/bin/bash",
    [
      "-c",
      `cd "${dir}" && git pull --ff-only && npm install --no-fund --no-audit --loglevel=error && npm run build && launchctl kickstart -k "gui/$(id -u)/lol.sidenote.app"`,
    ],
    { detached: true, stdio: ["ignore", log, log] }
  ).unref();
  cached = null;
  return NextResponse.json({ ok: true, managed: true });
}
