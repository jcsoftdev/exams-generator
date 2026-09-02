import { OpenRouterAdapterConfig } from "./adapters/openrouter/openrouter.adapter";
import {
  OpenRouterResponseFormatMode,
  OpenRouterThinkingMode,
} from "./adapters/openrouter/openrouter-request-builder";

/** OpenRouter stays the default so no existing deployment has to set a base url. */
const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Only the vars this reads — passing `process.env` satisfies it. */
export type AiProviderEnv = Readonly<Partial<Record<string, string>>>;

function readNonBlank(env: AiProviderEnv, name: string): string | undefined {
  const value = env[name];
  return value !== undefined && value.trim().length > 0 ? value : undefined;
}

/**
 * Builds the adapter config from environment, as a pure function so the env
 * contract is testable without constructing an adapter or reaching for a
 * test-only getter on it.
 *
 * `AI_BASE_URL` is what makes the provider swappable. `OpenRouterAdapter`
 * speaks plain OpenAI chat-completions — `Authorization: Bearer`, a
 * `response_format: json_schema` body, nothing OpenRouter-specific in the
 * headers — so pointing it at any OpenAI-compatible endpoint (DeepSeek's own
 * API, for one) needs a url, not a second adapter.
 *
 * `AI_API_KEY` is the provider-neutral name; `OPENROUTER_API_KEY` still works
 * so nothing already deployed has to be re-configured on the same commit that
 * introduces the option. A blank value counts as missing — otherwise the only
 * symptom is a 401 from an empty Bearer token, several layers away from the
 * cause.
 *
 * CAVEAT worth knowing before switching providers: the request always asks for
 * strict `json_schema` structured output (see `openrouter-request-builder.ts`).
 * A provider or model that only supports `json_object` JSON mode will reject
 * it. On OpenRouter, 13 of 14 DeepSeek models advertise structured outputs but
 * NONE of the free ones do.
 */
export function resolveAiProviderConfig(env: AiProviderEnv): OpenRouterAdapterConfig {
  const model = readNonBlank(env, "AI_MODEL");
  if (!model) {
    throw new Error(
      "AI_MODEL env var is not set. Set it to a model id your provider serves (see infra/env.example) — the model is never hardcoded because provider model lists rotate.",
    );
  }

  const apiKey = readNonBlank(env, "AI_API_KEY") ?? readNonBlank(env, "OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new Error(
      "No API key set. Set AI_API_KEY (any OpenAI-compatible provider), or OPENROUTER_API_KEY when using OpenRouter (see infra/env.example).",
    );
  }

  return {
    apiKey,
    model,
    visionModel: readNonBlank(env, "AI_VISION_MODEL"),
    baseUrl: readNonBlank(env, "AI_BASE_URL") ?? OPENROUTER_CHAT_COMPLETIONS_URL,
    responseFormat: readResponseFormat(env),
    thinking: readThinking(env),
  };
}

const THINKING_MODES: readonly OpenRouterThinkingMode[] = ["enabled", "disabled"];

/**
 * `AI_THINKING` — provider-side reasoning switch. Unset means the field is
 * never sent (OpenRouter models that do not know it would reject it).
 * DeepSeek V4 thinks by default and can spend the whole `max_tokens` budget
 * on `reasoning_content`, returning an empty answer — set `disabled` there.
 */
function readThinking(env: AiProviderEnv): OpenRouterThinkingMode | undefined {
  const raw = readNonBlank(env, "AI_THINKING");
  if (raw === undefined) return undefined;
  if ((THINKING_MODES as readonly string[]).includes(raw)) return raw as OpenRouterThinkingMode;
  throw new Error(
    `AI_THINKING must be one of ${THINKING_MODES.join(", ")} (got "${raw}"); see infra/env.example.`,
  );
}

const RESPONSE_FORMAT_MODES: readonly OpenRouterResponseFormatMode[] = ["json_schema", "json_object"];

/**
 * `AI_RESPONSE_FORMAT` picks how JSON is requested. Unset means strict
 * `json_schema` so nothing on OpenRouter changes. DeepSeek's own API only
 * accepts `json_object` (verified 2026-09-02 against api-docs.deepseek.com),
 * so a DeepSeek deployment sets it explicitly. An unknown value is refused
 * here rather than forwarded — the provider's 400 would surface as a
 * generic extraction failure several layers away from the typo.
 */
function readResponseFormat(env: AiProviderEnv): OpenRouterResponseFormatMode {
  const raw = readNonBlank(env, "AI_RESPONSE_FORMAT");
  if (raw === undefined) return "json_schema";
  if ((RESPONSE_FORMAT_MODES as readonly string[]).includes(raw)) return raw as OpenRouterResponseFormatMode;
  throw new Error(
    `AI_RESPONSE_FORMAT must be one of ${RESPONSE_FORMAT_MODES.join(", ")} (got "${raw}"). Use json_object for DeepSeek's own API (see infra/env.example).`,
  );
}
