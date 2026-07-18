import { parseGeneratedQuestionContent } from "./openrouter-response-parser";

const CLEAN_JSON = {
  bodyTypst: "¿Cuánto es $1+1$?",
  alternatives: ["1", "2", "3", "4", "5"],
  correctAnswer: "b",
  figureCode: null,
};

describe("parseGeneratedQuestionContent", () => {
  it("parses a clean response with no reasoning at all", () => {
    const content = JSON.stringify(CLEAN_JSON);

    const result = parseGeneratedQuestionContent(content);

    expect(result).toEqual(CLEAN_JSON);
  });

  it("discards inline reasoning that appears before the JSON object", () => {
    const content = [
      "Let me think step by step about fractions and arithmetic operations.",
      "First I'll consider the sum, then pick 5 plausible distractors.",
      "Okay, I'm confident in the final answer now:",
      JSON.stringify(CLEAN_JSON),
    ].join("\n");

    const result = parseGeneratedQuestionContent(content);

    expect(result).toEqual(CLEAN_JSON);
  });

  it("discards reasoning wrapped in <think>...</think> tags before the JSON object", () => {
    const content = `<think>\nHmm, the question is about ${"fractions"}. Let me draft alternatives: {"draft": true}.\n</think>\n${JSON.stringify(
      CLEAN_JSON,
    )}`;

    const result = parseGeneratedQuestionContent(content);

    expect(result).toEqual(CLEAN_JSON);
  });

  it("picks the LAST top-level JSON object when reasoning text contains an earlier JSON-looking example", () => {
    const decoyJson = { example: true, notes: "this is just a draft example" };
    const content = `Here's an example shape: ${JSON.stringify(decoyJson)}. Now the real answer:\n${JSON.stringify(
      CLEAN_JSON,
    )}`;

    const result = parseGeneratedQuestionContent(content);

    expect(result).toEqual(CLEAN_JSON);
  });

  it("throws SyntaxError when no JSON object can be found at all", () => {
    const content = "I could not generate a question right now, sorry.";

    expect(() => parseGeneratedQuestionContent(content)).toThrow(SyntaxError);
  });
});
