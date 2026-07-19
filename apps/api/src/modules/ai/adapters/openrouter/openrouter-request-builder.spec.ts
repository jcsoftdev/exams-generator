import { Difficulty } from "@exams-generator/shared";
import {
  ExtractQuestionInput,
  GenerateQuestionInput,
  ReviseQuestionInput,
} from "../../domain/ports/question-generator.port";
import {
  buildOpenRouterExtractRequestBody,
  buildOpenRouterReviseRequestBody,
  buildOpenRouterRequestBody,
  OpenRouterRequestBody,
} from "./openrouter-request-builder";

const INPUT: GenerateQuestionInput = {
  course: "Aritmética",
  topic: "fracciones",
  difficulty: Difficulty.Medium,
  gradeLevel: "secundaria_3",
  withFigure: true,
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

function expectedGeneratedQuestionSchema() {
  const generateBody = buildOpenRouterRequestBody("some/free-model:free", INPUT);
  return generateBody.response_format.json_schema.schema;
}

/** All `messages[].content` joined into one string — text-only for these builders. */
function promptTextOf(body: OpenRouterRequestBody): string {
  return body.messages
    .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
    .join("\n");
}

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

    const promptText = promptTextOf(body);
    expect(promptText).toContain("Aritmética");
    expect(promptText).toContain("fracciones");
    expect(promptText).toContain(Difficulty.Medium);
    expect(promptText).toContain("secundaria_3");
  });

  it("appends the previous validation error to the prompt when retrying", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT, {
      previousError: "alternatives must be an array of exactly 5 non-empty strings",
    });

    const promptText = promptTextOf(body);
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

describe("buildOpenRouterReviseRequestBody", () => {
  it("reads the model from the given model argument, never hardcoded", () => {
    const body = buildOpenRouterReviseRequestBody("some/free-model:free", REVISE_INPUT);

    expect(body.model).toBe("some/free-model:free");
  });

  it("requests the SAME JSON schema buildOpenRouterRequestBody asks for", () => {
    const body = buildOpenRouterReviseRequestBody("some/free-model:free", REVISE_INPUT);

    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.schema).toEqual(expectedGeneratedQuestionSchema());
  });

  it("includes the instruction AND the current statement (body + alternatives + correctAnswer letter) in the prompt", () => {
    const body = buildOpenRouterReviseRequestBody("some/free-model:free", REVISE_INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain(REVISE_INPUT.instruction);
    expect(promptText).toContain(REVISE_INPUT.current.bodyTypst);
    for (const alt of REVISE_INPUT.current.alternatives) {
      expect(promptText).toContain(alt);
    }
    expect(promptText).toContain(REVISE_INPUT.current.correctAnswer);
    expect(promptText).toContain(Difficulty.Hard);
  });

  it("appends the previous validation error to the prompt when retrying", () => {
    const body = buildOpenRouterReviseRequestBody("some/free-model:free", REVISE_INPUT, {
      previousError: "boom",
    });

    const promptText = promptTextOf(body);
    expect(promptText).toContain("boom");
  });
});

describe("buildOpenRouterExtractRequestBody", () => {
  const IMAGE = Buffer.from("fake-image-bytes");
  const MIME_TYPE = "image/png";
  const EXTRACT_INPUT: ExtractQuestionInput = { image: IMAGE, mimeType: MIME_TYPE };

  it("reads the model from the given model argument, never hardcoded", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT);

    expect(body.model).toBe("some/free-model:free");
  });

  it("requests the SAME JSON schema buildOpenRouterRequestBody asks for", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT);

    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.schema).toEqual(expectedGeneratedQuestionSchema());
  });

  it("produces a multimodal user message with an image_url data-URI part built from the base64-encoded image + mimeType", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT);

    const userMessage = body.messages.find((m) => m.role === "user");
    expect(userMessage).toBeDefined();
    expect(Array.isArray(userMessage!.content)).toBe(true);
    const parts = userMessage!.content as ReadonlyArray<{
      type: string;
      image_url?: { url: string };
      text?: string;
    }>;

    const imagePart = parts.find((p) => p.type === "image_url");
    expect(imagePart).toBeDefined();
    expect(imagePart!.image_url!.url).toBe(
      `data:${MIME_TYPE};base64,${IMAGE.toString("base64")}`,
    );

    const textPart = parts.find((p) => p.type === "text");
    expect(textPart).toBeDefined();
  });

  it("appends the previous validation error to the prompt when retrying", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT, {
      previousError: "boom",
    });

    const userMessage = body.messages.find((m) => m.role === "user");
    const parts = userMessage!.content as ReadonlyArray<{ type: string; text?: string }>;
    const textPart = parts.find((p) => p.type === "text");
    expect(textPart!.text).toContain("boom");
  });
});
