import { OpenRouterAdapter } from "./adapters/openrouter/openrouter.adapter";
import { QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { resolveAiProviderConfig } from "./resolve-ai-provider-config";

/**
 * Wires the real adapter from environment, mirroring `resolveStorageAdapter`
 * in the bank module. Every env rule — which vars, which defaults, which
 * errors — lives in `resolveAiProviderConfig` so it can be tested as a pure
 * function; this is just the construction.
 *
 * `OpenRouterAdapter` keeps its name because it is still the default
 * endpoint, but it is really an OpenAI-chat-completions adapter: set
 * `AI_BASE_URL` and it talks to any compatible provider.
 */
export function resolveQuestionGeneratorAdapter(): QuestionGeneratorPort {
  return new OpenRouterAdapter(resolveAiProviderConfig(process.env));
}
