import { OpenRouterAdapter } from "./adapters/openrouter/openrouter.adapter";
import { resolveQuestionGeneratorAdapter } from "./ai-provider";

describe("resolveQuestionGeneratorAdapter", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("builds an OpenRouterAdapter reading model and api key from env vars, never hardcoded", () => {
    process.env.AI_MODEL = "deepseek/deepseek-r1:free";
    process.env.OPENROUTER_API_KEY = "sk-from-env";

    const adapter = resolveQuestionGeneratorAdapter();

    expect(adapter).toBeInstanceOf(OpenRouterAdapter);
  });

  it("throws a clear error when AI_MODEL is not set", () => {
    delete process.env.AI_MODEL;
    process.env.OPENROUTER_API_KEY = "sk-from-env";

    expect(() => resolveQuestionGeneratorAdapter()).toThrow(/AI_MODEL/);
  });

  it("throws a clear error when OPENROUTER_API_KEY is not set", () => {
    process.env.AI_MODEL = "deepseek/deepseek-r1:free";
    delete process.env.OPENROUTER_API_KEY;

    expect(() => resolveQuestionGeneratorAdapter()).toThrow(/OPENROUTER_API_KEY/);
  });
});
