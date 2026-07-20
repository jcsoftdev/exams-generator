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
  "En geometría, un nombre de lado/segmento de dos o más letras (AB, BC, AC) va SIEMPRE FUERA de $...$, como texto normal: 'El segmento AB mide $8$' — NUNCA '$AB = 8$' (Typst lo lee como A por B y falla) y NUNCA con comillas dentro de $...$ tampoco (ej. $\"AB\" = 8$) — un string con comillas anidadas dentro de otro string JSON es fácil de escribir mal y corrompe toda la respuesta.",
  "Ejemplos válidos: $1/2 + 1/4$, $frac(3, 4)$, $sqrt(2)$, $x^2 - 5x + 6 = 0$, $3 times 10^8$. El segmento AB mide $8$ cm (AB fuera del $...$).",
].join(" ");

/**
 * `@preview/cetz:0.5.2` is the LATEST cetz release as of this pin, verified
 * directly against the typst binary pinned in `infra/Dockerfile.api`
 * (`TYPST_VERSION=0.15.1`, matched by `apps/api/scripts/install-typst-dev.sh`
 * for local dev). A version mismatch here (model emits an incompatible cetz
 * version) reliably fails compile regardless of how correct the CeTZ
 * drawing code itself is — this was the actual root cause behind "Typst
 * compile failed" on every figure/diagram generation. If `TYPST_VERSION` is
 * ever bumped, re-verify this pin against it (and re-check
 * install-typst-dev.sh's pin, which must always match).
 */
const CETZ_EXAMPLE = [
  '#import "@preview/cetz:0.5.2": canvas, draw',
  "",
  "#canvas({",
  "  import draw: *",
  "  line((0,0), (4,0), (4,3), close: true)",
  "  content((2,-0.4), [Base])",
  "  circle((1,1), radius: 0.3)",
  "})",
].join("\n");

const CETZ_RULES = [
  "Si figureCode incluye una figura, usa EXCLUSIVAMENTE esta versión exacta de CeTZ (otras versiones no compilan con el typst instalado):",
  '`#import "@preview/cetz:0.5.2": canvas, draw`',
  "Estructura obligatoria: `#canvas({ import draw: *  ...dibujos... })`. Coordenadas como tuplas `(x, y)`.",
  "Funciones disponibles: `line((x1,y1), (x2,y2), .., close: true)`, `circle((x,y), radius: r)`, `content((x,y), [texto])`, `rect((x1,y1), (x2,y2))`.",
  "PROHIBIDO devolver un placeholder o solo la palabra 'CeTZ'/'figura' en figureCode — o es código real que empieza con el import de arriba, o es null.",
  "Si dibujas un polígono con vértices nombrados (ej. un cuadrilátero ABCD, un triángulo PQR), usa UNA sola llamada a line() con TODOS los vértices en el orden del perímetro (el mismo orden en que aparecen en el nombre, ej. ABCD → A, B, C, D) y close: true al final — NUNCA generes los lados con varias llamadas line() separadas, porque así es fácil conectar dos vértices que en realidad son una DIAGONAL (ej. A con C en un cuadrilátero ABCD) creyendo que es un lado. NUNCA conectes diagonales como si fueran lados del perímetro.",
  "Ejemplo válido completo:",
  CETZ_EXAMPLE,
].join(" ");

/**
 * `typst-template.ts` ALWAYS prepends its own letter (`A)`, `B)`, ...) when
 * rendering each alternative — a model that also writes the letter into the
 * alternative text itself produces a visible duplicate ("A) A: √5"). The
 * backend strips a leading letter marker defensively
 * (`openrouter-response-validator.ts`), but telling the model not to write
 * one in the first place avoids relying on that safety net.
 *
 * The explicit "NUNCA... {\"texto\":...}" line exists because an earlier,
 * shorter version of this rule ("no escribas la letra dentro del texto")
 * caused a weaker model to "overcorrect": instead of a plain string it
 * started emitting each alternative as a JSON-string-encoded object like
 * `{"texto": "5/2√7", "letra": "A"}` — satisfies the schema's `string` type
 * literally, but is garbage once rendered. The backend also defensively
 * unwraps that exact shape (`unwrapJsonWrappedAlternative` in
 * `openrouter-response-validator.ts`), but the instruction has to rule it
 * out explicitly too, not just imply it.
 */
const ALTERNATIVES_RULES =
  'Cada elemento de "alternatives" es un STRING PLANO con el valor de la respuesta y NADA MÁS. NUNCA escribas la letra dentro del texto (prohibido \'A)\', \'a:\', \'B.\' al inicio) — la letra la agrega el sistema según la posición en el array. Y NUNCA envuelvas el valor en un objeto, ej. NUNCA \'{"texto": "5/2√7", "letra": "A"}\' — eso NO es un string plano y rompe el examen. Correcto: "5/2√7". Incorrecto: "A) 5/2√7", {"texto": "5/2√7", "letra": "A"}.';

/**
 * The "Dificultad" field alone is just a label — without a rigor anchor the
 * model calibrates "easy"/"medium"/"hard" against its own generic sense of
 * difficulty, not this exam's actual standard. This gave us an "easy"
 * geometry question dressed up with harder-than-intended reasoning. Anchor
 * each label to a concrete, checkable criterion (step count + concept count),
 * with a worked reference example for "easy" — the same technique
 * `TYPST_MATH_RULES` uses (concrete examples beat vague adjectives).
 */
const DIFFICULTY_CALIBRATION_RULES = [
  "Calibra el NIVEL DE EXIGENCIA real de la pregunta según la dificultad pedida. Las tres etiquetas son una PROGRESIÓN de análisis, NO 'mecánico vs analítico' — hasta las preguntas \"easy\" deben exigir que el estudiante LEA e INTERPRETE el enunciado, nunca solo recuerde una fórmula de memoria sin pensar. El objetivo es que cada nivel sea una prueba real que mejore las habilidades del estudiante, no un plug-and-chug vacío:",
  '"easy": análisis SIMPLE y directo — el estudiante debe identificar e interpretar cuál única relación o propiedad aplica (puede no estar dicha palabra por palabra en el enunciado), pero la interpretación es directa, sin casos que evaluar ni datos ocultos, y los números dan un resultado limpio. Ejemplo de calibre: en un triángulo rectángulo con altura trazada a la hipotenusa, dados los segmentos 4 y 9, hallar la altura (el estudiante debe reconocer que aplica la relación altura² = producto de los segmentos → altura = 6 — eso YA es interpretar el enunciado, no pura memorización).',
  '"medium": análisis MODERADO — el estudiante debe interpretar el enunciado para identificar qué relación o propiedad aplica cuando NO es evidente a primera vista, o combinar dos conceptos cuya conexión no está declarada, o interpretar un dato indirecto antes de poder plantear la solución.',
  '"hard": análisis PROFUNDO — evaluar varios casos o condiciones antes de decidir cuál aplica, justificar por qué una estrategia es válida sobre otra, interpretar información no explícita en un problema contextualizado, o sintetizar 3 o más conceptos cuya conexión el estudiante debe descubrir por sí mismo.',
  'NUNCA generes una pregunta "easy" que sea pura memorización sin ninguna interpretación, ni una que en realidad exige el análisis de "medium"/"hard" (varios casos, dato oculto, conexión no evidente entre conceptos, estrategia a decidir).',
].join(" ");

const SYSTEM_PROMPT = [
  "Eres un generador de preguntas tipo examen de admisión para colegios/academias peruanas.",
  "Responde EXCLUSIVAMENTE con el objeto JSON solicitado por el schema, sin explicaciones ni texto adicional.",
  TYPST_MATH_RULES,
  CETZ_RULES,
  ALTERNATIVES_RULES,
  DIFFICULTY_CALIBRATION_RULES,
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
  CETZ_RULES,
  ALTERNATIVES_RULES,
  DIFFICULTY_CALIBRATION_RULES,
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
  CETZ_RULES,
  ALTERNATIVES_RULES,
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
