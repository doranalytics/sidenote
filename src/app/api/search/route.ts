import { NextRequest, NextResponse } from "next/server";
import { track } from "@/lib/analytics";
import { search } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = sp.get("q") ?? "";
  const threadId = sp.get("threadId") ?? undefined;
  const results = search(q, threadId);
  // Length and hit count only — the query itself is the user's private text
  // and never leaves the machine.
  if (q.trim().length > 2) {
    track("search_performed", {
      query_length: q.trim().length,
      results: results.length,
      scoped_to_thread: !!threadId,
    });
  }
  return NextResponse.json({ results });
}
