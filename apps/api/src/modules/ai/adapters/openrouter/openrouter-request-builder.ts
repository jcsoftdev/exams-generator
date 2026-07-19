import {
  ExtractQuestionInput,
  GenerateQuestionInput,
  ReviseQuestionInput,
} from "../../domain/ports/question-generator.port";

export interface OpenRouterTextContentPart {
  readonly type: "text";
  readonly text: string;
}

export interface OpenRouterImageContentPart {
  readonly type: "image_url";
  readonly image_url: { readonly url: string };
}

export type OpenRouterContentPart = OpenRouterTextContentPart | OpenRouterImageContentPart;

export interface OpenRouterMessage {
  readonly role: "system" | "user";
  readonly content: string | readonly OpenRouterContentPart[];
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
          "Enunciado en marcado Typst (NO LaTeX). Matemáticas dentro de $...$ con sintaxis Typst: $frac(a, b)$, $sqrt(x)$, $x^2$, $a times b$. Prohibido \\frac, \\sqrt, \\times y cualquier comando con barra invertida.",
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

/**
 * Shared math-formatting contract for every system prompt. The generated
 * `bodyTypst` is compiled by the real `typst` binary downstream; models default
 * to LaTeX inside `$...$` (\frac, \sqrt, \times), which Typst CANNOT compile and
 * fails the whole question. Typst's math syntax is different, so we spell it out
 * with examples — this is the single biggest cause of "Typst compile failed".
 */
const TYPST_MATH_RULES = [
  "El enunciado (bodyTypst) va en español.",
  "Para matemáticas usa SINTAXIS TYPST, NUNCA LaTeX, dentro de $...$:",
  "fracciones $frac(a, b)$ (no \\frac); raíz $sqrt(x)$ (no \\sqrt); potencia $x^2$; subíndice $x_1$;",
  "multiplicación $a dot b$ o $a times b$ (no \\cdot ni \\times);",
  "símbolos como palabras: $pi$, $alpha$, $<=$, $>=$, $!=$, $infinity$.",
  "PROHIBIDO cualquier comando con barra invertida (\\frac, \\sqrt, \\times, \\left, \\right...) — Typst no los compila.",
  "Ejemplos válidos: $1/2 + 1/4$, $frac(3, 4)$, $sqrt(2)$, $x^2 - 5x + 6 = 0$, $3 times 10^8$.",
].join(" ");

const SYSTEM_PROMPT = [
  "Eres un generador de preguntas tipo examen de admisión para colegios/academias peruanas.",
  "Responde EXCLUSIVAMENTE con el objeto JSON solicitado por el schema, sin explicaciones ni texto adicional.",
  TYPST_MATH_RULES,
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

const ANSWER_LETTERS = ["a", "b", "c", "d", "e"] as const;

const REVISE_SYSTEM_PROMPT = [
  "Eres un editor experto de preguntas tipo examen de admisión para colegios/academias peruanas.",
  "Se te dará una pregunta existente y una instrucción de edición del profesor; produce una NUEVA versión de la pregunta que cumpla la instrucción.",
  "Responde EXCLUSIVAMENTE con el objeto JSON solicitado por el schema, sin explicaciones ni texto adicional.",
  TYPST_MATH_RULES,
].join(" ");

/**
 * Builds the OpenRouter chat-completions request body for one
 * `reviseQuestion()` call. Mirrors `buildOpenRouterRequestBody`'s
 * model/response-format handling exactly (same `RESPONSE_JSON_SCHEMA`) — the
 * only difference is the user prompt, which carries the CURRENT question
 * (statement + alternatives + correct-answer LETTER, per the port contract)
 * plus the human editor's free-text instruction.
 */
export function buildOpenRouterReviseRequestBody(
  model: string,
  input: ReviseQuestionInput,
  options: BuildOpenRouterRequestOptions = {},
): OpenRouterRequestBody {
  const alternativesLines = input.current.alternatives.map(
    (alt, index) => `${ANSWER_LETTERS[index] ?? index}) ${alt}`,
  );

  const userPromptLines = [
    "Pregunta actual:",
    input.current.bodyTypst,
    "Alternativas actuales:",
    ...alternativesLines,
    `Alternativa correcta actual: ${input.current.correctAnswer}`,
    `Dificultad objetivo: ${input.difficulty}`,
    "",
    "Instrucción de edición del profesor:",
    input.instruction,
    "",
    "Genera la versión revisada de la pregunta, con 5 alternativas y la letra de la correcta.",
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
      { role: "system", content: REVISE_SYSTEM_PROMPT },
      { role: "user", content: userPromptLines.join("\n") },
    ],
    response_format: {
      type: "json_schema",
      json_schema: RESPONSE_JSON_SCHEMA,
    },
  };
}

const EXTRACT_SYSTEM_PROMPT = [
  "Eres un asistente que extrae preguntas tipo examen de admisión desde fotos de material impreso o manuscrito peruano.",
  "Lee la imagen y transcribe la pregunta que contiene: enunciado, alternativas y, si es identificable, la alternativa correcta.",
  "Responde EXCLUSIVAMENTE con el objeto JSON solicitado por el schema, sin explicaciones ni texto adicional.",
  TYPST_MATH_RULES,
].join(" ");

/**
 * Builds the OpenRouter chat-completions request body for one
 * `extractFromImage()` call. Same model/response-format handling as
 * `buildOpenRouterRequestBody` (same `RESPONSE_JSON_SCHEMA`), but the user
 * message is MULTIMODAL: a text instruction part plus an `image_url` part
 * whose URL is a `data:<mimeType>;base64,<...>` URI built from the raw image
 * bytes — this is the shape OpenRouter (OpenAI-compatible) vision models
 * expect.
 */
export function buildOpenRouterExtractRequestBody(
  model: string,
  input: ExtractQuestionInput,
  options: BuildOpenRouterRequestOptions = {},
): OpenRouterRequestBody {
  const instructionLines = [
    "Extrae la pregunta de opción múltiple que aparece en esta imagen.",
    "Debe tener 5 alternativas; identifica la letra de la correcta si es visible u obvia por el contexto.",
  ];

  if (options.previousError) {
    instructionLines.push(
      "",
      "Tu respuesta anterior fue inválida por lo siguiente — corrígelo en esta nueva respuesta:",
      options.previousError,
    );
  }

  const dataUrl = `data:${input.mimeType};base64,${input.image.toString("base64")}`;

  return {
    model,
    messages: [
      { role: "system", content: EXTRACT_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: instructionLines.join("\n") },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: RESPONSE_JSON_SCHEMA,
    },
  };
}
