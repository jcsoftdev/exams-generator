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
  MAX_COMPLETION_TOKENS,
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
    expect(schema.required).toEqual(expect.arrayContaining(["bodyTypst", "alternatives", "correctAnswer"]));
  });

  it("requires the model to self-report conceptsUsed and solutionSteps in the schema", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const schema = body.response_format.json_schema.schema as unknown as {
      properties: Record<string, unknown>;
      required: string[];
    };
    expect(Object.keys(schema.properties)).toEqual(expect.arrayContaining(["conceptsUsed", "solutionSteps"]));
    expect(schema.required).toEqual(expect.arrayContaining(["conceptsUsed", "solutionSteps"]));
  });

  it("warns the model that its self-reported structure is validated against the requested difficulty", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("conceptsUsed");
    expect(promptText).toContain("solutionSteps");
    expect(promptText).toMatch(/conceptsUsed.*solutionSteps.*VALIDA|VALIDA.*conceptsUsed/s);
  });

  it("includes course/topic/difficulty/gradeLevel/withFigure in the prompt content", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("Aritmética");
    expect(promptText).toContain("fracciones");
    expect(promptText).toContain(Difficulty.Medium);
    expect(promptText).toContain("secundaria_3");
  });

  it("instructs the model to keep multi-letter labels (AB, BC, AC) OUTSIDE math mode, as plain text", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("El segmento AB mide $8$");
  });

  it("does not recommend quoting labels inside math mode — nested quotes inside a JSON string are fragile for weaker models", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).not.toContain('overline("AB")');
  });

  it("appends the previous validation error to the prompt when retrying", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT, {
      previousError: "alternatives must be an array of exactly 5 non-empty strings",
    });

    const promptText = promptTextOf(body);
    expect(promptText).toContain("alternatives must be an array of exactly 5 non-empty strings");
  });

  it("calibrates each difficulty label to a concrete rigor criterion, not just the bare word", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("análisis SIMPLE");
    expect(promptText).toContain("análisis MODERADO");
    expect(promptText).toContain("análisis PROFUNDO");
  });

  it("frames the three difficulty levels as a progression of analysis depth, not mechanical-vs-analytical", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("PROGRESIÓN de análisis");
    // "easy" must still require reading/interpretation — never framed as pure memorization.
    expect(promptText).not.toContain("sin analizar nada");
    expect(promptText).toContain("interpretar el enunciado");
    expect(promptText).toContain("evaluar varios casos o condiciones");
  });

  it("pins the CeTZ package version compatible with the deployed typst binary (infra/Dockerfile.api TYPST_VERSION)", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("@preview/cetz:0.5.2");
  });

  it("spells out that a negated symbol takes the .not suffix — `notsubset` is not a Typst variable", () => {
    const promptText = promptTextOf(buildOpenRouterReviseRequestBody("some/free-model:free", REVISE_INPUT));

    expect(promptText).toContain("subset.not");
    expect(promptText).toContain("notsubset");
  });

  it("tells the model it may use LaTeX math via mitex, wrapped explicitly", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("@preview/mitex:0.2.7");
    expect(promptText).toContain("#mi(");
    expect(promptText).toContain("#mitex(");
  });

  it("instructs the model to connect a named polygon's vertices in perimeter order with ONE line()+close:true call, not separate calls that can mix up diagonals with sides", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("UNA sola llamada a line()");
    expect(promptText).toContain("orden del perímetro");
    expect(promptText).toContain("NUNCA conectes diagonales");
  });

  it("instructs the model not to write the answer letter inside the alternative text", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("NUNCA escribas la letra dentro del texto");
  });

  it("explicitly forbids wrapping an alternative in a {texto, letra} JSON object", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("NUNCA envuelvas el valor en un objeto");
    expect(promptText).toContain('"texto": "5/2√7", "letra": "A"');
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

  it("also calibrates difficulty labels to a concrete rigor criterion", () => {
    const body = buildOpenRouterReviseRequestBody("some/free-model:free", REVISE_INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("análisis SIMPLE");
  });

  it("pins the CeTZ package version compatible with the deployed typst binary", () => {
    const body = buildOpenRouterReviseRequestBody("some/free-model:free", REVISE_INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("@preview/cetz:0.5.2");
  });

  it("tells the model it may use LaTeX math via mitex, wrapped explicitly", () => {
    const body = buildOpenRouterReviseRequestBody("some/free-model:free", REVISE_INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("@preview/mitex:0.2.7");
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

  it("requests the SAME base question shape as buildOpenRouterRequestBody, PLUS nullable suggestedCourse/suggestedTopic", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT);
    const generateSchema = expectedGeneratedQuestionSchema() as unknown as {
      properties: Record<string, unknown>;
      required: readonly string[];
    };

    expect(body.response_format.type).toBe("json_schema");
    const schema = body.response_format.json_schema.schema as unknown as {
      properties: Record<string, unknown>;
      required: readonly string[];
    };
    // `alternatives`/`correctAnswer` are DELIBERATELY excluded from this
    // comparison — extraction relaxes exactly those two (see the dedicated
    // "A1" describe block below); every other property must match generate's
    // base schema exactly.
    const {
      alternatives: _genAlternatives,
      correctAnswer: _genCorrectAnswer,
      ...restOfGenerateProps
    } = generateSchema.properties;
    expect(schema.properties).toMatchObject(restOfGenerateProps);
    expect(schema.properties.suggestedCourse).toEqual({
      type: ["string", "null"],
      description: expect.any(String),
    });
    expect(schema.properties.suggestedTopic).toEqual({
      type: ["string", "null"],
      description: expect.any(String),
    });
    expect(schema.required).toEqual(
      expect.arrayContaining([...generateSchema.required, "suggestedCourse", "suggestedTopic"]),
    );
  });

  describe("A1: extraction must not invent alternatives or a key the photo doesn't show", () => {
    it("allows alternatives to be empty (minItems: 0) — generate/revise still require exactly 5", () => {
      const extractSchema = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT)
        .response_format.json_schema.schema as unknown as { properties: Record<string, unknown> };
      const generateSchema = expectedGeneratedQuestionSchema() as unknown as {
        properties: Record<string, unknown>;
      };

      expect(extractSchema.properties.alternatives).toMatchObject({ minItems: 0, maxItems: 5 });
      expect(extractSchema.properties.alternatives).not.toMatchObject({ minItems: 5 });
      // Regression guard: generate/revise's OWN schema must stay untouched.
      expect(generateSchema.properties.alternatives).toMatchObject({ minItems: 5, maxItems: 5 });
    });

    it("allows correctAnswer to be null — generate/revise still require a letter", () => {
      const extractSchema = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT)
        .response_format.json_schema.schema as unknown as { properties: Record<string, unknown> };
      const generateSchema = expectedGeneratedQuestionSchema() as unknown as {
        properties: Record<string, unknown>;
      };

      expect(extractSchema.properties.correctAnswer).toEqual({
        type: ["string", "null"],
        enum: ["a", "b", "c", "d", "e", null],
        description: expect.any(String),
      });
      // Regression guard: generate/revise's OWN schema must stay untouched.
      expect(generateSchema.properties.correctAnswer).toEqual({
        type: "string",
        enum: ["a", "b", "c", "d", "e"],
        description: expect.any(String),
      });
    });

    it("tells the model, in the prompt, to leave alternatives empty / correctAnswer null rather than invent either", () => {
      const promptText = promptTextOf(
        buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT),
      );

      expect(promptText).toMatch(/NUNCA INVENTES/);
      expect(promptText).toMatch(/array VACÍO/);
      expect(promptText).toMatch(/correctAnswer null/);
    });
  });

  it("tells the model to drop the numbering the source printed on the question", () => {
    const promptText = promptTextOf(buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT));

    expect(promptText).toMatch(/numeraci[oó]n/i);
  });

  it("tells the model to drop the letters the source printed on the alternatives", () => {
    const promptText = promptTextOf(buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT));

    expect(promptText).toMatch(/letra/i);
  });

  it("tells the model to transcribe the statement rather than describe the image", () => {
    const promptText = promptTextOf(buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT));

    expect(promptText).toMatch(/transcribe/i);
  });

  it("tells the model figureCode is ALWAYS null, because a photographed figure is cropped out as an image", () => {
    const promptText = promptTextOf(buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT));

    expect(promptText).toMatch(/figureCode SIEMPRE null/i);
    expect(promptText).toMatch(/se recortan como imagen/i);
  });

  it("MUST: tells the model to transcribe and never solve — a V/F annotation would print the answer on the exam", () => {
    const promptText = promptTextOf(buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT));

    expect(promptText).toMatch(/NO RESUELVES/);
    // The rule leads the prompt: buried among the numbering rules it did not
    // take, and the model kept annotating each proposition with -> V / -> F.
    expect(promptText.indexOf("NO RESUELVES")).toBeLessThan(200);
    expect(promptText).toMatch(/correctAnswer/);
  });

  it("tells the model to guess course/topic ONLY when confident, null otherwise", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("null");
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
    expect(imagePart!.image_url!.url).toBe(`data:${MIME_TYPE};base64,${IMAGE.toString("base64")}`);

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

  it("carries NO CeTZ drawing rules — extraction never draws a figure, it crops one", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT);

    // A third of the prompt used to teach CeTZ here, for an output this path
    // is now told to leave null. `generate` still carries them (asserted in
    // its own test above); re-adding them here is the regression to catch.
    const systemMessage = body.messages.find((m) => m.role === "system");
    expect(systemMessage!.content as string).not.toContain("@preview/cetz");
    expect(systemMessage!.content as string).not.toContain("#canvas(");
  });

  it("tells the model it may use LaTeX math via mitex, wrapped explicitly", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT);

    const systemMessage = body.messages.find((m) => m.role === "system");
    expect(systemMessage!.content as string).toContain("@preview/mitex:0.2.7");
  });

  it("no longer asks the model for crop boxes — the figure is found by OCR, not reported", () => {
    const promptText = promptTextOf(buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT));

    // Asking a vision model for pixel coordinates is what this design replaced.
    // Re-adding these rules is the regression to catch.
    expect(promptText).not.toMatch(/figureBox/);
    expect(promptText).not.toMatch(/alternativeBoxes/);
    expect(promptText).not.toMatch(/recuadro/i);
  });

  it("the extract schema no longer declares the box fields", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT);

    const schema = body.response_format!.json_schema!.schema;
    expect(schema.properties).not.toHaveProperty("figureBox");
    expect(schema.properties).not.toHaveProperty("alternativeBoxes");
    expect(schema.required).not.toContain("figureBox");
  });
});

describe("spend ceiling", () => {
  it("caps the completion of every request kind", () => {
    // Audit 2026-08-20 H6: without max_tokens the bill is whatever the model
    // decides to write. Free-tier today, but AI_BASE_URL already supports paid
    // providers.
    expect(buildOpenRouterRequestBody("m", INPUT).max_tokens).toBe(MAX_COMPLETION_TOKENS);
    expect(buildOpenRouterReviseRequestBody("m", REVISE_INPUT).max_tokens).toBe(MAX_COMPLETION_TOKENS);
    expect(
      buildOpenRouterExtractRequestBody("m", {
        image: Buffer.from("fake-png-bytes"),
        mimeType: "image/png",
      }).max_tokens,
    ).toBe(MAX_COMPLETION_TOKENS);
  });

  it("leaves room for a question with a CeTZ figure, so the cap never truncates a good answer", () => {
    // A ceiling that clips valid JSON would trade a cost bug for a correctness one.
    expect(MAX_COMPLETION_TOKENS).toBeGreaterThanOrEqual(2000);
  });
});

describe("responseFormat: json_object — providers without json_schema (DeepSeek's own API)", () => {
  it("sends a bare json_object response_format with no schema object", () => {
    const body = buildOpenRouterRequestBody("deepseek-v4-flash", INPUT, { responseFormat: "json_object" });

    expect(body.response_format).toEqual({ type: "json_object" });
  });

  it("embeds the schema in the prompt, since the provider never sees it server-side", () => {
    const body = buildOpenRouterRequestBody("deepseek-v4-flash", INPUT, { responseFormat: "json_object" });
    const promptText = promptTextOf(body);

    expect(promptText).toContain('"bodyTypst"');
    expect(promptText).toContain('"correctAnswer"');
    expect(promptText).toContain('"solutionSteps"');
    expect(promptText).toMatch(/JSON/);
  });

  it("applies the same mode to revise, and to extract with its own extra fields", () => {
    const revise = buildOpenRouterReviseRequestBody("deepseek-v4-flash", REVISE_INPUT, {
      responseFormat: "json_object",
    });
    const extractInput: ExtractQuestionInput = {
      image: Buffer.from("fake-png-bytes"),
      mimeType: "image/png",
    };
    const extract = buildOpenRouterExtractRequestBody("deepseek-v4-flash-vision-exp", extractInput, {
      responseFormat: "json_object",
    });

    expect(revise.response_format).toEqual({ type: "json_object" });
    expect(extract.response_format).toEqual({ type: "json_object" });
    expect(promptTextOf(revise)).toContain('"bodyTypst"');
    expect(promptTextOf(extract)).toContain("suggestedCourse");
  });

  it("keeps strict json_schema by default so OpenRouter callers are untouched", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    expect(body.response_format.type).toBe("json_schema");
    expect(promptTextOf(body)).not.toContain('"additionalProperties"');
  });
});

describe("thinking: provider-side reasoning switch (DeepSeek V4 thinks by default)", () => {
  it("sends thinking.type when the option is set, on all three request kinds", () => {
    const extractInput: ExtractQuestionInput = {
      image: Buffer.from("fake-png-bytes"),
      mimeType: "image/png",
    };

    expect(buildOpenRouterRequestBody("deepseek-v4-flash", INPUT, { thinking: "disabled" }).thinking).toEqual(
      {
        type: "disabled",
      },
    );
    expect(
      buildOpenRouterReviseRequestBody("deepseek-v4-flash", REVISE_INPUT, { thinking: "enabled" }).thinking,
    ).toEqual({ type: "enabled" });
    expect(
      buildOpenRouterExtractRequestBody("deepseek-v4-flash-vision-exp", extractInput, {
        thinking: "disabled",
      }).thinking,
    ).toEqual({ type: "disabled" });
  });

  it("omits the field entirely when unset, so OpenRouter models that do not know it never see it", () => {
    expect("thinking" in buildOpenRouterRequestBody("some/free-model:free", INPUT)).toBe(false);
  });
});
