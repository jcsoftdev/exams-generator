import { GradeLevel } from "../../exams/domain/value-objects/grade-level";
import { Difficulty } from "@exams-generator/shared";
import {
  GenerateQuestionInput,
  GeneratedQuestion,
  QuestionGeneratorPort,
} from "../domain/ports/question-generator.port";
import { LazyQuestionGeneratorAdapter } from "./lazy-question-generator.adapter";

const INPUT: GenerateQuestionInput = {
  course: "Matemática",
  topic: "Fracciones",
  difficulty: Difficulty.Easy,
  gradeLevel: "primaria_1" as GradeLevel,
  withFigure: false,
};

const RESULT: GeneratedQuestion = {
  bodyTypst: "¿Cuánto es 1/2 + 1/4?",
  alternatives: ["1/4", "3/4", "1/2", "1", "2"],
  correctAnswer: "b",
};

describe("LazyQuestionGeneratorAdapter", () => {
  it("does NOT call the resolver at construction time", () => {
    const resolver = jest.fn();

    new LazyQuestionGeneratorAdapter(resolver);

    expect(resolver).not.toHaveBeenCalled();
  });

  it("calls the resolver only on the first generate() call, then delegates to the resolved adapter", async () => {
    const fakeAdapter: QuestionGeneratorPort = {
      generate: jest.fn().mockResolvedValue(RESULT),
      reviseQuestion: jest.fn().mockResolvedValue(RESULT),
      extractFromImage: jest.fn().mockResolvedValue(RESULT),
    };
    const resolver = jest.fn().mockReturnValue(fakeAdapter);

    const lazy = new LazyQuestionGeneratorAdapter(resolver);
    expect(resolver).not.toHaveBeenCalled();

    const result = await lazy.generate(INPUT);

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.generate).toHaveBeenCalledWith(INPUT, undefined);
    expect(result).toEqual(RESULT);
  });

  it("caches the resolved adapter — resolver is called only once across multiple generate() calls", async () => {
    const fakeAdapter: QuestionGeneratorPort = {
      generate: jest.fn().mockResolvedValue(RESULT),
      reviseQuestion: jest.fn().mockResolvedValue(RESULT),
      extractFromImage: jest.fn().mockResolvedValue(RESULT),
    };
    const resolver = jest.fn().mockReturnValue(fakeAdapter);
    const lazy = new LazyQuestionGeneratorAdapter(resolver);

    await lazy.generate(INPUT);
    await lazy.generate(INPUT);

    expect(resolver).toHaveBeenCalledTimes(1);
    expect(fakeAdapter.generate).toHaveBeenCalledTimes(2);
  });

  it("propagates the resolver's error (e.g. missing AI_MODEL/OPENROUTER_API_KEY) on generate(), not before", async () => {
    const resolver = jest.fn().mockImplementation(() => {
      throw new Error("AI_MODEL env var is not set.");
    });

    const lazy = new LazyQuestionGeneratorAdapter(resolver);

    await expect(lazy.generate(INPUT)).rejects.toThrow(/AI_MODEL/);
  });
});
