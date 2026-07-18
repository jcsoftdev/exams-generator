import { Difficulty } from "@exams-generator/shared";
import { GenerateQuestionInput } from "../../domain/ports/question-generator.port";
import { buildOpenRouterRequestBody } from "./openrouter-request-builder";

const INPUT: GenerateQuestionInput = {
  course: "Aritmética",
  topic: "fracciones",
  difficulty: Difficulty.Medium,
  gradeLevel: "secundaria_3",
  withFigure: true,
};

describe("buildOpenRouterRequestBody", () => {
  it("reads the model from the given model argument, never hardcoded", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    expect(body.model).toBe("some/free-model:free");
  });

  it("requests structured JSON output via json_schema with the expected question shape", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    expect(body.response_format.type).toBe("json_schema");
    const schema = body.response_format.json_schema.schema as unknown as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(
      expect.arrayContaining(["bodyTypst", "alternatives", "correctAnswer", "figureCode"]),
    );
    expect(schema.required).toEqual(
      expect.arrayContaining(["bodyTypst", "alternatives", "correctAnswer"]),
    );
  });

  it("includes course/topic/difficulty/gradeLevel/withFigure in the prompt content", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = body.messages.map((m) => m.content).join("\n");
    expect(promptText).toContain("Aritmética");
    expect(promptText).toContain("fracciones");
    expect(promptText).toContain(Difficulty.Medium);
    expect(promptText).toContain("secundaria_3");
  });

  it("appends the previous validation error to the prompt when retrying", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT, {
      previousError: "alternatives must be an array of exactly 5 non-empty strings",
    });

    const promptText = body.messages.map((m) => m.content).join("\n");
    expect(promptText).toContain("alternatives must be an array of exactly 5 non-empty strings");
  });

  it("does not append retry guidance when there is no previous error", () => {
    const withoutRetry = buildOpenRouterRequestBody("some/free-model:free", INPUT);
    const withRetry = buildOpenRouterRequestBody("some/free-model:free", INPUT, {
      previousError: "boom",
    });

    expect(JSON.stringify(withoutRetry)).not.toContain("boom");
    expect(JSON.stringify(withRetry)).toContain("boom");
  });
});
