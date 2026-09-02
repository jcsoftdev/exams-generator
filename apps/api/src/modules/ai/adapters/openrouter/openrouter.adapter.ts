import {
  AiGenerationError,
  AiInvalidResponseError,
  AiRateLimitError,
  ExtractedQuestion,
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
  OpenRouterResponseFormatMode,
  OpenRouterThinkingMode,
} from "./openrouter-request-builder";
import { assessGeneratedQuestionPlausibility } from "./openrouter-content-plausibility-validator";
import { assertDifficultyMatchesSelfReport } from "./openrouter-difficulty-gate";
import { parseGeneratedQuestionContent } from "./openrouter-response-parser";
import {
  QuestionSelfReport,
  validateExtractedQuestionShape,
  validateGeneratedQuestionShape,
} from "./openrouter-response-validator";
import { parseOpenRouterSseBuffer } from "./openrouter-sse-parser";

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ATTEMPTS = 2;
// Non-streaming calls (reviseQuestion/extractFromImage) should come back
// fast; streaming (generate) can legitimately take longer to finish a full
// completion, hence the higher ceiling. Both throw AiGenerationError on
// abort, same as any other OpenRouter failure — the BullMQ job retries it
// rather than a worker hanging on a stalled connection forever.
const REQUEST_TIMEOUT_MS = 30_000;
const SSE_TIMEOUT_MS = 120_000;

export interface HttpJsonResponse {
  readonly status: number;
  json(): Promise<unknown>;
}

/**
 * Abstraction over "POST this JSON body to this URL, get back a JSON
 * response". Injectable so the adapter's parsing/retry/rate-limit handling
 * can be unit-tested (fake client, deterministic responses) without any
 * real network call — mirrors `CompileRunner` in `TypstCliAdapter`. The
 * default `fetchHttpClient` is what production code actually uses.
 */
export type HttpClient = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<HttpJsonResponse>;

export const fetchHttpClient: HttpClient = async (url, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return (await fetch(url, { ...init, signal: controller.signal })) as unknown as HttpJsonResponse;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new AiGenerationError(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
};

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

export const fetchSseHttpClient: SseHttpClient = async (url, init) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return (await fetch(url, { ...init, signal: controller.signal })) as unknown as HttpSseResponse;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      throw new AiGenerationError(`OpenRouter request timed out after ${REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
};

/**
 * Wraps an SSE body iterable with a per-chunk idle timeout: if no chunk
 * arrives within `SSE_TIMEOUT_MS` of the previous one, the iteration throws
 * instead of hanging — this is what actually protects the 2 BullMQ workers
 * from a stalled OpenRouter stream (the initial `fetchSseHttpClient` timeout
 * above only covers connection setup, not a stream that goes silent mid-way).
 */
async function* withIdleTimeout(body: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  const iterator = body[Symbol.asyncIterator]();
  try {
    while (true) {
      let timer: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new AiGenerationError(`OpenRouter stream stalled for ${SSE_TIMEOUT_MS}ms`)),
          SSE_TIMEOUT_MS,
        );
      });
      try {
        const { value, done } = await Promise.race([iterator.next(), timeoutPromise]);
        if (done) return;
        yield value;
      } finally {
        clearTimeout(timer!);
      }
    }
  } finally {
    await iterator.return?.();
  }
}

/**
 * The provider's error body, truncated, for the `AiGenerationError` message.
 * Without it a DeepSeek "Model Not Exist" or a schema rejection reaches the
 * log as a bare "status 400" and the cause has to be reproduced by hand.
 * Never throws: a body that is not JSON just contributes nothing.
 */
async function providerErrorDetail(response: HttpJsonResponse): Promise<string> {
  try {
    const body: unknown = await response.json();
    const text = typeof body === "string" ? body : JSON.stringify(body);
    return text ? `: ${text.slice(0, 300)}` : "";
  } catch {
    return "";
  }
}

export interface OpenRouterAdapterConfig {
  readonly apiKey: string;
  /**
   * ALWAYS resolved by the caller from `process.env.AI_MODEL` — this
   * adapter never hardcodes a model name (the OpenRouter free-tier model
   * list rotates; see design doc §4/§6).
   */
  readonly model: string;
  /**
   * Separate model for `extractFromImage` (multimodal): the best free
   * academic text model has no vision, so image extraction routes to a
   * vision-capable model instead. Resolved from `process.env.AI_VISION_MODEL`;
   * falls back to `model` when unset. Never hardcoded (free list rotates).
   */
  readonly visionModel?: string;
  /**
   * `json_schema` (default, OpenRouter/OpenAI strict output) or `json_object`
   * (DeepSeek's own API and other providers with JSON mode only). Resolved
   * from `process.env.AI_RESPONSE_FORMAT`.
   */
  readonly responseFormat?: OpenRouterResponseFormatMode;
  /** Provider reasoning switch, from `process.env.AI_THINKING`; unset = not sent. */
  readonly thinking?: OpenRouterThinkingMode;
  readonly httpClient?: HttpClient;
  readonly sseHttpClient?: SseHttpClient;
  readonly baseUrl?: string;
}

interface AttemptOutcome<Q> {
  readonly ok: boolean;
  readonly question?: Q;
  readonly error?: string;
  readonly rawContent?: string;
}

/**
 * `QuestionGeneratorPort` adapter backed by OpenRouter's chat-completions
 * API with structured (`json_schema`) output. Handles "thinking" models
 * (e.g. `deepseek/deepseek-r1:free`) whose `content` may carry inline
 * reasoning before the JSON, or that carry reasoning in a dedicated
 * `message.reasoning` field — that field is always ignored, only
 * `message.content` is ever parsed.
 *
 * Error handling per design doc §7:
 *  - Invalid/unparseable JSON in `content` → retries ONCE with the
 *    validation error fed back into the prompt. Fails both times →
 *    `AiInvalidResponseError`. NEVER resolves without passing validation.
 *  - HTTP 429 (free-tier quota exhausted) → `AiRateLimitError` immediately,
 *    no retry (retrying an exhausted quota instantly won't help).
 */
export class OpenRouterAdapter implements QuestionGeneratorPort {
  private readonly httpClient: HttpClient;
  private readonly sseHttpClient: SseHttpClient;
  private readonly baseUrl: string;
  /** Model used by `extractFromImage` — the vision model, or `model` when none is configured. */
  private readonly visionModel: string;

  constructor(private readonly config: OpenRouterAdapterConfig) {
    this.httpClient = config.httpClient ?? fetchHttpClient;
    this.sseHttpClient = config.sseHttpClient ?? fetchSseHttpClient;
    this.baseUrl = config.baseUrl ?? OPENROUTER_CHAT_COMPLETIONS_URL;
    this.visionModel = config.visionModel ?? config.model;
  }

  async generate(
    input: GenerateQuestionInput,
    onProgress?: (event: GenerateProgressEvent) => void,
    previousCompileError?: string,
  ): Promise<GeneratedQuestion> {
    return this.runWithRetries(
      (previousError) =>
        buildOpenRouterRequestBody(this.config.model, input, {
          previousError,
          responseFormat: this.config.responseFormat,
          thinking: this.config.thinking,
        }),
      validateGeneratedQuestionShape,
      onProgress,
      previousCompileError,
      (question, selfReport) => {
        assessGeneratedQuestionPlausibility(question, input);
        assertDifficultyMatchesSelfReport(selfReport, input.difficulty);
      },
    );
  }

  /**
   * Same retry/parse/validate pipeline as `generate()` — only the request
   * body differs: the user message carries the CURRENT question (statement +
   * alternatives + correct-answer LETTER, per the port contract) plus the
   * human editor's instruction, and asks for the SAME JSON schema. Returns
   * `correctAnswer` as a LETTER — this adapter never converts letter/index,
   * that's the calling service's job.
   */
  async reviseQuestion(input: ReviseQuestionInput): Promise<GeneratedQuestion> {
    return this.runWithRetries(
      (previousError) =>
        buildOpenRouterReviseRequestBody(this.config.model, input, {
          previousError,
          responseFormat: this.config.responseFormat,
          thinking: this.config.thinking,
        }),
      validateGeneratedQuestionShape,
    );
  }

  /**
   * Same retry/parse pipeline as `generate()` — the request is a MULTIMODAL
   * chat message with an `image_url` data-URI part built from the raw image
   * bytes, asking for the extract-only JSON schema — but validated against
   * `validateExtractedQuestionShape`, NOT `validateGeneratedQuestionShape`:
   * a photo may show fewer than 5 alternatives or no identifiable key, and
   * this path must never invent either to satisfy the stricter shape
   * `generate()`/`reviseQuestion()` require (see `ExtractedQuestion`'s
   * docstring in `question-generator.port.ts`).
   */
  async extractFromImage(input: ExtractQuestionInput): Promise<ExtractedQuestion> {
    return this.runWithRetries(
      (previousError) =>
        buildOpenRouterExtractRequestBody(this.visionModel, input, {
          previousError,
          responseFormat: this.config.responseFormat,
          thinking: this.config.thinking,
        }),
      validateExtractedQuestionShape,
    );
  }

  /**
   * Shared retry loop for `generate`/`reviseQuestion`/`extractFromImage`:
   * builds a fresh request body for each attempt (the previous attempt's
   * validation error, if any, is fed back into the prompt), and only ever
   * resolves with a fully parsed+validated `GeneratedQuestion` — per design
   * doc §7 this port NEVER returns unvalidated content.
   *
   * `seedError`, when given, primes attempt 1 with an error from OUTSIDE this
   * loop (e.g. `generate()`'s `previousCompileError` — a Typst failure from a
   * prior call the caller made with this same input). It's just the initial
   * value of `lastOutcome.error`; the adapter's own validation-retry error
   * (if attempt 1 fails differently) overwrites it for attempt 2, same as always.
   */
  private async runWithRetries<Q>(
    buildRequestBody: (previousError: string | undefined) => OpenRouterRequestBody,
    validate: (parsed: unknown) => { readonly question: Q; readonly selfReport: QuestionSelfReport },
    onProgress?: (event: GenerateProgressEvent) => void,
    seedError?: string,
    contentGuard?: (question: Q, selfReport: QuestionSelfReport) => void,
  ): Promise<Q> {
    let lastOutcome: AttemptOutcome<Q> | undefined = seedError ? { ok: false, error: seedError } : undefined;

    for (let attemptNumber = 1; attemptNumber <= MAX_ATTEMPTS; attemptNumber++) {
      if (attemptNumber > 1) {
        onProgress?.({ type: "restart" });
      }
      const outcome = onProgress
        ? await this.attemptStreaming(
            buildRequestBody(lastOutcome?.error),
            validate,
            onProgress,
            contentGuard,
          )
        : await this.attempt(buildRequestBody(lastOutcome?.error), validate, contentGuard);
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

  private async attempt<Q>(
    requestBody: OpenRouterRequestBody,
    validate: (parsed: unknown) => { readonly question: Q; readonly selfReport: QuestionSelfReport },
    contentGuard?: (question: Q, selfReport: QuestionSelfReport) => void,
  ): Promise<AttemptOutcome<Q>> {
    const response = await this.httpClient(this.baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (response.status === 429) {
      throw new AiRateLimitError();
    }
    if (response.status >= 400) {
      throw new AiGenerationError(
        `OpenRouter request failed with status ${response.status}${await providerErrorDetail(response)}`,
      );
    }

    const json = await response.json();
    let rawContent = "";

    try {
      rawContent = extractMessageContent(json);
      const parsed = parseGeneratedQuestionContent(rawContent);
      const { question, selfReport } = validate(parsed);
      contentGuard?.(question, selfReport);
      return { ok: true, question };
    } catch (err) {
      return { ok: false, error: (err as Error).message, rawContent };
    }
  }

  private async attemptStreaming<Q>(
    requestBody: OpenRouterRequestBody,
    validate: (parsed: unknown) => { readonly question: Q; readonly selfReport: QuestionSelfReport },
    onProgress: (event: GenerateProgressEvent) => void,
    contentGuard?: (question: Q, selfReport: QuestionSelfReport) => void,
  ): Promise<AttemptOutcome<Q>> {
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

    for await (const chunk of withIdleTimeout(response.body)) {
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
      const { question, selfReport } = validate(parsed);
      contentGuard?.(question, selfReport);
      return { ok: true, question };
    } catch (err) {
      return { ok: false, error: (err as Error).message, rawContent };
    }
  }
}

/**
 * Navigates `choices[0].message.content` out of the raw OpenRouter response
 * body. `message.reasoning` (present on some thinking-model responses) is
 * intentionally never read here — it's discarded chain-of-thought, not the
 * answer.
 */
function extractMessageContent(json: unknown): string {
  const body = json as {
    choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
  };
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    // Name what DID come back: a `finish_reason=length` means the reply was
    // cut before any content (raise max_tokens or shorten the prompt); a
    // message carrying only `reasoning_content` means a thinking model spent
    // the whole budget reasoning. Without this the 422 reads the same either way.
    const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : "unknown";
    const messageKeys = choice?.message ? Object.keys(choice.message).join(",") : "none";
    throw new Error(
      `OpenRouter response is missing choices[0].message.content (finish_reason=${finishReason}, message keys: ${messageKeys})`,
    );
  }
  return content;
}
