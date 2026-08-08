"use client";

import { cn } from "@/lib/utils";

// Claude answers in markdown whether or not you ask it to, and both AI
// surfaces used to print the raw characters — "**her birthday**" with the
// asterisks showing. This renders the subset that actually turns up in a
// three-paragraph answer: headings, bullet and numbered lists, bold, italic,
// inline code, links, and fenced code.
//
// Deliberately hand-rolled rather than react-markdown: the Mac app bundles
// this server, every dependency is weight in the .app, and the full CommonMark
// surface is not what a chat reply uses. Nothing here renders raw HTML, so a
// message that contains "<script>" stays text.

type Props = { text: string; className?: string };

/** Bold, italic, inline code, and links inside a single line. */
function inline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // One pass, alternating between the patterns, so nesting can't reorder them.
  const re =
    /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<>"')\]]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (tok.startsWith("`")) {
      out.push(
        <code
          key={key}
          className="rounded bg-black/[0.06] px-1 py-0.5 font-mono text-[0.9em] dark:bg-white/[0.12]"
        >
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**") || tok.startsWith("__")) {
      out.push(
        <strong key={key} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (tok.startsWith("[")) {
      const cut = tok.indexOf("](");
      out.push(
        <a
          key={key}
          href={tok.slice(cut + 2, -1)}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {tok.slice(1, cut)}
        </a>
      );
    } else if (tok.startsWith("http")) {
      out.push(
        <a
          key={key}
          href={tok}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2"
        >
          {tok}
        </a>
      );
    } else {
      out.push(<em key={key}>{tok.slice(1, -1)}</em>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text, className }: Props) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code. An unterminated fence still renders — answers stream in, so
    // a half-written block is the normal case, not an error.
    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++; // closing fence
      blocks.push(
        <pre
          key={key++}
          className="overflow-x-auto rounded-lg bg-black/[0.06] p-2.5 font-mono text-[0.85em] dark:bg-white/[0.08]"
        >
          <code>{body.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      blocks.push(
        <p key={key++} className="font-semibold">
          {inline(heading[2], `h${key}`)}
        </p>
      );
      i++;
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        i++;
      }
      const ListTag = ordered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={key++}
          className={cn("space-y-0.5 pl-[1.15em]", ordered ? "list-decimal" : "list-disc")}
        >
          {items.map((it, n) => (
            <li key={n}>{inline(it, `li${key}-${n}`)}</li>
          ))}
        </ListTag>
      );
      continue;
    }

    if (!line.trim()) {
      i++;
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].trim().startsWith("```") &&
      !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) &&
      !/^#{1,4}\s+/.test(lines[i])
    ) {
      para.push(lines[i++]);
    }
    blocks.push(<p key={key++}>{inline(para.join("\n"), `p${key}`)}</p>);
  }

  return <div className={cn("space-y-2", className)}>{blocks}</div>;
}

/** The same text with the markup stripped, for copying into a plain-text
 *  place like an iMessage compose box. */
export function toPlainText(text: string): string {
  return text
    .replace(/```[^\n]*\n?/g, "")
    .replace(/^#{1,4}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/_([^_\n]+)_/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .trim();
}
