// Usage and cost telemetry for the AI relay.
//
// Measured server-side, on the way back from Anthropic, because that's the only
// place that sees every call and can't be under-reported by a client. Each
// event carries the install that made the call and the feature that triggered
// it, which is what turns "the bill was 18 cents" into "explain is 0.2c and
// look-up is 1.4c, and install X spent most of it".

const POSTHOG_HOST = process.env.POSTHOG_HOST ?? "https://us.i.posthog.com";

// Claude Haiku 4.5, USD per token. Cache reads are a tenth of input; writes a
// quarter more. Web search is billed per call, not per token.
const PRICE = {
  input: 1 / 1_000_000,
  output: 5 / 1_000_000,
  cacheWrite: 1.25 / 1_000_000,
  cacheRead: 0.1 / 1_000_000,
  webSearch: 10 / 1000,
};

export type Usage = {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  webSearches: number;
};

export const emptyUsage = (): Usage => ({
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  webSearches: 0,
});

export function costOf(u: Usage): number {
  return (
    u.input * PRICE.input +
    u.output * PRICE.output +
    u.cacheWrite * PRICE.cacheWrite +
    u.cacheRead * PRICE.cacheRead +
    u.webSearches * PRICE.webSearch
  );
}

type UsageBlock = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
};

function absorb(u: Usage, block: UsageBlock | undefined) {
  if (!block) return;
  // message_start carries input; message_delta carries the final output count.
  u.input += block.input_tokens ?? 0;
  u.output = block.output_tokens ?? u.output;
  u.cacheWrite += block.cache_creation_input_tokens ?? 0;
  u.cacheRead += block.cache_read_input_tokens ?? 0;
  u.webSearches += block.server_tool_use?.web_search_requests ?? 0;
}

/** Reads a copy of the SSE stream purely to total up usage. */
export async function meterStream(body: ReadableStream<Uint8Array>): Promise<Usage> {
  const usage = emptyUsage();
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const j = JSON.parse(line.slice(6)) as {
            type?: string;
            message?: { usage?: UsageBlock };
            usage?: UsageBlock;
          };
          if (j.type === "message_start") absorb(usage, j.message?.usage);
          else if (j.type === "message_delta") absorb(usage, j.usage);
        } catch {
          // partial or non-JSON line — the next chunk completes it
        }
      }
    }
  } catch {
    // a dropped connection just means partial numbers; report what we have
  }
  return usage;
}

/** Non-streaming responses put usage straight in the JSON body. */
export function meterJson(text: string): Usage {
  const usage = emptyUsage();
  try {
    absorb(usage, (JSON.parse(text) as { usage?: UsageBlock }).usage);
  } catch {
    /* not JSON */
  }
  return usage;
}

export async function report(event: {
  installId: string;
  code: string;
  fn: string;
  model: string;
  usage: Usage;
  ms: number;
  status: number;
}) {
  const key = process.env.POSTHOG_KEY;
  if (!key) return; // telemetry is optional; never let it break a request
  const cost = costOf(event.usage);
  try {
    await fetch(`${POSTHOG_HOST}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(4000),
      body: JSON.stringify({
        api_key: key,
        event: "ai_call",
        // One person = one install, so usage and cost group by this directly.
        distinct_id: event.installId,
        properties: {
          $process_person_profile: false,
          invite_code: event.code,
          feature: event.fn,
          model: event.model,
          status: event.status,
          duration_ms: event.ms,
          input_tokens: event.usage.input,
          output_tokens: event.usage.output,
          cache_write_tokens: event.usage.cacheWrite,
          cache_read_tokens: event.usage.cacheRead,
          web_searches: event.usage.webSearches,
          // Sub-cent costs, so keep enough precision to sum thousands of them.
          cost_usd: Number(cost.toFixed(6)),
          cost_cents: Number((cost * 100).toFixed(4)),
        },
      }),
    });
  } catch {
    // never surface a telemetry failure to the user
  }
}
