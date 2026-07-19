import { OpenRouterAdapter } from "./adapters/openrouter/openrouter.adapter";
import { QuestionGeneratorPort } from "./domain/ports/question-generator.port";

/**
 * Resolves the real `OpenRouterAdapter` from env, mirroring
 * `resolveStorageAdapter` in the bank module. Models are read here and ONLY
 * here for production wiring — NEVER hardcoded, because OpenRouter's free-tier
 * model list rotates (see design doc §4/§6 and `infra/env.example`).
 *
 * Two models, each routed to what it does best:
 *  - `AI_MODEL` (required) — text ops (`generate`, `reviseQuestion`); pick the
 *    strongest academic/reasoning model.
 *  - `AI_VISION_MODEL` (optional) — `extractFromImage` only, which needs a
 *    vision-capable model. Falls back to `AI_MODEL` when unset (fine only if
 *    `AI_MODEL` itself has vision; otherwise image extraction will fail).
 *
 * Throws a clear, actionable error if a required env var is missing.
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

  const visionModel = process.env.AI_VISION_MODEL;

  return new OpenRouterAdapter({ apiKey, model, visionModel });
}
