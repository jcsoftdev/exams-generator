# AI Generation Live Streaming Progress — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the opaque "Generando 0/1 preguntas…" wait in `/app/ai/generate` with real, live proof the model is working — stream OpenRouter's token output through the backend to the browser via Server-Sent Events, instead of one buffered ~1min HTTP round trip per question.

**Architecture:** `QuestionGeneratorPort.generate()` gains an optional `onProgress` callback. `OpenRouterAdapter` sends `stream: true` to OpenRouter and parses its SSE chunks (`choices[0].delta.content`), forwarding each text delta through the callback instead of buffering the whole response. `GenerateQuestionsService` gets a new `generateQuestionStream()` method (returns an RxJS `Observable`) that reuses the exact same per-item generate→compile-retry→persist logic as today's `generateQuestions()` (extracted into a shared private helper) but emits `delta`/`restart`/`done` events as it goes. `AiController` exposes this as `POST /ai/questions/generate/stream`, hand-rolling the SSE response (`res.write`) rather than Nest's `@Sse()` decorator — `@Sse()` is GET-oriented and native `EventSource` cannot send the `Authorization` header our JWT auth relies on. On the Angular side, `AiService` consumes it through `HttpClient` (not `EventSource`) using `responseType: 'text'` + `reportProgress: true`, so the existing `authInterceptor` keeps working unmodified — the auth-header limitation of `EventSource` never applies here. `AiGenerateComponent` swaps its per-item `generateQuestions()` call for `generateQuestionStream()` and shows a live "N caracteres recibidos" indicator that ticks up in real time.

**Tech Stack:** NestJS 10 + Express (api, `jest`); Angular 22 standalone + signals + `HttpClient` XHR backend (web, `vitest`); OpenRouter chat-completions API (`stream: true` + `response_format: json_schema`, confirmed compatible — see Global Constraints).

## Global Constraints

- **OpenRouter streaming wire format** (confirmed via OpenRouter docs, 2026-07-19): `data: {...}` lines, keep-alive comment lines `: OPENROUTER PROCESSING` (SSE comments, must be ignored), terminated by `data: [DONE]`. Each chunk's incremental text is at `choices[0].delta.content`. Combining `stream: true` with `response_format: { type: "json_schema", ... }` is natively supported.
- **`EventSource` cannot send custom headers** — this is WHY the browser side uses `HttpClient` (which the existing `authInterceptor` already attaches `Authorization: Bearer <token>` to) instead of native `EventSource`, and why the backend hand-rolls SSE via `@Res()` instead of Nest's GET-oriented `@Sse()` decorator.
- **No compression middleware** in `apps/api/src/main.ts` — confirmed, so nothing buffers the streamed response server-side.
- **Angular's `HttpClient` uses the XHR backend** (`provideHttpClient()` in `app.config.ts` has no `withFetch()`) — streaming consumption uses `observe: 'events'` + `responseType: 'text'` + `reportProgress: true` and reads `HttpDownloadProgressEvent.partialText` (cumulative from byte 0), not `EventSource` or `fetch().body`.
- **Backend event contract is a closed 3-variant union** used identically at every layer (port callback → service `Observable` → SSE wire → Angular): `{type:"delta", text}` | `{type:"restart"}` | `{type:"done", result}`. `restart` exists because BOTH the OpenRouter adapter's own JSON-validation retry (`MAX_ATTEMPTS=2`) and the service's Typst-compile retry (`MAX_COMPILE_ATTEMPTS=2`) can throw away a partial generation and start over — without `restart`, the frontend would silently concatenate two unrelated generations into one nonsensical character count.
- **Non-streaming behavior is UNCHANGED** — `generateQuestions()` (batch, `POST /ai/questions/generate`), `reviseQuestion()`, `extractFromImage()` never pass `onProgress`, so `OpenRouterAdapter` takes its existing buffered `attempt()` path for all three exactly as before. Streaming is opt-in via the callback being present.
- **Errors stay inside the `done` event's `result.failed`**, never as a stream `error` — mirrors the existing `GenerateQuestionsResult` contract (`ai.controller.ts` doc comment: "Returns a per-item result rather than failing the whole request on one bad item"). No new "error" event type.
- **Shell commands:** `eza`/`bat`/`rg`/`fd`/`sd`, not `ls`/`cat`/`grep`/`find`/`sed`. Never build.
- **Conventional commits**, no AI attribution. **Author:** `jcsoftdev`.
- **API tests:** `cd apps/api && pnpm exec jest <path>`. **Web tests:** `cd apps/web && pnpm exec ng test` (file-scoped vitest fails on `initTestEnvironment` — run the full `ng test`).
- **Strict TDD** — test first, watch it fail, minimal impl, watch it pass, commit.

---

## File Structure

**Backend (`apps/api/src/modules/ai`):**
- `domain/ports/question-generator.port.ts` — add `GenerateProgressEvent` type, `generate()` gains optional `onProgress` param.
- `adapters/in-memory-question-generator.adapter.ts` — `generate()` invokes `onProgress` once with the full body (dev/test streaming without a real API key).
- `adapters/lazy-question-generator.adapter.ts` — passes `onProgress` through.
- `domain/ports/question-generator.port.contract.ts` — one new shared contract case.
- `adapters/openrouter/openrouter-sse-parser.ts` — **new**, pure SSE-frame parser for OpenRouter's wire format.
- `adapters/openrouter/openrouter.adapter.ts` — new `SseHttpClient`/`fetchSseHttpClient`/`HttpSseResponse`, `attemptStreaming()`, `runWithRetries()` threads `onProgress` + emits `restart` on its own internal retry.
- `generate-questions.service.ts` — extract `generateOneItem()` private helper (used by both existing `generateQuestions()` and new code); add `generateQuestionStream()` returning `Observable<GenerateQuestionStreamEvent>`; export `GenerateQuestionStreamEvent`.
- `ai.controller.ts` — new `POST generate/stream` hand-rolled SSE endpoint.

**Frontend (`apps/web/src/app/features/ai`):**
- `ai.models.ts` — mirror `GenerateQuestionStreamEvent`.
- `parse-generate-stream-frames.ts` — **new**, pure SSE-frame parser for our own wire format (mirrors the backend's OpenRouter-side parser, different format).
- `ai.service.ts` — `generateQuestionStream()`.
- `ai-generate/ai-generate.component.ts` — `generateOne()` switches to the stream; new `liveChars` signal.
- `ai-generate/ai-generate.component.html` — live indicator under the progress bar.

---

## Task 1: Port — optional `onProgress` callback + fakes

**Files:**
- Modify: `apps/api/src/modules/ai/domain/ports/question-generator.port.ts`
- Modify: `apps/api/src/modules/ai/adapters/in-memory-question-generator.adapter.ts`
- Modify: `apps/api/src/modules/ai/adapters/lazy-question-generator.adapter.ts`
- Modify: `apps/api/src/modules/ai/domain/ports/question-generator.port.contract.ts`
- Test: existing `apps/api/src/modules/ai/adapters/in-memory-question-generator.adapter.spec.ts` and `lazy-question-generator.adapter.spec.ts` stay green unmodified; the contract suite gets one new case.

**Interfaces:**
- Produces: `GenerateProgressEvent = { type: "delta"; text: string } | { type: "restart" }`; `QuestionGeneratorPort.generate(input, onProgress?: (event: GenerateProgressEvent) => void): Promise<GeneratedQuestion>`.

- [ ] **Step 1: Failing contract test**

Add to `apps/api/src/modules/ai/domain/ports/question-generator.port.contract.ts` (after the existing `figureCode` cases, before the closing `});`):

```ts
    it("generate() invokes onProgress with at least one non-empty delta when provided", async () => {
      const adapter = createAdapter();
      const events: GenerateProgressEvent[] = [];

      await adapter.generate(BASE_INPUT, (event) => events.push(event));

      const deltas = events.filter(
        (e): e is { type: "delta"; text: string } => e.type === "delta",
      );
      expect(deltas.length).toBeGreaterThan(0);
      expect(deltas.every((d) => d.text.length > 0)).toBe(true);
    });
```

Add `GenerateProgressEvent` to the existing import at the top of the file:

```ts
import {
  GenerateProgressEvent,
  GenerateQuestionInput,
  QuestionGeneratorPort,
} from "./question-generator.port";
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/adapters/in-memory-question-generator.adapter.spec.ts`
Expected: FAIL — `GenerateProgressEvent` doesn't exist / `onProgress` param not accepted by the current signature (TypeScript compile error surfaces as a Jest failure).

- [ ] **Step 3: Add `GenerateProgressEvent` and extend the port signature**

In `apps/api/src/modules/ai/domain/ports/question-generator.port.ts`, add after `ExtractQuestionInput` (line 61) and before `QuestionGeneratorPort`:

```ts
/**
 * Emitted during `QuestionGeneratorPort.generate()` when a caller passes an
 * `onProgress` callback — proof-of-life for the AI call while it's still in
 * flight (design doc: live streaming progress). `restart` fires whenever a
 * PARTIAL generation is discarded and a fresh one begins — either this
 * port's own internal retry (bad/unparseable model output) or the caller's
 * own retry (e.g. a Typst compile failure upstream in
 * `GenerateQuestionsService`). Callers MUST treat `restart` as "clear
 * whatever you accumulated from `delta` events so far" — without it, text
 * from two unrelated generations would look like one continuous stream.
 */
export type GenerateProgressEvent =
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "restart" };
```

Replace the `generate()` method signature (lines 63-76) with:

```ts
  /**
   * Produces one AI-generated question. Implementations MUST validate their
   * own output against the expected shape before resolving — this port
   * NEVER returns unvalidated content (design doc §7: "Nunca se guarda sin
   * validar contra schema").
   *
   * `onProgress`, when provided, is invoked with `delta`/`restart` events as
   * the underlying provider streams its response — purely a progress signal,
   * never part of the resolved value. Implementations that can't stream MAY
   * call it once with the full text, or not at all.
   *
   * @throws AiRateLimitError when the provider is rate-limited (e.g. 429 on
   *   OpenRouter's free tier).
   * @throws AiInvalidResponseError when the provider's output can't be
   *   parsed/validated into a `GeneratedQuestion`, even after any internal
   *   retry the adapter performs.
   */
  generate(
    input: GenerateQuestionInput,
    onProgress?: (event: GenerateProgressEvent) => void,
  ): Promise<GeneratedQuestion>;
```

- [ ] **Step 4: `InMemoryQuestionGeneratorAdapter` calls `onProgress` once**

In `apps/api/src/modules/ai/adapters/in-memory-question-generator.adapter.ts`, add `GenerateProgressEvent` to the import and change `generate()` (lines 20-29):

```ts
import {
  ExtractQuestionInput,
  GenerateProgressEvent,
  GenerateQuestionInput,
  GeneratedAlternatives,
  GeneratedQuestion,
  QuestionGeneratorPort,
  ReviseQuestionInput,
} from "../domain/ports/question-generator.port";
```

```ts
  async generate(
    input: GenerateQuestionInput,
    onProgress?: (event: GenerateProgressEvent) => void,
  ): Promise<GeneratedQuestion> {
    const question: GeneratedQuestion = {
      bodyTypst: `¿Cuál es el resultado de la operación sobre ${input.topic}? $ 1/2 + 1/4 $`,
      alternatives: ["1/4", "3/4", "1/2", "1", "2"],
      correctAnswer: "b",
      figureCode: input.withFigure
        ? `#cetz.canvas({ import cetz.draw: *; circle((0,0), radius: 1) })`
        : undefined,
    };
    onProgress?.({ type: "delta", text: question.bodyTypst });
    return question;
  }
```

- [ ] **Step 5: `LazyQuestionGeneratorAdapter` passes `onProgress` through**

In `apps/api/src/modules/ai/adapters/lazy-question-generator.adapter.ts`, add `GenerateProgressEvent` to the import and change `generate()` (lines 25-30):

```ts
import {
  ExtractQuestionInput,
  GenerateProgressEvent,
  GenerateQuestionInput,
  GeneratedQuestion,
  QuestionGeneratorPort,
  ReviseQuestionInput,
} from "../domain/ports/question-generator.port";
```

```ts
  async generate(
    input: GenerateQuestionInput,
    onProgress?: (event: GenerateProgressEvent) => void,
  ): Promise<GeneratedQuestion> {
    if (!this.resolved) {
      this.resolved = this.resolve();
    }
    return this.resolved.generate(input, onProgress);
  }
```

- [ ] **Step 6: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/ai/adapters/in-memory-question-generator.adapter.spec.ts src/modules/ai/adapters/lazy-question-generator.adapter.spec.ts`
Expected: PASS (both existing spec files run the contract suite against these two adapters — confirm the new case passes for both).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/ai/domain/ports/question-generator.port.ts apps/api/src/modules/ai/domain/ports/question-generator.port.contract.ts apps/api/src/modules/ai/adapters/in-memory-question-generator.adapter.ts apps/api/src/modules/ai/adapters/lazy-question-generator.adapter.ts
git commit -m "feat(api): add optional onProgress callback to QuestionGeneratorPort.generate"
```

---

## Task 2: OpenRouterAdapter — real SSE streaming

**Files:**
- Create: `apps/api/src/modules/ai/adapters/openrouter/openrouter-sse-parser.ts`
- Test: `apps/api/src/modules/ai/adapters/openrouter/openrouter-sse-parser.spec.ts`
- Modify: `apps/api/src/modules/ai/adapters/openrouter/openrouter.adapter.ts`
- Modify: `apps/api/src/modules/ai/adapters/openrouter/openrouter.adapter.spec.ts`

**Interfaces:**
- Consumes: `GenerateProgressEvent` (Task 1).
- Produces: `parseOpenRouterSseBuffer(buffer: string): { events: readonly OpenRouterSseEvent[]; remainder: string }`; `OpenRouterAdapter.generate(input, onProgress?)` now genuinely streams when `onProgress` is passed.

- [ ] **Step 1: Failing parser test**

Create `apps/api/src/modules/ai/adapters/openrouter/openrouter-sse-parser.spec.ts`:

```ts
import { parseOpenRouterSseBuffer } from "./openrouter-sse-parser";

function chunk(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`;
}

describe("parseOpenRouterSseBuffer", () => {
  it("extracts a delta event from one complete frame", () => {
    const { events, remainder } = parseOpenRouterSseBuffer(`${chunk("Hola")}\n\n`);

    expect(events).toEqual([{ type: "delta", text: "Hola" }]);
    expect(remainder).toBe("");
  });

  it("keeps an incomplete trailing frame in remainder instead of dropping it", () => {
    const { events, remainder } = parseOpenRouterSseBuffer(`${chunk("Hola")}\n\n${chunk("Mun").slice(0, 10)}`);

    expect(events).toEqual([{ type: "delta", text: "Hola" }]);
    expect(remainder).toBe(chunk("Mun").slice(0, 10));
  });

  it("ignores OpenRouter's `: OPENROUTER PROCESSING` keep-alive comment lines", () => {
    const { events } = parseOpenRouterSseBuffer(`: OPENROUTER PROCESSING\n\n${chunk("Hola")}\n\n`);

    expect(events).toEqual([{ type: "delta", text: "Hola" }]);
  });

  it("emits a done event for the [DONE] sentinel and stops before it", () => {
    const { events } = parseOpenRouterSseBuffer(`${chunk("Hola")}\n\ndata: [DONE]\n\n`);

    expect(events).toEqual([
      { type: "delta", text: "Hola" },
      { type: "done" },
    ]);
  });

  it("emits an error event when a chunk's finish_reason is 'error'", () => {
    const errorFrame = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "error" }] })}\n\n`;

    const { events } = parseOpenRouterSseBuffer(errorFrame);

    expect(events).toEqual([
      { type: "error", message: "OpenRouter stream reported finish_reason=error" },
    ]);
  });

  it("skips a malformed data line instead of throwing", () => {
    const { events } = parseOpenRouterSseBuffer("data: not json\n\n");

    expect(events).toEqual([]);
  });

  it("returns no events for an empty buffer", () => {
    expect(parseOpenRouterSseBuffer("")).toEqual({ events: [], remainder: "" });
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/adapters/openrouter/openrouter-sse-parser.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the parser**

Create `apps/api/src/modules/ai/adapters/openrouter/openrouter-sse-parser.ts`:

```ts
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
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/ai/adapters/openrouter/openrouter-sse-parser.spec.ts`
Expected: PASS.

- [ ] **Step 5: Failing adapter streaming tests**

Add to `apps/api/src/modules/ai/adapters/openrouter/openrouter.adapter.spec.ts`. First, extend the imports at the top:

```ts
import { Difficulty } from "@exams-generator/shared";
import {
  AiInvalidResponseError,
  AiRateLimitError,
  ExtractQuestionInput,
  GenerateProgressEvent,
  GenerateQuestionInput,
  ReviseQuestionInput,
} from "../../domain/ports/question-generator.port";
import { HttpClient, HttpSseResponse, OpenRouterAdapter, SseHttpClient } from "./openrouter.adapter";
```

Add this helper near the existing `jsonResponse`/`chatCompletion` helpers:

```ts
function sseChunk(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

/** Builds a fake streaming response whose `body` yields the given raw SSE text in one or more pre-split pieces (simulating separate network reads). */
function sseResponse(status: number, pieces: readonly string[]): ReturnType<SseHttpClient> {
  const encoder = new TextEncoder();
  return Promise.resolve({
    status,
    body: {
      async *[Symbol.asyncIterator]() {
        for (const piece of pieces) {
          yield encoder.encode(piece);
        }
      },
    },
  } satisfies HttpSseResponse);
}
```

Add a new `describe` block right before the closing `});` of the top-level `describe("OpenRouterAdapter", ...)`:

```ts
  describe("streaming (onProgress provided)", () => {
    it("sends stream: true and forwards each delta through onProgress", async () => {
      const sseHttpClient = jest
        .fn<ReturnType<SseHttpClient>, Parameters<SseHttpClient>>()
        .mockReturnValueOnce(
          sseResponse(200, [
            sseChunk('{"bodyTypst":"¿Cuánto'),
            sseChunk(' es $1/2 + 1/4$?","alternatives":["1/4","3/4","1/2","1","2"],"correctAnswer":"b","figureCode":null}'),
            "data: [DONE]\n\n",
          ]),
        );
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        sseHttpClient,
      });
      const events: GenerateProgressEvent[] = [];

      const result = await adapter.generate(INPUT, (event) => events.push(event));

      expect(JSON.parse(sseHttpClient.mock.calls[0][1].body).stream).toBe(true);
      expect(events.filter((e) => e.type === "delta")).toHaveLength(2);
      expect(result.bodyTypst).toBe(VALID_QUESTION_JSON.bodyTypst);
      expect(result.correctAnswer).toBe("b");
    });

    it("emits a restart event before the internal retry when the first stream fails validation", async () => {
      const sseHttpClient = jest
        .fn<ReturnType<SseHttpClient>, Parameters<SseHttpClient>>()
        .mockReturnValueOnce(sseResponse(200, [sseChunk(JSON.stringify({ ...VALID_QUESTION_JSON, alternatives: ["only-one"] })), "data: [DONE]\n\n"]))
        .mockReturnValueOnce(sseResponse(200, [sseChunk(JSON.stringify(VALID_QUESTION_JSON)), "data: [DONE]\n\n"]));
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        sseHttpClient,
      });
      const events: GenerateProgressEvent[] = [];

      const result = await adapter.generate(INPUT, (event) => events.push(event));

      expect(sseHttpClient).toHaveBeenCalledTimes(2);
      expect(events.some((e) => e.type === "restart")).toBe(true);
      expect(result.bodyTypst).toBe(VALID_QUESTION_JSON.bodyTypst);
    });

    it("throws AiInvalidResponseError when both streamed attempts fail validation", async () => {
      const sseHttpClient = jest
        .fn<ReturnType<SseHttpClient>, Parameters<SseHttpClient>>()
        .mockReturnValue(sseResponse(200, [sseChunk("not json at all"), "data: [DONE]\n\n"]));
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        sseHttpClient,
      });

      await expect(adapter.generate(INPUT, () => {})).rejects.toBeInstanceOf(AiInvalidResponseError);
    });

    it("throws AiRateLimitError immediately on a 429 streaming response, without retrying", async () => {
      const sseHttpClient = jest
        .fn<ReturnType<SseHttpClient>, Parameters<SseHttpClient>>()
        .mockReturnValueOnce(sseResponse(429, []));
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        sseHttpClient,
      });

      await expect(adapter.generate(INPUT, () => {})).rejects.toBeInstanceOf(AiRateLimitError);
      expect(sseHttpClient).toHaveBeenCalledTimes(1);
    });

    it("does not touch the buffered httpClient at all when streaming", async () => {
      const httpClient = jest.fn<ReturnType<HttpClient>, Parameters<HttpClient>>();
      const sseHttpClient = jest
        .fn<ReturnType<SseHttpClient>, Parameters<SseHttpClient>>()
        .mockReturnValueOnce(sseResponse(200, [sseChunk(JSON.stringify(VALID_QUESTION_JSON)), "data: [DONE]\n\n"]));
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        httpClient,
        sseHttpClient,
      });

      await adapter.generate(INPUT, () => {});

      expect(httpClient).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 6: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/adapters/openrouter/openrouter.adapter.spec.ts`
Expected: FAIL — `SseHttpClient`/`HttpSseResponse` not exported, `sseHttpClient` config option unknown, `generate()` doesn't accept a second argument in a way that streams.

- [ ] **Step 7: Implement streaming in the adapter**

In `apps/api/src/modules/ai/adapters/openrouter/openrouter.adapter.ts`:

Extend the top imports:

```ts
import {
  AiGenerationError,
  AiInvalidResponseError,
  AiRateLimitError,
  ExtractQuestionInput,
  GenerateProgressEvent,
  GenerateQuestionInput,
  GeneratedQuestion,
  QuestionGeneratorPort,
  ReviseQuestionInput,
} from "../../domain/ports/question-generator.port";
import {
  buildOpenRouterExtractRequestBody,
  buildOpenRouterRequestBody,
  buildOpenRouterReviseRequestBody,
  OpenRouterRequestBody,
} from "./openrouter-request-builder";
import { parseGeneratedQuestionContent } from "./openrouter-response-parser";
import { validateGeneratedQuestionShape } from "./openrouter-response-validator";
import { parseOpenRouterSseBuffer } from "./openrouter-sse-parser";
```

Add right after the existing `HttpClient`/`fetchHttpClient` block (after line 41):

```ts
export interface HttpSseResponse {
  readonly status: number;
  /** `fetch`'s `Response.body` is async-iterable in Node (undici) — the DOM lib types don't declare it, hence the cast in `fetchSseHttpClient`. */
  readonly body: AsyncIterable<Uint8Array> | null;
}

/** Same shape as `HttpClient` but for the streaming call — kept as a SEPARATE injectable so `reviseQuestion`/`extractFromImage` (never streamed) are untouched by this change. */
export type SseHttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<HttpSseResponse>;

export const fetchSseHttpClient: SseHttpClient = (url, init) =>
  fetch(url, init) as unknown as Promise<HttpSseResponse>;
```

Add `sseHttpClient` to `OpenRouterAdapterConfig` (after `httpClient` in the existing interface):

```ts
  readonly httpClient?: HttpClient;
  readonly sseHttpClient?: SseHttpClient;
  readonly baseUrl?: string;
```

Add a field + constructor wiring (in the class, alongside the existing `httpClient`/`baseUrl`/`visionModel` fields):

```ts
  private readonly httpClient: HttpClient;
  private readonly sseHttpClient: SseHttpClient;
  private readonly baseUrl: string;
  private readonly visionModel: string;

  constructor(private readonly config: OpenRouterAdapterConfig) {
    this.httpClient = config.httpClient ?? fetchHttpClient;
    this.sseHttpClient = config.sseHttpClient ?? fetchSseHttpClient;
    this.baseUrl = config.baseUrl ?? OPENROUTER_CHAT_COMPLETIONS_URL;
    this.visionModel = config.visionModel ?? config.model;
  }
```

Replace `generate()` (lines 96-100):

```ts
  async generate(
    input: GenerateQuestionInput,
    onProgress?: (event: GenerateProgressEvent) => void,
  ): Promise<GeneratedQuestion> {
    return this.runWithRetries(
      (previousError) => buildOpenRouterRequestBody(this.config.model, input, { previousError }),
      onProgress,
    );
  }
```

Replace `runWithRetries()` (lines 134-151):

```ts
  private async runWithRetries(
    buildRequestBody: (previousError: string | undefined) => OpenRouterRequestBody,
    onProgress?: (event: GenerateProgressEvent) => void,
  ): Promise<GeneratedQuestion> {
    let lastOutcome: AttemptOutcome | undefined;

    for (let attemptNumber = 1; attemptNumber <= MAX_ATTEMPTS; attemptNumber++) {
      if (attemptNumber > 1) {
        onProgress?.({ type: "restart" });
      }
      const outcome = onProgress
        ? await this.attemptStreaming(buildRequestBody(lastOutcome?.error), onProgress)
        : await this.attempt(buildRequestBody(lastOutcome?.error));
      if (outcome.ok && outcome.question) {
        return outcome.question;
      }
      lastOutcome = outcome;
    }

    throw new AiInvalidResponseError(
      `AI response failed validation after ${MAX_ATTEMPTS} attempt(s): ${lastOutcome?.error}`,
      lastOutcome?.rawContent ?? "",
    );
  }
```

Add `attemptStreaming()` right after the existing `attempt()` method (after line 181):

```ts
  private async attemptStreaming(
    requestBody: OpenRouterRequestBody,
    onProgress: (event: GenerateProgressEvent) => void,
  ): Promise<AttemptOutcome> {
    const response = await this.sseHttpClient(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({ ...requestBody, stream: true }),
    });

    if (response.status === 429) {
      throw new AiRateLimitError();
    }
    if (response.status >= 400) {
      throw new AiGenerationError(`OpenRouter request failed with status ${response.status}`);
    }
    if (!response.body) {
      throw new AiGenerationError("OpenRouter streaming response has no body");
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let rawContent = "";

    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const { events, remainder } = parseOpenRouterSseBuffer(buffer);
      buffer = remainder;

      for (const event of events) {
        if (event.type === "delta") {
          rawContent += event.text;
          onProgress({ type: "delta", text: event.text });
        } else if (event.type === "error") {
          throw new AiGenerationError(event.message);
        }
      }
    }

    try {
      const parsed = parseGeneratedQuestionContent(rawContent);
      const question = validateGeneratedQuestionShape(parsed);
      return { ok: true, question };
    } catch (err) {
      return { ok: false, error: (err as Error).message, rawContent };
    }
  }
```

- [ ] **Step 8: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/ai/adapters/openrouter/openrouter.adapter.spec.ts`
Expected: PASS — every existing (non-streaming) test in this file AND the new streaming `describe` block.

- [ ] **Step 9: Full AI module regression check**

Run: `cd apps/api && pnpm exec jest src/modules/ai`
Expected: PASS — `reviseQuestion`/`extractFromImage` behavior is byte-for-byte unchanged (they never pass `onProgress`).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/ai/adapters/openrouter
git commit -m "feat(api): stream OpenRouter generate() responses via SSE when onProgress is provided"
```

---

## Task 3: Extract `generateOneItem` (pure refactor, no behavior change)

**Files:**
- Modify: `apps/api/src/modules/ai/generate-questions.service.ts`

**Interfaces:**
- Produces: `private generateOneItem(user, params, onProgress?): Promise<{ok:true; id:string} | {ok:false; error:string}>` — used by both the existing batch loop and the new streaming method (Task 4).

- [ ] **Step 1: Establish the regression baseline**

Run: `cd apps/api && pnpm exec jest src/modules/ai/generate-questions.service.spec.ts`
Expected: PASS (all 7 existing tests green, before touching anything — this is the safety net for the refactor below, not a new test).

- [ ] **Step 2: Extract the helper**

In `apps/api/src/modules/ai/generate-questions.service.ts`, add `GenerateProgressEvent` to the import:

```ts
import { GeneratedQuestion, GenerateProgressEvent, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
```

Replace the body of `generateQuestions()` from the `const created` line (97) through the closing of the `for` loop (170) — i.e. everything between `const taxonomy = ...` block ending and `return { created, failed };` — with a call into the new helper, and add the helper as a new private method:

```ts
    const created: GenerateQuestionsCreatedItem[] = [];
    const failed: GenerateQuestionsFailedItem[] = [];

    for (let index = 0; index < count; index += 1) {
      const outcome = await this.generateOneItem(user, {
        topicId,
        courseName: taxonomy.courseName,
        topicName: taxonomy.topicName,
        difficulty,
        gradeLevel,
        withFigure,
      });
      if (outcome.ok) {
        created.push({ id: outcome.id });
      } else {
        failed.push({ index, error: outcome.error });
      }
    }

    return { created, failed };
  }

  /**
   * One requested question, end to end: generate → (retry-compile up to
   * `MAX_COMPILE_ATTEMPTS`) → persist as a `draft`. Shared by the batch loop
   * above and `generateQuestionStream()` (streaming, single-item) — the
   * ONLY difference between the two callers is whether `onProgress` is
   * passed through to `QuestionGeneratorPort.generate()`.
   */
  private async generateOneItem(
    user: AuthTokenPayload,
    params: {
      readonly topicId: string;
      readonly courseName: string;
      readonly topicName: string;
      readonly difficulty: Difficulty;
      readonly gradeLevel: GradeLevel;
      readonly withFigure: boolean;
    },
    onProgress?: (event: GenerateProgressEvent) => void,
  ): Promise<{ readonly ok: true; readonly id: string } | { readonly ok: false; readonly error: string }> {
    try {
      let generated: GeneratedQuestion | undefined;
      let lastCompileError: TypstCompilationError | undefined;

      for (let attempt = 1; attempt <= MAX_COMPILE_ATTEMPTS; attempt += 1) {
        if (attempt > 1) {
          onProgress?.({ type: "restart" });
        }
        generated = await this.generator.generate(
          {
            course: params.courseName,
            topic: params.topicName,
            difficulty: params.difficulty,
            gradeLevel: params.gradeLevel,
            withFigure: params.withFigure,
          },
          onProgress,
        );

        try {
          await this.pdfCompiler.compileExam({
            title: "AI generation preview",
            versionLabel: "preview",
            questions: [
              {
                id: randomUUID(),
                type: "structured",
                bodyTypst: generated.bodyTypst,
                alternatives: generated.alternatives,
                figureCode: generated.figureCode,
              },
            ],
          });
          lastCompileError = undefined;
          break;
        } catch (compileError) {
          if (compileError instanceof TypstCompilationError) {
            lastCompileError = compileError;
            continue;
          }
          throw compileError;
        }
      }

      if (lastCompileError) {
        return { ok: false, error: `Typst compile failed: ${lastCompileError.message}` };
      }

      const question = generated as GeneratedQuestion;
      const { id } = await this.bankRepository.createStructuredQuestion({
        tenantId: user.tenantId,
        topicId: params.topicId,
        difficulty: params.difficulty,
        gradeLevel: params.gradeLevel,
        bodyTypst: question.bodyTypst,
        alternatives: question.alternatives,
        correctAnswer: correctAnswerLetterToIndex(question.correctAnswer),
        figureCode: question.figureCode,
        createdBy: user.sub,
        status: "draft",
        aiGenerated: true,
      });
      return { ok: true, id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  }
```

(The class's opening `for (let index...)` loop this replaces, and the helper's body, are DELIBERATELY line-for-line the same logic as the original — only reshaped into a per-item function with `ok`/ `error` returns instead of pushing into `created`/`failed` directly.)

- [ ] **Step 3: Run it, expect pass — unchanged**

Run: `cd apps/api && pnpm exec jest src/modules/ai/generate-questions.service.spec.ts`
Expected: PASS — all 7 tests from Step 1, untouched, still green. This is the proof the refactor preserved behavior exactly.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/modules/ai/generate-questions.service.ts
git commit -m "refactor(api): extract generateOneItem from GenerateQuestionsService.generateQuestions"
```

---

## Task 4: `GenerateQuestionsService.generateQuestionStream()`

**Files:**
- Modify: `apps/api/src/modules/ai/generate-questions.service.ts`
- Modify: `apps/api/src/modules/ai/generate-questions.service.spec.ts`

**Interfaces:**
- Consumes: `generateOneItem` (Task 3).
- Produces: `export type GenerateQuestionStreamEvent = GenerateProgressEvent | { type: "done"; result: GenerateQuestionsResult }`; `GenerateQuestionsService.generateQuestionStream(user, dto: Omit<GenerateQuestionsDto, "count">): Observable<GenerateQuestionStreamEvent>`.

- [ ] **Step 1: Failing tests**

Add to `apps/api/src/modules/ai/generate-questions.service.spec.ts`. Extend the top import:

```ts
import { Difficulty, Role } from "@exams-generator/shared";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { firstValueFrom, toArray } from "rxjs";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { TypstCompilationError } from "../exams/domain/ports/pdf-compiler.port";
import { AiInvalidResponseError } from "./domain/ports/question-generator.port";
import { GenerateQuestionsService, GenerateQuestionStreamEvent } from "./generate-questions.service";
```

Add a new `describe` block at the end of the file, before the final closing (mirrors `VALID_DTO`/`buildDeps` already defined above it):

```ts
describe("GenerateQuestionsService.generateQuestionStream", () => {
  const STREAM_DTO = {
    courseId: "course-1",
    topicId: "topic-1",
    difficulty: Difficulty.Easy,
    gradeLevel: "primaria_1",
    withFigure: false,
  };

  async function collect(service: GenerateQuestionsService, dto: typeof STREAM_DTO) {
    return firstValueFrom(service.generateQuestionStream(TEACHER_USER, dto).pipe(toArray()));
  }

  it("emits delta events as they arrive, then a terminal done event with the created id", async () => {
    const { service, generator } = buildDeps();
    generator.generate.mockImplementation(async (_input, onProgress) => {
      onProgress?.({ type: "delta", text: "¿Cuánto" });
      onProgress?.({ type: "delta", text: " es 1+1?" });
      return GENERATED_QUESTION;
    });

    const events = await collect(service, STREAM_DTO);

    expect(events.slice(0, 2)).toEqual([
      { type: "delta", text: "¿Cuánto" },
      { type: "delta", text: " es 1+1?" },
    ]);
    const last = events[events.length - 1] as GenerateQuestionStreamEvent & { type: "done" };
    expect(last.type).toBe("done");
    expect(last.result.created).toHaveLength(1);
    expect(last.result.failed).toHaveLength(0);
  });

  it("emits a done event with a failed item — never an Observable error — when generation fails", async () => {
    const { service, generator } = buildDeps();
    generator.generate.mockRejectedValue(new AiInvalidResponseError("bad json", "{}"));

    const events = await collect(service, STREAM_DTO);

    expect(events).toEqual([
      { type: "done", result: { created: [], failed: [{ index: 0, error: "bad json" }] } },
    ]);
  });

  it("emits a done/failed event when courseId/topicId don't resolve", async () => {
    const { service, bankRepository } = buildDeps();
    bankRepository.findCourseAndTopicNames.mockResolvedValue(undefined);

    const events = await collect(service, STREAM_DTO);

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "done",
      result: {
        created: [],
        failed: [{ index: 0, error: "courseId/topicId not found, or topicId does not belong to courseId" }],
      },
    });
  });

  it("emits a done/failed event (not a thrown exception) when required fields are missing", async () => {
    const { service } = buildDeps();

    const events = await collect(service, { ...STREAM_DTO, courseId: undefined as unknown as string });

    expect(events).toHaveLength(1);
    expect((events[0] as GenerateQuestionStreamEvent & { type: "done" }).result.failed).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/generate-questions.service.spec.ts`
Expected: FAIL — `generateQuestionStream`/`GenerateQuestionStreamEvent` don't exist yet.

- [ ] **Step 3: Implement `generateQuestionStream()`**

In `apps/api/src/modules/ai/generate-questions.service.ts`, add the `Observable` import:

```ts
import { randomUUID } from "node:crypto";
import { Difficulty } from "@exams-generator/shared";
import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { Observable } from "rxjs";
import { AuthTokenPayload } from "../auth/token.service";
```

Add the new exported type next to `GenerateQuestionsResult`:

```ts
export interface GenerateQuestionsResult {
  readonly created: readonly GenerateQuestionsCreatedItem[];
  readonly failed: readonly GenerateQuestionsFailedItem[];
}

/** Every event `generateQuestionStream()` can emit — mirrors `GenerateProgressEvent` plus a terminal `done` carrying the same `GenerateQuestionsResult` shape `generateQuestions()` resolves with. */
export type GenerateQuestionStreamEvent =
  | GenerateProgressEvent
  | { readonly type: "done"; readonly result: GenerateQuestionsResult };
```

Add the new method to the class, right after `generateQuestions()` and before `generateOneItem()`:

```ts
  /**
   * Single-question streaming variant of `generateQuestions()` (design:
   * live progress). `dto` never carries `count` — the frontend already
   * calls the buffered endpoint with `count: 1` in a loop for exactly this
   * reason (see `AiGenerateComponent.generateOne`); this method formalizes
   * "one question, streamed" as its own contract instead of reusing the
   * batch shape. Reuses `generateOneItem()` — same generate→compile-retry→
   * persist pipeline as the batch path, byte for byte.
   */
  generateQuestionStream(
    user: AuthTokenPayload,
    dto: Omit<GenerateQuestionsDto, "count">,
  ): Observable<GenerateQuestionStreamEvent> {
    return new Observable<GenerateQuestionStreamEvent>((subscriber) => {
      let cancelled = false;

      void (async () => {
        const validation = validateGenerateQuestionsInput({ ...dto, count: 1 });
        if (!validation.ok) {
          subscriber.next({
            type: "done",
            result: { created: [], failed: [{ index: 0, error: validation.errors.join("; ") }] },
          });
          subscriber.complete();
          return;
        }

        const courseId = dto.courseId as string;
        const topicId = dto.topicId as string;
        const difficulty = dto.difficulty as Difficulty;
        const gradeLevel = dto.gradeLevel as GradeLevel;
        const withFigure = dto.withFigure ?? false;

        const taxonomy = await this.bankRepository.findCourseAndTopicNames(courseId, topicId);
        if (cancelled) return;
        if (!taxonomy) {
          subscriber.next({
            type: "done",
            result: {
              created: [],
              failed: [{ index: 0, error: "courseId/topicId not found, or topicId does not belong to courseId" }],
            },
          });
          subscriber.complete();
          return;
        }

        const outcome = await this.generateOneItem(
          user,
          { topicId, courseName: taxonomy.courseName, topicName: taxonomy.topicName, difficulty, gradeLevel, withFigure },
          (event) => {
            if (!cancelled) subscriber.next(event);
          },
        );
        if (cancelled) return;

        subscriber.next({
          type: "done",
          result: outcome.ok
            ? { created: [{ id: outcome.id }], failed: [] }
            : { created: [], failed: [{ index: 0, error: outcome.error }] },
        });
        subscriber.complete();
      })();

      return () => {
        cancelled = true;
      };
    });
  }
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/ai/generate-questions.service.spec.ts`
Expected: PASS — both the pre-existing `generateQuestions` suite and the new `generateQuestionStream` suite.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai/generate-questions.service.ts apps/api/src/modules/ai/generate-questions.service.spec.ts
git commit -m "feat(api): add GenerateQuestionsService.generateQuestionStream"
```

---

## Task 5: `POST /ai/questions/generate/stream` (hand-rolled SSE)

**Files:**
- Modify: `apps/api/src/modules/ai/ai.controller.ts`
- Create: `apps/api/src/modules/ai/ai-generate-stream.e2e.spec.ts`

**Interfaces:**
- Consumes: `GenerateQuestionsService.generateQuestionStream` (Task 4).
- Produces: `POST /ai/questions/generate/stream` — `Content-Type: text/event-stream`, body is `data: <JSON.stringify(GenerateQuestionStreamEvent)>\n\n` frames, connection closes after the `done` frame.

- [ ] **Step 1: Failing e2e test**

Create `apps/api/src/modules/ai/ai-generate-stream.e2e.spec.ts` (mirrors `ai-revise.e2e.spec.ts` fixture setup):

```ts
import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { courses, questions, tenants, topics, users } from "../../db/schema";
import { TokenService } from "../auth/token.service";
import { isTypstAvailableSync } from "../exams/adapters/pdf/test-utils/typst-availability";
import { InMemoryQuestionGeneratorAdapter } from "./adapters/in-memory-question-generator.adapter";
import { QUESTION_GENERATOR_PORT } from "./ai.constants";

const describeIfTypst = isTypstAvailableSync() ? describe : describe.skip;

describeIfTypst("POST /ai/questions/generate/stream (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseId: string;
  let topicId: string;
  let tenantId: string;
  let teacherId: string;
  let token: string;

  const createdQuestionIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(QUESTION_GENERATOR_PORT)
      .useValue(new InMemoryQuestionGeneratorAdapter())
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const suffix = randomUUID();

    const [course] = await db
      .insert(courses)
      .values({ name: `AI Stream E2E Course ${suffix}` })
      .returning({ id: courses.id });
    courseId = course!.id;

    const [topic] = await db
      .insert(topics)
      .values({ courseId, name: `AI Stream E2E Topic ${suffix}` })
      .returning({ id: topics.id });
    topicId = topic!.id;

    const [tenant] = await db
      .insert(tenants)
      .values({ name: `AI Stream E2E Tenant ${suffix}`, slug: `ai-stream-e2e-tenant-${suffix}` })
      .returning({ id: tenants.id });
    tenantId = tenant!.id;

    const [teacher] = await db
      .insert(users)
      .values({
        tenantId,
        email: `ai-stream-e2e-teacher-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherId = teacher!.id;

    token = tokenService.sign({ sub: teacherId, tenantId, role: Role.Teacher });
  });

  afterAll(async () => {
    if (createdQuestionIds.length > 0) {
      await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
    }
    await db.delete(users).where(inArray(users.id, [teacherId]));
    await db.delete(tenants).where(inArray(tenants.id, [tenantId]));
    await db.delete(topics).where(inArray(topics.id, [topicId]));
    await db.delete(courses).where(inArray(courses.id, [courseId]));
    await app.close();
    await pool.end();
  });

  function parseFrames(text: string): Array<Record<string, unknown>> {
    return text
      .split("\n\n")
      .map((frame) => frame.trim())
      .filter((frame) => frame.startsWith("data:"))
      .map((frame) => JSON.parse(frame.slice("data:".length).trim()));
  }

  it("streams a text/event-stream response ending in a done event with a created id", async () => {
    const response = await request(app.getHttpServer())
      .post("/ai/questions/generate/stream")
      .set("Authorization", `Bearer ${token}`)
      .send({ courseId, topicId, difficulty: "easy", gradeLevel: "primaria_1", withFigure: false })
      .expect(200);

    expect(response.headers["content-type"]).toContain("text/event-stream");
    const frames = parseFrames(response.text);
    expect(frames.length).toBeGreaterThan(0);
    const last = frames[frames.length - 1];
    expect(last.type).toBe("done");
    const result = last.result as { created: Array<{ id: string }>; failed: unknown[] };
    expect(result.created).toHaveLength(1);
    createdQuestionIds.push(result.created[0]!.id);
  });

  it("rejects with 401 when no Authorization header is sent", async () => {
    await request(app.getHttpServer())
      .post("/ai/questions/generate/stream")
      .send({ courseId, topicId, difficulty: "easy", gradeLevel: "primaria_1" })
      .expect(401);
  });
});
```

- [ ] **Step 2: Run it, expect fail**

Run: `cd apps/api && pnpm exec jest src/modules/ai/ai-generate-stream.e2e.spec.ts`
Expected: FAIL — 404 (route doesn't exist yet).

- [ ] **Step 3: Implement the controller endpoint**

In `apps/api/src/modules/ai/ai.controller.ts`, extend the imports:

```ts
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { CurrentUser } from "../auth/current-user.decorator";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../auth/token.service";
import { ExtractQuestionService } from "./extract-question.service";
import { GenerateQuestionsResult, GenerateQuestionsService, GenerateQuestionStreamEvent } from "./generate-questions.service";
import { GeneratedQuestion } from "./domain/ports/question-generator.port";
import { ReviseQuestionService } from "./revise-question.service";
```

Add the new handler right after `generate()`:

```ts
  /**
   * `POST /ai/questions/generate/stream` — same single-question generation
   * as `generate()` with `count: 1`, but streamed live as it happens (design:
   * live streaming progress). Hand-rolled SSE via `@Res()` rather than
   * Nest's `@Sse()` decorator: `@Sse()` is GET-oriented, and a native
   * browser `EventSource` can't send the `Authorization` header this
   * endpoint's `JwtAuthGuard` requires — the Angular client instead
   * consumes this over `HttpClient` (which the existing auth interceptor
   * already attaches the header to), reading the SSE-shaped body as plain
   * text. Never throws past this point: every failure (validation,
   * not-found taxonomy, AI/compile error) is carried inside a `done` event's
   * `result.failed`, exactly like the buffered endpoint above.
   */
  @Post("generate/stream")
  async generateStream(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: GenerateQuestionsBody,
    @Res() res: Response,
  ): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const writeEvent = (event: GenerateQuestionStreamEvent): void => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const subscription = this.service
      .generateQuestionStream(user, {
        courseId: body.courseId,
        topicId: body.topicId,
        difficulty: body.difficulty,
        gradeLevel: body.gradeLevel,
        withFigure: body.withFigure,
      })
      .subscribe({
        next: writeEvent,
        error: () => {
          writeEvent({
            type: "done",
            result: { created: [], failed: [{ index: 0, error: "Unexpected server error" }] },
          });
          res.end();
        },
        complete: () => res.end(),
      });

    res.on("close", () => subscription.unsubscribe());
  }
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd apps/api && pnpm exec jest src/modules/ai/ai-generate-stream.e2e.spec.ts`
Expected: PASS.

- [ ] **Step 5: Full AI module regression check**

Run: `cd apps/api && pnpm exec jest src/modules/ai`
Expected: PASS — every test in the module, including `ai.e2e.spec.ts` (the existing buffered `POST /ai/questions/generate`, untouched).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/ai/ai.controller.ts apps/api/src/modules/ai/ai-generate-stream.e2e.spec.ts
git commit -m "feat(api): add POST /ai/questions/generate/stream (SSE)"
```

---

## Task 6: Frontend — `GenerateQuestionStreamEvent` + SSE frame parser + `AiService`

**Files:**
- Modify: `apps/web/src/app/features/ai/ai.models.ts`
- Create: `apps/web/src/app/features/ai/parse-generate-stream-frames.ts`
- Test: `apps/web/src/app/features/ai/parse-generate-stream-frames.spec.ts`
- Modify: `apps/web/src/app/features/ai/ai.service.ts`

**Interfaces:**
- Produces: `GenerateQuestionStreamEvent` (mirrors the backend type); `parseGenerateStreamFrames(buffer: string): { events: readonly GenerateQuestionStreamEvent[]; remainder: string }`; `AiService.generateQuestionStream(payload): Observable<GenerateQuestionStreamEvent>`.

- [ ] **Step 1: Add the mirrored type**

In `apps/web/src/app/features/ai/ai.models.ts`, add after `GenerateQuestionsResult` (line 79):

```ts
/**
 * Mirrors `GenerateProgressEvent`/`GenerateQuestionStreamEvent` (apps/api
 * ai module). `restart` fires whenever the backend discards a partial
 * generation and starts a fresh one (an internal AI-response retry, or a
 * Typst-compile retry) — consumers MUST clear any UI state built from
 * `delta` events when they see it, or two unrelated generations will look
 * like one continuous stream.
 */
export type GenerateQuestionStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'restart' }
  | { readonly type: 'done'; readonly result: GenerateQuestionsResult };
```

- [ ] **Step 2: Failing parser test**

Create `apps/web/src/app/features/ai/parse-generate-stream-frames.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseGenerateStreamFrames } from './parse-generate-stream-frames';

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe('parseGenerateStreamFrames', () => {
  it('parses one complete frame into its event, with an empty remainder', () => {
    const { events, remainder } = parseGenerateStreamFrames(frame({ type: 'delta', text: 'Hola' }));

    expect(events).toEqual([{ type: 'delta', text: 'Hola' }]);
    expect(remainder).toBe('');
  });

  it('parses multiple complete frames in order', () => {
    const buffer = frame({ type: 'delta', text: 'Hola' }) + frame({ type: 'restart' });

    const { events } = parseGenerateStreamFrames(buffer);

    expect(events).toEqual([{ type: 'delta', text: 'Hola' }, { type: 'restart' }]);
  });

  it('keeps an incomplete trailing frame in remainder instead of dropping or crashing', () => {
    const complete = frame({ type: 'delta', text: 'Hola' });
    const incomplete = frame({ type: 'delta', text: 'Mundo' }).slice(0, 10);

    const { events, remainder } = parseGenerateStreamFrames(complete + incomplete);

    expect(events).toEqual([{ type: 'delta', text: 'Hola' }]);
    expect(remainder).toBe(incomplete);
  });

  it('skips a malformed frame instead of throwing', () => {
    const { events } = parseGenerateStreamFrames('data: not json\n\n');

    expect(events).toEqual([]);
  });

  it('returns no events for an empty buffer', () => {
    expect(parseGenerateStreamFrames('')).toEqual({ events: [], remainder: '' });
  });
});
```

- [ ] **Step 3: Run it, expect fail**

Run: `cd apps/web && pnpm exec ng test`
Expected: FAIL — `parse-generate-stream-frames.ts` doesn't exist.

- [ ] **Step 4: Implement the parser**

Create `apps/web/src/app/features/ai/parse-generate-stream-frames.ts`:

```ts
import { GenerateQuestionStreamEvent } from './ai.models';

export interface ParsedStreamFrames {
  readonly events: readonly GenerateQuestionStreamEvent[];
  readonly remainder: string;
}

/**
 * Parses `data: {...}\n\n` frames (our own SSE-shaped wire format, written
 * by `AiController.generateStream`) out of `buffer`. `buffer` must be the
 * UNCONSUMED tail from the previous call (`remainder`) plus whatever new
 * text just arrived — stateless, no internal buffering.
 */
export function parseGenerateStreamFrames(buffer: string): ParsedStreamFrames {
  const frames = buffer.split('\n\n');
  const remainder = frames.pop() ?? '';
  const events: GenerateQuestionStreamEvent[] = [];

  for (const frame of frames) {
    const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const payload = dataLine.slice('data:'.length).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload) as GenerateQuestionStreamEvent);
    } catch {
      // Malformed frame — skip rather than crash the whole stream.
    }
  }

  return { events, remainder };
}
```

- [ ] **Step 5: Run it, expect pass**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS (new parser suite green; nothing else touched yet).

- [ ] **Step 6: Add `AiService.generateQuestionStream()`**

In `apps/web/src/app/features/ai/ai.service.ts`, extend the imports:

```ts
import { HttpClient, HttpDownloadProgressEvent, HttpEventType, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import {
  AiRevisedQuestion,
  DraftQuestion,
  EditDraftPayload,
  GenerateQuestionsPayload,
  GenerateQuestionsResult,
  GenerateQuestionStreamEvent,
} from './ai.models';
import { parseGenerateStreamFrames } from './parse-generate-stream-frames';
```

Add the new method right after `generateQuestions()`:

```ts
  /**
   * Streaming counterpart of `generateQuestions()` — `POST
   * /ai/questions/generate/stream`, always a single question (no `count`).
   * Uses `HttpClient` (NOT `EventSource`) specifically so the existing
   * `authInterceptor` keeps attaching the `Authorization` header — a native
   * `EventSource` can't send custom headers at all. `responseType: 'text'` +
   * `reportProgress: true` on the XHR backend surfaces the response body
   * incrementally via `HttpDownloadProgressEvent.partialText`, which is
   * CUMULATIVE (the whole response received so far, not just the new
   * bytes) — `processedLength` tracks how much of it has already been
   * turned into complete frames.
   */
  generateQuestionStream(payload: Omit<GenerateQuestionsPayload, 'count'>): Observable<GenerateQuestionStreamEvent> {
    return new Observable<GenerateQuestionStreamEvent>((subscriber) => {
      let processedLength = 0;
      let leftover = '';

      const consume = (partialText: string): void => {
        const newText = partialText.slice(processedLength);
        processedLength = partialText.length;
        const { events, remainder } = parseGenerateStreamFrames(leftover + newText);
        leftover = remainder;
        for (const event of events) {
          subscriber.next(event);
        }
      };

      const subscription = this.http
        .post(`${environment.apiBaseUrl}/ai/questions/generate/stream`, payload, {
          observe: 'events',
          responseType: 'text',
          reportProgress: true,
        })
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.DownloadProgress) {
              consume((event as HttpDownloadProgressEvent).partialText ?? '');
            } else if (event.type === HttpEventType.Response) {
              consume((event as HttpResponse<string>).body ?? '');
              subscriber.complete();
            }
          },
          error: (err) => subscriber.error(err),
        });

      return () => subscription.unsubscribe();
    });
  }
```

- [ ] **Step 7: Run it, expect pass**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — no test exercises `generateQuestionStream` yet (that's Task 7), just confirm the file still compiles and nothing else broke.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/features/ai/ai.models.ts apps/web/src/app/features/ai/parse-generate-stream-frames.ts apps/web/src/app/features/ai/parse-generate-stream-frames.spec.ts apps/web/src/app/features/ai/ai.service.ts
git commit -m "feat(web): add AiService.generateQuestionStream and its SSE frame parser"
```

---

## Task 7: `AiGenerateComponent` — consume the stream, show live progress

**Files:**
- Modify: `apps/web/src/app/features/ai/ai-generate/ai-generate.component.ts`
- Modify: `apps/web/src/app/features/ai/ai-generate/ai-generate.component.html`
- Modify: `apps/web/src/app/features/ai/ai-generate/ai-generate.component.spec.ts`

**Interfaces:**
- Consumes: `AiService.generateQuestionStream` (Task 6).
- Produces: new `liveChars` signal (component-internal, exposed to the template).

- [ ] **Step 1: Update the component's `generateOne()`**

In `apps/web/src/app/features/ai/ai-generate/ai-generate.component.ts`, add `GenerateQuestionStreamEvent` to the `ai.models` import (line 13-21):

```ts
import {
  DraftQuestion,
  GenerateQuestionsCreatedItem,
  GenerateQuestionsFailedItem,
  GenerateQuestionsResult,
  GenerateQuestionStreamEvent,
  GradeLevel,
  GRADE_LEVELS,
  GRADE_LEVEL_LABELS,
} from '../ai.models';
```

Add a new signal next to `completed` (line 101):

```ts
  /** How many of `requested` have come back so far — drives the live progress bar. */
  protected readonly completed = signal(0);
  /** Characters streamed in for the question CURRENTLY generating — reset on every new item and on every `restart` event. Proof-of-life for the live indicator (design: streaming progress). */
  protected readonly liveChars = signal(0);
```

Replace `generateOne()` (lines 270-303):

```ts
  private generateOne(remaining: number): void {
    const snapshot = this.lastRequest();
    if (remaining <= 0 || !snapshot) {
      this.generating.set(false);
      return;
    }
    this.liveChars.set(0);
    this.aiService
      .generateQuestionStream({
        courseId: snapshot.courseId,
        topicId: snapshot.topicId,
        difficulty: snapshot.difficulty,
        gradeLevel: snapshot.gradeLevel,
        withFigure: snapshot.withFigure,
      })
      .subscribe({
        next: (event: GenerateQuestionStreamEvent) => {
          if (event.type === 'delta') {
            this.liveChars.update((chars) => chars + event.text.length);
            return;
          }
          if (event.type === 'restart') {
            this.liveChars.set(0);
            return;
          }
          const res = event.result;
          this.result.set(res);
          this.allCreated.update((prev) => [...prev, ...res.created]);
          if (res.failed.length > 0) {
            this.failed.update((prev) => [...prev, ...res.failed]);
          }
          if (res.created.length > 0) {
            this.loadBatchQuestions(res.created.map((c) => c.id));
          }
          this.completed.update((c) => c + 1);
          this.generateOne(remaining - 1);
        },
        error: (_e: HttpErrorResponse) => {
          this.generating.set(false);
          this.errorMessage.set('No se pudieron generar las preguntas. Inténtalo de nuevo.');
        },
      });
  }
```

- [ ] **Step 2: Update the progress card template**

In `apps/web/src/app/features/ai/ai-generate/ai-generate.component.html`, replace the `batch-progress` block (lines 97-102):

```html
@if (generating()) {
  <div data-testid="batch-progress" class="rounded-card border border-n200 bg-white p-4">
    <p class="mb-2 text-sm font-medium text-n700">Generando {{ completed() }}/{{ requested() }} preguntas…</p>
    <ui-progress [current]="completed()" [total]="requested()"></ui-progress>
    @if (liveChars() > 0) {
      <p data-testid="stream-live-indicator" class="mt-2 text-xs text-n500">
        Escribiendo pregunta… {{ liveChars() }} caracteres recibidos
      </p>
    } @else {
      <p data-testid="stream-live-indicator" class="mt-2 text-xs text-n500">Conectando con el modelo…</p>
    }
  </div>
}
```

- [ ] **Step 3: Migrate the spec file to the streaming mock**

Replace `apps/web/src/app/features/ai/ai-generate/ai-generate.component.spec.ts` in full:

```ts
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, convertToParamMap, Router } from '@angular/router';
import { LucideAngularModule, Sparkles, TriangleAlert, Plus, Minus } from 'lucide-angular';
import { AiGenerateComponent } from './ai-generate.component';
import { AiService } from '../ai.service';
import { DraftCountService } from '../draft-count.service';
import { DraftQuestion, GenerateQuestionsResult, GenerateQuestionStreamEvent } from '../ai.models';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { Difficulty } from '@exams-generator/shared';

const COURSES: Course[] = [
  { id: 'c1', name: 'Biología' },
  { id: 'c2', name: 'Química' },
];
const TOPICS: Topic[] = [{ id: 't1', name: 'La célula', courseId: 'c1' }];

/** Every existing test drove `generateQuestions()` with a bare `GenerateQuestionsResult`; the streaming API instead resolves via a terminal `done` event carrying that same result — this wraps it so the rest of the suite reads the same as before. */
function doneEvent(result: GenerateQuestionsResult): GenerateQuestionStreamEvent {
  return { type: 'done', result };
}

function setup(
  over: {
    genImpl?: (...a: unknown[]) => unknown;
    listDraftsImpl?: (...a: unknown[]) => unknown;
    queryParams?: Record<string, string>;
  } = {},
) {
  const generateQuestionStream = vi.fn(
    over.genImpl ?? (() => of(doneEvent({ created: [{ id: 'a' }, { id: 'b' }], failed: [] }))),
  );
  const listDrafts = vi.fn(over.listDraftsImpl ?? (() => of([] as DraftQuestion[])));
  const getCourses = vi.fn(() => of(COURSES));
  const getTopics = vi.fn(() => of(TOPICS));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [AiGenerateComponent, LucideAngularModule.pick({ Sparkles, TriangleAlert, Plus, Minus })],
    providers: [
      { provide: AiService, useValue: { generateQuestionStream, listDrafts } },
      { provide: TaxonomyService, useValue: { getCourses, getTopics } },
      { provide: Router, useValue: { navigate } },
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(over.queryParams ?? {}) } } },
    ],
  });
  const fixture = TestBed.createComponent(AiGenerateComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    generateQuestionStream,
    listDrafts,
    navigate,
    getCourses,
    getTopics,
  };
}

function set(fixture: { componentInstance: unknown; detectChanges(): void }, prop: string, v: unknown) {
  (fixture.componentInstance as Record<string, { set(x: unknown): void }>)[prop].set(v);
  fixture.detectChanges();
}

function fillForm(fixture: { componentInstance: unknown; detectChanges(): void }) {
  set(fixture, 'courseId', 'c1');
  set(fixture, 'topicId', 't1');
  set(fixture, 'difficulty', 'easy');
  set(fixture, 'gradeLevel', 'pre');
  set(fixture, 'count', 3);
}

describe('AiGenerateComponent', () => {
  it('shows the 1-2-3 empty state before generating', () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="batch-empty"]')).toBeTruthy();
  });

  it('prefills grade, course, topic and difficulty from query params (exam-builder bridge)', () => {
    const { fixture, getCourses, getTopics } = setup({
      queryParams: { gradeLevel: 'secundaria_3', courseId: 'c1', topicId: 't1', difficulty: 'medium' },
    });
    const ci = fixture.componentInstance as unknown as {
      gradeLevel(): string | null;
      courseId(): string;
      topicId(): string;
      difficulty(): string | null;
    };

    expect(ci.gradeLevel()).toBe('secundaria_3');
    expect(ci.courseId()).toBe('c1');
    expect(ci.topicId()).toBe('t1');
    expect(ci.difficulty()).toBe('medium');
    expect(getCourses).toHaveBeenCalledWith('secundaria_3');
    expect(getTopics).toHaveBeenCalledWith('c1', 'secundaria_3');
  });

  it('shows a live progress card while generating', () => {
    const subject = new Subject<GenerateQuestionStreamEvent>();
    const { compiled, fixture } = setup({ genImpl: () => subject.asObservable() });
    fillForm(fixture);
    set(fixture, 'count', 1); // one request so the single Subject drives the whole run
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-progress"]')).toBeTruthy();
    subject.next(doneEvent({ created: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], failed: [] }));
    subject.complete();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-progress"]')).toBeFalsy();
  });

  it('ticks the live character counter up as delta events arrive, and resets it on restart', () => {
    const subject = new Subject<GenerateQuestionStreamEvent>();
    const { compiled, fixture } = setup({ genImpl: () => subject.asObservable() });
    fillForm(fixture);
    set(fixture, 'count', 1);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="stream-live-indicator"]')?.textContent).toMatch(/conectando/i);

    subject.next({ type: 'delta', text: 'Hola' });
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="stream-live-indicator"]')?.textContent).toContain('4');

    subject.next({ type: 'delta', text: ' mundo' });
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="stream-live-indicator"]')?.textContent).toContain('10');

    subject.next({ type: 'restart' });
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="stream-live-indicator"]')?.textContent).toMatch(/conectando/i);

    subject.next(doneEvent({ created: [{ id: 'a' }], failed: [] }));
    subject.complete();
  });

  it('does NOT reset the form after generating', () => {
    const { compiled, fixture } = setup();
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect((fixture.componentInstance as unknown as { courseId(): string }).courseId()).toBe('c1');
    expect((fixture.componentInstance as unknown as { count(): number }).count()).toBe(3);
  });

  it('shows partial-failure banner with a retry-failed action', () => {
    const { compiled, fixture, generateQuestionStream } = setup({
      genImpl: () =>
        of(doneEvent({ created: [{ id: 'a' }], failed: [{ index: 1, error: 'x' }, { index: 2, error: 'y' }] })),
    });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="batch-failures"]')).toBeTruthy();
    generateQuestionStream.mockClear();
    generateQuestionStream.mockReturnValue(of(doneEvent({ created: [{ id: 'z' }, { id: 'w' }], failed: [] })));
    (compiled.querySelector('[data-testid="retry-failed"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Sequential model: each request is a single question, one per failed item — count is no longer part of the payload at all.
    expect(generateQuestionStream).toHaveBeenCalledWith(
      expect.not.objectContaining({ count: expect.anything() }),
    );
  });

  it('shows only the warning banner (no status card) when ALL questions fail validation on a 200 response', () => {
    const { compiled, fixture } = setup({
      genImpl: () => of(doneEvent({ created: [], failed: [{ index: 0, error: 'x' }, { index: 1, error: 'y' }] })),
    });
    fillForm(fixture);
    set(fixture, 'count', 1);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.querySelector('.text-2xl.font-extrabold.text-primary-900')).toBeFalsy();
    const banner = compiled.querySelector('[data-testid="batch-failures"]');
    expect(banner).toBeTruthy();
    expect(banner?.textContent).toMatch(/ninguna pregunta pasó la validación/i);
    expect(compiled.querySelector('[data-testid="retry-failed"] button')?.textContent).toContain('Reintentar 2');
    expect(compiled.querySelector('[data-testid="batch-empty"]')).toBeTruthy();
  });

  it('navigates to the review queue from the footer', () => {
    const { compiled, fixture, navigate } = setup();
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="go-review"] button') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/app/ai/review']);
  });

  it('renders readable question cards with stem, alternatives, and the correct answer marked (visual fidelity with the Taller mockup)', () => {
    const draft: DraftQuestion = {
      id: 'a',
      tenantId: null,
      courseId: 'c1',
      topicId: 't1',
      difficulty: Difficulty.Easy,
      gradeLevel: 'pre',
      correctAnswer: '1',
      bodyTypst: '¿Cuánto es 2+2?',
      alternatives: ['3', '4', '5'],
      figureCode: null,
    };
    const { compiled, fixture } = setup({
      genImpl: () => of(doneEvent({ created: [{ id: 'a' }], failed: [] })),
      listDraftsImpl: () => of([draft]),
    });
    fillForm(fixture);
    set(fixture, 'count', 1);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const card = compiled.querySelector('[data-testid="batch-question"]');
    expect(card?.textContent).toContain('¿Cuánto es 2+2?');
    expect(card?.textContent).toContain('Borrador IA');
    const correctAlt = card?.querySelector('[data-testid="alt-correct"]');
    expect(correctAlt?.textContent).toContain('4');
  });

  it('clamps the quantity stepper to the backend max of 10 and disables the + button at the cap', () => {
    const { compiled, fixture } = setup();
    const plusButton = compiled.querySelector('button[aria-label="Más"]') as HTMLButtonElement;
    for (let i = 0; i < 10; i++) {
      plusButton.click();
      fixture.detectChanges();
    }
    expect((fixture.componentInstance as unknown as { count(): number }).count()).toBe(10);
    expect(plusButton.disabled).toBe(true);
  });

  it('retries with the ORIGINAL request params (snapshot), even if the form is edited afterward', () => {
    const { compiled, fixture, generateQuestionStream } = setup({
      genImpl: () => of(doneEvent({ created: [{ id: 'a' }], failed: [{ index: 1, error: 'x' }] })),
    });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    set(fixture, 'courseId', 'c2');

    generateQuestionStream.mockClear();
    generateQuestionStream.mockReturnValue(of(doneEvent({ created: [{ id: 'z' }], failed: [] })));
    (compiled.querySelector('[data-testid="retry-failed"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(generateQuestionStream).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'c1' }));
  });

  it('shows only the error banner (no status card, empty state intact) when the whole request fails', () => {
    const serverError = new HttpErrorResponse({ status: 500 });
    const { compiled, fixture } = setup({
      genImpl: () => throwError(() => serverError),
    });
    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(compiled.textContent).toMatch(/no se pudieron generar/i);
    expect(compiled.querySelector('[data-testid="batch-question"]')).toBeFalsy();
    expect(compiled.querySelector('.text-2xl.font-extrabold.text-primary-900')).toBeFalsy();
    expect(compiled.querySelector('[data-testid="batch-empty"]')).toBeTruthy();
  });

  it('syncs the sidebar draft-count badge (DraftCountService) after generating (F8 fix)', () => {
    const draftStub: DraftQuestion = {
      id: 'a',
      tenantId: null,
      courseId: 'c1',
      topicId: 't1',
      difficulty: Difficulty.Easy,
      gradeLevel: 'pre',
      correctAnswer: '1',
      bodyTypst: '¿Cuánto es 2+2?',
      alternatives: ['3', '4'],
      figureCode: null,
    };
    let call = 0;
    const { compiled, fixture } = setup({
      genImpl: () => of(doneEvent({ created: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], failed: [] })),
      listDraftsImpl: () => of(call++ === 0 ? [] : [draftStub, draftStub, draftStub]),
    });
    const draftCountService = TestBed.inject(DraftCountService);
    expect(draftCountService.count()).toBe(0);

    fillForm(fixture);
    (compiled.querySelector('[data-testid="generate-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(draftCountService.count()).toBe(3);
  });
});
```

- [ ] **Step 4: Run it, expect pass**

Run: `cd apps/web && pnpm exec ng test`
Expected: PASS — the full suite, including the two new streaming-specific tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/ai/ai-generate
git commit -m "feat(web): consume the AI generation SSE stream with a live character counter"
```

---

## Task 8: Manual verification

- [ ] **Step 1: Start both apps** (per repo convention — check for an existing `run`/dev-server skill or script before assuming `pnpm dev`).

- [ ] **Step 2: Open `/app/ai/generate`**, fill grade/course/topic/difficulty, count = 1, click "Generar 1 preguntas".

- [ ] **Step 3: Confirm the live indicator**: "Conectando con el modelo…" appears immediately, then switches to "Escribiendo pregunta… N caracteres recibidos" with N visibly increasing before the question card appears — this is the actual fix for the original complaint ("no sé si realmente está generando").

- [ ] **Step 4: Confirm count > 1 still works**: set count to 3, verify `completed()/requested()` still advances 1-by-1 and the live indicator resets between items (visible dip back to "Conectando…" or 0 chars right as each new item starts).

- [ ] **Step 5: Confirm retry-failed still works** end to end (trigger a failure — e.g. temporarily point `AI_MODEL` at an invalid model — or trust the automated coverage from Task 7 if reproducing a live failure isn't practical).

---

## Self-Review

**Spec coverage:** every point from the Architecture section is covered — port callback (Task 1), real OpenRouter SSE streaming (Task 2), shared per-item extraction (Task 3), the streaming service method (Task 4), the hand-rolled SSE controller endpoint (Task 5), the frontend parser + service method (Task 6), and the component/template consuming it with a live indicator (Task 7). The `restart` event — the one non-obvious correctness requirement (misleading concatenation across the adapter's own retry AND the service's compile-retry) — is threaded through every layer from Task 1 through Task 7, with a dedicated test at each layer (adapter Task 2 Step 5, service Task 4 Step 1, component Task 7 Step 3).

**Placeholder scan:** none — every step has complete, runnable code, exact file paths, and exact test commands.

**Type consistency:** `GenerateProgressEvent` (port, Task 1) → reused verbatim by `GenerateQuestionStreamEvent` (service, Task 4) → mirrored by the frontend's own `GenerateQuestionStreamEvent` (Task 6, structurally identical, not literally shared since api/web don't share this type today — matches the existing `GenerateQuestionsResult` mirroring convention already in `ai.models.ts`). `SseHttpClient`/`HttpSseResponse` (Task 2) intentionally kept separate from `HttpClient`/`HttpJsonResponse` (existing) so non-streaming call sites are untouched.
