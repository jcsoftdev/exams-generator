import { resolveAiProviderConfig } from "./resolve-ai-provider-config";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

describe("resolveAiProviderConfig", () => {
  it("reads the model and key from env, never hardcoded", () => {
    const config = resolveAiProviderConfig({ AI_MODEL: "deepseek/deepseek-v3.2", AI_API_KEY: "sk-from-env" });

    expect(config.model).toBe("deepseek/deepseek-v3.2");
    expect(config.apiKey).toBe("sk-from-env");
  });

  it("defaults to OpenRouter when no base url is given, so existing deployments are untouched", () => {
    const config = resolveAiProviderConfig({ AI_MODEL: "m", AI_API_KEY: "k" });

    expect(config.baseUrl).toBe(OPENROUTER_URL);
  });

  it("points at another OpenAI-compatible provider when AI_BASE_URL is set", () => {
    const config = resolveAiProviderConfig({
      AI_MODEL: "deepseek-chat",
      AI_API_KEY: "k",
      AI_BASE_URL: "https://api.deepseek.com/chat/completions",
    });

    expect(config.baseUrl).toBe("https://api.deepseek.com/chat/completions");
  });

  it("still accepts OPENROUTER_API_KEY so nothing already deployed has to be re-configured", () => {
    const config = resolveAiProviderConfig({ AI_MODEL: "m", OPENROUTER_API_KEY: "sk-legacy" });

    expect(config.apiKey).toBe("sk-legacy");
  });

  it("prefers AI_API_KEY when both key vars are present", () => {
    const config = resolveAiProviderConfig({
      AI_MODEL: "m",
      AI_API_KEY: "sk-new",
      OPENROUTER_API_KEY: "sk-legacy",
    });

    expect(config.apiKey).toBe("sk-new");
  });

  it("passes the vision model through when set", () => {
    const config = resolveAiProviderConfig({ AI_MODEL: "m", AI_API_KEY: "k", AI_VISION_MODEL: "v" });

    expect(config.visionModel).toBe("v");
  });

  it("leaves the vision model undefined when unset, so the adapter falls back to AI_MODEL", () => {
    const config = resolveAiProviderConfig({ AI_MODEL: "m", AI_API_KEY: "k" });

    expect(config.visionModel).toBeUndefined();
  });

  it("names AI_MODEL in the error when it is missing", () => {
    expect(() => resolveAiProviderConfig({ AI_API_KEY: "k" })).toThrow(/AI_MODEL/);
  });

  it("names both accepted key vars in the error when neither is set", () => {
    expect(() => resolveAiProviderConfig({ AI_MODEL: "m" })).toThrow(/AI_API_KEY.*OPENROUTER_API_KEY/s);
  });

  it("treats a blank key as missing rather than sending an empty Bearer token", () => {
    expect(() => resolveAiProviderConfig({ AI_MODEL: "m", AI_API_KEY: "   " })).toThrow(/AI_API_KEY/);
  });
});
