import { Difficulty } from "@exams-generator/shared";
import {
  GenerateQuestionInput,
  QuestionGeneratorPort,
} from "./question-generator.port";

/**
 * Shared contract test suite — ANY `QuestionGeneratorPort` adapter must
 * satisfy every case here (mirrors `storage.port.contract.ts`). Real
 * network-backed adapters (OpenRouter) are NOT run through this suite in CI
 * — they have their own unit tests with a mocked HTTP client. This suite
 * runs against the in-memory fake to lock down the shape every adapter must
 * honor.
 */
const BASE_INPUT: GenerateQuestionInput = {
  course: "Aritmética",
  topic: "fracciones",
  difficulty: Difficulty.Medium,
  gradeLevel: "secundaria_3",
  withFigure: false,
};

export function runQuestionGeneratorPortContract(
  label: string,
  createAdapter: () => QuestionGeneratorPort,
): void {
  describe(`QuestionGeneratorPort contract: ${label}`, () => {
    it("generate() resolves a question with a non-empty Typst body", async () => {
      const adapter = createAdapter();

      const result = await adapter.generate(BASE_INPUT);

      expect(typeof result.bodyTypst).toBe("string");
      expect(result.bodyTypst.length).toBeGreaterThan(0);
    });

    it("generate() resolves exactly 5 alternatives", async () => {
      const adapter = createAdapter();

      const result = await adapter.generate(BASE_INPUT);

      expect(result.alternatives).toHaveLength(5);
      result.alternatives.forEach((alt) => {
        expect(typeof alt).toBe("string");
        expect(alt.length).toBeGreaterThan(0);
      });
    });

    it("generate() resolves a correctAnswer that is one of a-e", async () => {
      const adapter = createAdapter();

      const result = await adapter.generate(BASE_INPUT);

      expect(["a", "b", "c", "d", "e"]).toContain(result.correctAnswer);
    });

    it("generate() omits figureCode when withFigure is false", async () => {
      const adapter = createAdapter();

      const result = await adapter.generate({ ...BASE_INPUT, withFigure: false });

      expect(result.figureCode).toBeUndefined();
    });

    it("generate() resolves a non-empty figureCode when withFigure is true", async () => {
      const adapter = createAdapter();

      const result = await adapter.generate({ ...BASE_INPUT, withFigure: true });

      expect(typeof result.figureCode).toBe("string");
      expect((result.figureCode as string).length).toBeGreaterThan(0);
    });
  });
}
