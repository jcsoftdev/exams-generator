/**
 * Events surfaced while parsing OpenRouter's SSE stream (chat-completions
 * with `stream: true`). Wire format: `data: {...}` lines, `: OPENROUTER
 * PROCESSING` keep-alive comments (ignored per SSE spec), terminated by
 * `data: [DONE]`. Each JSON chunk's incremental text lives at
 * `choices[0].delta.content`; a chunk can also report
 * `choices[0].finish_reason === "error"` mid-stream.
 */
export type OpenRouterSseEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "done" }
  | { readonly type: "error"; readonly message: string };

export interface ParsedOpenRouterSseBuffer {
  readonly events: readonly OpenRouterSseEvent[];
  readonly remainder: string;
}

interface OpenRouterStreamChunk {
  readonly choices?: ReadonlyArray<{
    readonly delta?: { readonly content?: unknown };
    readonly finish_reason?: unknown;
  }>;
}

/**
 * Stateless: `buffer` must be the UNCONSUMED tail from the previous call
 * (`remainder`) plus whatever new bytes just arrived, decoded to text. SSE
 * frames are separated by a blank line (`\n\n`) — a frame split across two
 * network chunks is incomplete until enough text has accumulated, so any
 * trailing partial frame is returned as `remainder` instead of being parsed.
 */
export function parseOpenRouterSseBuffer(buffer: string): ParsedOpenRouterSseBuffer {
  const frames = buffer.split("\n\n");
  const remainder = frames.pop() ?? "";
  const events: OpenRouterSseEvent[] = [];

  for (const frame of frames) {
    for (const rawLine of frame.split("\n")) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith(":")) {
        continue;
      }
      if (!line.startsWith("data:")) {
        continue;
      }

      const payload = line.slice("data:".length).trim();
      if (payload === "[DONE]") {
        events.push({ type: "done" });
        continue;
      }

      let json: OpenRouterStreamChunk;
      try {
        json = JSON.parse(payload) as OpenRouterStreamChunk;
      } catch {
        continue;
      }

      const choice = json.choices?.[0];
      const content = choice?.delta?.content;
      if (typeof content === "string" && content.length > 0) {
        events.push({ type: "delta", text: content });
      }
      if (choice?.finish_reason === "error") {
        events.push({
          type: "error",
          message: "OpenRouter stream reported finish_reason=error",
        });
      }
    }
  }

  return { events, remainder };
}
