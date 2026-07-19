import { Difficulty } from "@exams-generator/shared";
import {
  AiInvalidResponseError,
  AiRateLimitError,
  ExtractQuestionInput,
  GenerateQuestionInput,
  ReviseQuestionInput,
} from "../../domain/ports/question-generator.port";
import { HttpClient, OpenRouterAdapter } from "./openrouter.adapter";

const INPUT: GenerateQuestionInput = {
  course: "Aritmética",
  topic: "fracciones",
  difficulty: Difficulty.Medium,
  gradeLevel: "secundaria_3",
  withFigure: false,
};

const REVISE_INPUT: ReviseQuestionInput = {
  current: {
    bodyTypst: "¿Cuánto es $1/2 + 1/4$?",
    alternatives: ["1/4", "3/4", "1/2", "1", "2"],
    correctAnswer: "b",
  },
  instruction: "hazla más difícil",
  difficulty: Difficulty.Hard,
};

const EXTRACT_INPUT: ExtractQuestionInput = {
  image: Buffer.from("fake-image-bytes"),
  mimeType: "image/png",
};

const VALID_QUESTION_JSON = {
  bodyTypst: "¿Cuánto es $1/2 + 1/4$?",
  alternatives: ["1/4", "3/4", "1/2", "1", "2"],
  correctAnswer: "b",
  figureCode: null,
};

function jsonResponse(status: number, body: unknown): ReturnType<HttpClient> {
  return Promise.resolve({ status, json: async () => body });
}

function chatCompletion(message: Record<string, unknown>) {
  return { choices: [{ message }] };
}

describe("OpenRouterAdapter", () => {
  it("sends the configured model, Authorization header, and the OpenRouter chat-completions URL", async () => {
    const httpClient = jest
      .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
      .mockReturnValueOnce(
        jsonResponse(200, chatCompletion({ content: JSON.stringify(VALID_QUESTION_JSON) })),
      );
    const adapter = new OpenRouterAdapter({
      apiKey: "sk-test-key",
      model: "deepseek/deepseek-r1:free",
      httpClient,
    });

    await adapter.generate(INPUT);

    expect(httpClient).toHaveBeenCalledTimes(1);
    const [url, init] = httpClient.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer sk-test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("deepseek/deepseek-r1:free");
  });

  it("returns the validated question on a clean response with no reasoning", async () => {
    const httpClient = jest
      .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
      .mockReturnValueOnce(
        jsonResponse(200, chatCompletion({ content: JSON.stringify(VALID_QUESTION_JSON) })),
      );
    const adapter = new OpenRouterAdapter({
      apiKey: "sk-test-key",
      model: "deepseek/deepseek-r1:free",
      httpClient,
    });

    const result = await adapter.generate(INPUT);

    expect(result).toEqual({
      bodyTypst: VALID_QUESTION_JSON.bodyTypst,
      alternatives: VALID_QUESTION_JSON.alternatives,
      correctAnswer: "b",
      figureCode: undefined,
    });
  });

  it("ignores a separate `reasoning` field and parses `content` only", async () => {
    const httpClient = jest
      .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
      .mockReturnValueOnce(
        jsonResponse(
          200,
          chatCompletion({
            reasoning: "Let me think about fractions step by step... {\"decoy\": true}",
            content: JSON.stringify(VALID_QUESTION_JSON),
          }),
        ),
      );
    const adapter = new OpenRouterAdapter({
      apiKey: "sk-test-key",
      model: "deepseek/deepseek-r1:free",
      httpClient,
    });

    const result = await adapter.generate(INPUT);

    expect(result.bodyTypst).toBe(VALID_QUESTION_JSON.bodyTypst);
  });

  it("retries once when the first response's content fails validation, and succeeds on retry", async () => {
    const httpClient = jest
      .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
      .mockReturnValueOnce(
        jsonResponse(
          200,
          chatCompletion({ content: JSON.stringify({ ...VALID_QUESTION_JSON, alternatives: ["only-one"] }) }),
        ),
      )
      .mockReturnValueOnce(
        jsonResponse(200, chatCompletion({ content: JSON.stringify(VALID_QUESTION_JSON) })),
      );
    const adapter = new OpenRouterAdapter({
      apiKey: "sk-test-key",
      model: "deepseek/deepseek-r1:free",
      httpClient,
    });

    const result = await adapter.generate(INPUT);

    expect(httpClient).toHaveBeenCalledTimes(2);
    expect(result.bodyTypst).toBe(VALID_QUESTION_JSON.bodyTypst);
    const secondCallBody = JSON.parse(httpClient.mock.calls[1][1].body);
    const secondPrompt = secondCallBody.messages.map((m: { content: string }) => m.content).join("\n");
    expect(secondPrompt).toContain("alternatives");
  });

  it("throws AiInvalidResponseError when both attempts fail validation", async () => {
    const httpClient = jest
      .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
      .mockReturnValue(jsonResponse(200, chatCompletion({ content: "not json at all" })));
    const adapter = new OpenRouterAdapter({
      apiKey: "sk-test-key",
      model: "deepseek/deepseek-r1:free",
      httpClient,
    });

    await expect(adapter.generate(INPUT)).rejects.toBeInstanceOf(AiInvalidResponseError);
    expect(httpClient).toHaveBeenCalledTimes(2);
  });

  it("throws AiRateLimitError immediately on 429 without retrying", async () => {
    const httpClient = jest
      .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
      .mockReturnValueOnce(jsonResponse(429, { error: "rate limited" }));
    const adapter = new OpenRouterAdapter({
      apiKey: "sk-test-key",
      model: "deepseek/deepseek-r1:free",
      httpClient,
    });

    await expect(adapter.generate(INPUT)).rejects.toBeInstanceOf(AiRateLimitError);
    expect(httpClient).toHaveBeenCalledTimes(1);
  });

  describe("reviseQuestion", () => {
    it("returns the validated question, with correctAnswer as a LETTER (never converted to an index)", async () => {
      const httpClient = jest
        .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
        .mockReturnValueOnce(
          jsonResponse(200, chatCompletion({ content: JSON.stringify(VALID_QUESTION_JSON) })),
        );
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        httpClient,
      });

      const result = await adapter.reviseQuestion(REVISE_INPUT);

      expect(result).toEqual({
        bodyTypst: VALID_QUESTION_JSON.bodyTypst,
        alternatives: VALID_QUESTION_JSON.alternatives,
        correctAnswer: "b",
        figureCode: undefined,
      });
      const [, init] = httpClient.mock.calls[0];
      const body = JSON.parse(init.body);
      const promptText = body.messages.map((m: { content: string }) => m.content).join("\n");
      expect(promptText).toContain(REVISE_INPUT.instruction);
      expect(promptText).toContain(REVISE_INPUT.current.bodyTypst);
    });

    it("retries once when the first response's content fails validation, and succeeds on retry", async () => {
      const httpClient = jest
        .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
        .mockReturnValueOnce(
          jsonResponse(
            200,
            chatCompletion({ content: JSON.stringify({ ...VALID_QUESTION_JSON, alternatives: ["only-one"] }) }),
          ),
        )
        .mockReturnValueOnce(
          jsonResponse(200, chatCompletion({ content: JSON.stringify(VALID_QUESTION_JSON) })),
        );
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        httpClient,
      });

      const result = await adapter.reviseQuestion(REVISE_INPUT);

      expect(httpClient).toHaveBeenCalledTimes(2);
      expect(result.bodyTypst).toBe(VALID_QUESTION_JSON.bodyTypst);
    });

    it("throws AiInvalidResponseError when both attempts fail validation", async () => {
      const httpClient = jest
        .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
        .mockReturnValue(jsonResponse(200, chatCompletion({ content: "not json at all" })));
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        httpClient,
      });

      await expect(adapter.reviseQuestion(REVISE_INPUT)).rejects.toBeInstanceOf(AiInvalidResponseError);
      expect(httpClient).toHaveBeenCalledTimes(2);
    });

    it("throws AiRateLimitError immediately on 429 without retrying", async () => {
      const httpClient = jest
        .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
        .mockReturnValueOnce(jsonResponse(429, { error: "rate limited" }));
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        httpClient,
      });

      await expect(adapter.reviseQuestion(REVISE_INPUT)).rejects.toBeInstanceOf(AiRateLimitError);
      expect(httpClient).toHaveBeenCalledTimes(1);
    });
  });

  describe("extractFromImage", () => {
    it("routes to the configured visionModel, while text ops stay on `model`", async () => {
      const httpClient = jest
        .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
        .mockReturnValue(jsonResponse(200, chatCompletion({ content: JSON.stringify(VALID_QUESTION_JSON) })));
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "text/academic-model:free",
        visionModel: "vision/model:free",
        httpClient,
      });

      await adapter.extractFromImage(EXTRACT_INPUT);
      expect(JSON.parse(httpClient.mock.calls[0][1].body).model).toBe("vision/model:free");

      await adapter.generate(INPUT);
      expect(JSON.parse(httpClient.mock.calls[1][1].body).model).toBe("text/academic-model:free");
    });

    it("falls back to `model` for extractFromImage when no visionModel is configured", async () => {
      const httpClient = jest
        .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
        .mockReturnValueOnce(
          jsonResponse(200, chatCompletion({ content: JSON.stringify(VALID_QUESTION_JSON) })),
        );
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "solo/model:free",
        httpClient,
      });

      await adapter.extractFromImage(EXTRACT_INPUT);
      expect(JSON.parse(httpClient.mock.calls[0][1].body).model).toBe("solo/model:free");
    });

    it("returns the validated question and sends a multimodal message with an image_url data URI", async () => {
      const httpClient = jest
        .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
        .mockReturnValueOnce(
          jsonResponse(200, chatCompletion({ content: JSON.stringify(VALID_QUESTION_JSON) })),
        );
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        httpClient,
      });

      const result = await adapter.extractFromImage(EXTRACT_INPUT);

      expect(result).toEqual({
        bodyTypst: VALID_QUESTION_JSON.bodyTypst,
        alternatives: VALID_QUESTION_JSON.alternatives,
        correctAnswer: "b",
        figureCode: undefined,
      });
      const [, init] = httpClient.mock.calls[0];
      const body = JSON.parse(init.body);
      const userMessage = body.messages.find((m: { role: string }) => m.role === "user");
      const imagePart = userMessage.content.find((p: { type: string }) => p.type === "image_url");
      expect(imagePart.image_url.url).toBe(
        `data:image/png;base64,${EXTRACT_INPUT.image.toString("base64")}`,
      );
    });

    it("throws AiInvalidResponseError when both attempts fail validation", async () => {
      const httpClient = jest
        .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
        .mockReturnValue(jsonResponse(200, chatCompletion({ content: "not json at all" })));
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        httpClient,
      });

      await expect(adapter.extractFromImage(EXTRACT_INPUT)).rejects.toBeInstanceOf(
        AiInvalidResponseError,
      );
      expect(httpClient).toHaveBeenCalledTimes(2);
    });

    it("throws AiRateLimitError immediately on 429 without retrying", async () => {
      const httpClient = jest
        .fn<ReturnType<HttpClient>, Parameters<HttpClient>>()
        .mockReturnValueOnce(jsonResponse(429, { error: "rate limited" }));
      const adapter = new OpenRouterAdapter({
        apiKey: "sk-test-key",
        model: "deepseek/deepseek-r1:free",
        httpClient,
      });

      await expect(adapter.extractFromImage(EXTRACT_INPUT)).rejects.toBeInstanceOf(AiRateLimitError);
      expect(httpClient).toHaveBeenCalledTimes(1);
    });
  });
});
