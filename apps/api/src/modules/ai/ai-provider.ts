import { OpenRouterAdapter } from "./adapters/openrouter/openrouter.adapter";
import { QuestionGeneratorPort } from "./domain/ports/question-generator.port";

/**
 * Resolves the real `OpenRouterAdapter` from env, mirroring
 * `resolveStorageAdapter` in the bank module. `AI_MODEL` is read here and
 * ONLY here for production wiring — it is NEVER hardcoded, because
 * OpenRouter's free-tier model list rotates (see design doc §4/§6 and
 * `infra/env.example`). Throws a clear, actionable error if either
 * required env var is missing, instead of silently defaulting (unlike
 * `resolveStorageAdapter`, there is no safe default for an AI model/key).
 */
export function resolveQuestionGeneratorAdapter(): QuestionGeneratorPort {
  const model = process.env.AI_MODEL;
  if (!model) {
    throw new Error(
      "AI_MODEL env var is not set. Set it to a valid OpenRouter model id (see infra/env.example) — the model is never hardcoded because the free-tier model list rotates.",
    );
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY env var is not set. Set it to a valid OpenRouter API key (see infra/env.example).",
    );
  }

  return new OpenRouterAdapter({ apiKey, model });
}
