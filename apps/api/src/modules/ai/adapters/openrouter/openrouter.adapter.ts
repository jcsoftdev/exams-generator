import {
  AiGenerationError,
  AiInvalidResponseError,
  AiRateLimitError,
  ExtractQuestionInput,
  GenerateQuestionInput,
  GeneratedQuestion,
  QuestionGeneratorPort,
  ReviseQuestionInput,
} from "../../domain/ports/question-generator.port";
import { buildOpenRouterRequestBody } from "./openrouter-request-builder";
import { parseGeneratedQuestionContent } from "./openrouter-response-parser";
import { validateGeneratedQuestionShape } from "./openrouter-response-validator";

const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";
const MAX_ATTEMPTS = 2;

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

export const fetchHttpClient: HttpClient = (url, init) =>
  fetch(url, init) as unknown as Promise<HttpJsonResponse>;

export interface OpenRouterAdapterConfig {
  readonly apiKey: string;
  /**
   * ALWAYS resolved by the caller from `process.env.AI_MODEL` — this
   * adapter never hardcodes a model name (the OpenRouter free-tier model
   * list rotates; see design doc §4/§6).
   */
  readonly model: string;
  readonly httpClient?: HttpClient;
  readonly baseUrl?: string;
}

interface AttemptOutcome {
  readonly ok: boolean;
  readonly question?: GeneratedQuestion;
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
  private readonly baseUrl: string;

  constructor(private readonly config: OpenRouterAdapterConfig) {
    this.httpClient = config.httpClient ?? fetchHttpClient;
    this.baseUrl = config.baseUrl ?? OPENROUTER_CHAT_COMPLETIONS_URL;
  }

  async generate(input: GenerateQuestionInput): Promise<GeneratedQuestion> {
    let lastOutcome: AttemptOutcome | undefined;

    for (let attemptNumber = 1; attemptNumber <= MAX_ATTEMPTS; attemptNumber++) {
      const outcome = await this.attempt(input, lastOutcome?.error);
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

  // TODO(task: revise/extract OpenRouter impl): stubbed to satisfy
  // `QuestionGeneratorPort` — real implementation is a later task.
  async reviseQuestion(_input: ReviseQuestionInput): Promise<GeneratedQuestion> {
    throw new Error("OpenRouterAdapter.reviseQuestion is not implemented yet");
  }

  // TODO(task: revise/extract OpenRouter impl): stubbed to satisfy
  // `QuestionGeneratorPort` — real implementation is a later task.
  async extractFromImage(_input: ExtractQuestionInput): Promise<GeneratedQuestion> {
    throw new Error("OpenRouterAdapter.extractFromImage is not implemented yet");
  }

  private async attempt(
    input: GenerateQuestionInput,
    previousError: string | undefined,
  ): Promise<AttemptOutcome> {
    const requestBody = buildOpenRouterRequestBody(this.config.model, input, {
      previousError,
    });

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
      throw new AiGenerationError(`OpenRouter request failed with status ${response.status}`);
    }

    const json = await response.json();
    let rawContent = "";

    try {
      rawContent = extractMessageContent(json);
      const parsed = parseGeneratedQuestionContent(rawContent);
      const question = validateGeneratedQuestionShape(parsed);
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
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.length === 0) {
    throw new Error("OpenRouter response is missing choices[0].message.content");
  }
  return content;
}
