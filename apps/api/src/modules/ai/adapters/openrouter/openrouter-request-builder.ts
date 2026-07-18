import { GenerateQuestionInput } from "../../domain/ports/question-generator.port";

export interface OpenRouterMessage {
  readonly role: "system" | "user";
  readonly content: string;
}

export interface OpenRouterJsonSchema {
  readonly name: string;
  readonly strict: boolean;
  readonly schema: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: Record<string, unknown>;
    readonly required: readonly string[];
  };
}

export interface OpenRouterRequestBody {
  readonly model: string;
  readonly messages: readonly OpenRouterMessage[];
  readonly response_format: {
    readonly type: "json_schema";
    readonly json_schema: OpenRouterJsonSchema;
  };
}

export interface BuildOpenRouterRequestOptions {
  /**
   * Set on the single retry attempt: fed back into the prompt so the model
   * sees exactly why its previous output was rejected.
   */
  readonly previousError?: string;
}

const RESPONSE_JSON_SCHEMA: OpenRouterJsonSchema = {
  name: "generated_question",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      bodyTypst: {
        type: "string",
        description:
          "Enunciado de la pregunta en marcado Typst. Usa $...$ para matemáticas inline y $ ... $ en bloque cuando corresponda.",
      },
      alternatives: {
        type: "array",
        items: { type: "string" },
        minItems: 5,
        maxItems: 5,
        description: "Exactamente 5 alternativas de respuesta, en el mismo orden que se presentarán.",
      },
      correctAnswer: {
        type: "string",
        enum: ["a", "b", "c", "d", "e"],
        description: "Letra de la alternativa correcta.",
      },
      figureCode: {
        type: ["string", "null"],
        description:
          "Código CeTZ (Typst) de una figura opcional que acompaña la pregunta, o null si no aplica.",
      },
    },
    required: ["bodyTypst", "alternatives", "correctAnswer", "figureCode"],
  },
};

const SYSTEM_PROMPT = [
  "Eres un generador de preguntas tipo examen de admisión para colegios/academias peruanas.",
  "Responde EXCLUSIVAMENTE con el objeto JSON solicitado por el schema, sin explicaciones ni texto adicional.",
  "El enunciado (bodyTypst) debe estar en español y usar marcado Typst para cualquier expresión matemática.",
].join(" ");

/**
 * Builds the OpenRouter chat-completions request body for one
 * `generate()` call. `model` is ALWAYS passed in by the caller (which reads
 * it from `process.env.AI_MODEL`) — this function never hardcodes a model
 * name, per design doc §4/§6 (the OpenRouter free-tier model list rotates).
 */
export function buildOpenRouterRequestBody(
  model: string,
  input: GenerateQuestionInput,
  options: BuildOpenRouterRequestOptions = {},
): OpenRouterRequestBody {
  const userPromptLines = [
    `Curso: ${input.course}`,
    `Tema: ${input.topic}`,
    `Dificultad: ${input.difficulty}`,
    `Nivel: ${input.gradeLevel}`,
    `¿Incluir figura CeTZ?: ${input.withFigure ? "sí" : "no"}`,
    "Genera UNA pregunta de opción múltiple con 5 alternativas y la letra de la correcta.",
  ];

  if (options.previousError) {
    userPromptLines.push(
      "",
      "Tu respuesta anterior fue inválida por lo siguiente — corrígelo en esta nueva respuesta:",
      options.previousError,
    );
  }

  return {
    model,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPromptLines.join("\n") },
    ],
    response_format: {
      type: "json_schema",
      json_schema: RESPONSE_JSON_SCHEMA,
    },
  };
}
