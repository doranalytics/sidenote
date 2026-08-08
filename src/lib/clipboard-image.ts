"use client";

// One place that knows how to get a pasted screenshot, shared by the message
// composer and the AI chat.
//
// Two problems it solves. First, WebKit doesn't put an image on
// clipboardData when focus is in a plain text input — which is where the
// cursor always is in both surfaces — so Cmd-V looked broken; the native shell
// reads NSPasteboard instead and answers on a global callback. Second, both
// surfaces can be on screen at once, and a single global callback can only
// have one owner, so handlers register here and the one whose container holds
// focus wins.

export type Pasted = { data: string; mime: string; url: string };

// Screenshots off a Retina display are routinely 3-5 MB, which is at or over
// what an API accepts and far more pixels than anything needs. Shrink the long
// edge to 1568px and re-encode.
const MAX_EDGE = 1568;

export async function shrink(file: File | Blob): Promise<Pasted> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { data: url.split(",")[1], mime: "image/jpeg", url };
}

function fromClipboard(dt: DataTransfer | null): File | null {
  if (!dt) return null;
  // WebKit surfaces a pasted screenshot through items; Chromium fills files.
  for (const item of Array.from(dt.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return Array.from(dt.files ?? []).find((f) => f.type.startsWith("image/")) ?? null;
}

type Entry = {
  container: () => HTMLElement | null;
  onImage: (p: Pasted) => void;
  onError: (message: string) => void;
};

const entries: Entry[] = [];
let installed = false;

type Bridge = { postMessage: (v: unknown) => void };
const shell = () =>
  window as unknown as {
    webkit?: { messageHandlers?: { clipboardImage?: Bridge } };
    __sidenoteClipboardImage?: (dataUrl: string | null) => void;
  };

/** The handler whose container currently holds focus, else the last registered
 *  one — which is the composer, since a thread is always open behind the AI
 *  panel. */
function target(): Entry | null {
  const active = document.activeElement;
  if (active) {
    for (const e of entries) {
      const el = e.container();
      if (el && el.contains(active)) return e;
    }
  }
  return entries[entries.length - 1] ?? null;
}

async function deliver(file: File | Blob) {
  const entry = target();
  if (!entry) return;
  try {
    entry.onImage(await shrink(file));
  } catch {
    entry.onError("Couldn't read that image.");
  }
}

function install() {
  if (installed) return;
  installed = true;

  shell().__sidenoteClipboardImage = (dataUrl) => {
    if (!dataUrl) return;
    fetch(dataUrl)
      .then((r) => r.blob())
      .then(deliver)
      .catch(() => target()?.onError("Couldn't read that image."));
  };

  document.addEventListener("paste", (e: ClipboardEvent) => {
    if (!entries.length) return;
    const file = fromClipboard(e.clipboardData);
    if (file) {
      e.preventDefault();
      void deliver(file);
      return;
    }
    // No image in the event. In WKWebView that's expected, so ask the shell to
    // read NSPasteboard. Never preventDefault here — text paste must still work.
    shell().webkit?.messageHandlers?.clipboardImage?.postMessage(null);
  });
}

/** Register a paste target. Returns an unsubscribe. */
export function registerPasteTarget(entry: Entry): () => void {
  install();
  entries.push(entry);
  return () => {
    const i = entries.indexOf(entry);
    if (i >= 0) entries.splice(i, 1);
  };
}
