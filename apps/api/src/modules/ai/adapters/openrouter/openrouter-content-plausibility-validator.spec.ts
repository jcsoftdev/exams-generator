import { Difficulty } from "@exams-generator/shared";
import { GenerateQuestionInput, GeneratedQuestion } from "../../domain/ports/question-generator.port";
import { assessGeneratedQuestionPlausibility } from "./openrouter-content-plausibility-validator";

const INPUT: GenerateQuestionInput = {
  course: "Geometría",
  topic: "Geometría del espacio (poliedros)",
  difficulty: Difficulty.Hard,
  gradeLevel: "pre",
  withFigure: true,
};

const PLAUSIBLE_QUESTION: GeneratedQuestion = {
  bodyTypst: "Un prisma cuadrangular tiene una altura de $8$ cm y arista basal $3$ cm. Halla su volumen.",
  alternatives: ["24", "48", "72", "96", "120"],
  correctAnswer: "d",
  figureCode: "#cetz.canvas({ import cetz.draw: *; circle((0,0), radius: 1) })",
};

describe("assessGeneratedQuestionPlausibility", () => {
  it("does not throw for a plausible, on-request question", () => {
    expect(() => assessGeneratedQuestionPlausibility(PLAUSIBLE_QUESTION, INPUT)).not.toThrow();
  });

  it("does not flag non-sequential numeric alternatives (real computed distractors)", () => {
    const question = { ...PLAUSIBLE_QUESTION, alternatives: ["1/4", "3/4", "1/2", "1", "2"] as const };
    expect(() => assessGeneratedQuestionPlausibility(question, { ...INPUT, withFigure: false })).not.toThrow();
  });

  it("does not flag a numeric run with a step other than 1", () => {
    const question = { ...PLAUSIBLE_QUESTION, alternatives: ["2", "4", "6", "8", "10"] as const };
    expect(() => assessGeneratedQuestionPlausibility(question, { ...INPUT, withFigure: false })).not.toThrow();
  });

  it("throws when alternatives are a bare ascending consecutive-integer placeholder (1,2,3,4,5)", () => {
    const question = { ...PLAUSIBLE_QUESTION, alternatives: ["1", "2", "3", "4", "5"] as const };
    expect(() => assessGeneratedQuestionPlausibility(question, { ...INPUT, withFigure: false })).toThrow(
      /consecutive/,
    );
  });

  it("throws when alternatives are a bare descending consecutive-integer placeholder (5,4,3,2,1)", () => {
    const question = { ...PLAUSIBLE_QUESTION, alternatives: ["5", "4", "3", "2", "1"] as const };
    expect(() => assessGeneratedQuestionPlausibility(question, { ...INPUT, withFigure: false })).toThrow(
      /consecutive/,
    );
  });

  it("throws when withFigure was requested but figureCode came back empty", () => {
    const question = { ...PLAUSIBLE_QUESTION, figureCode: undefined };
    expect(() => assessGeneratedQuestionPlausibility(question, { ...INPUT, withFigure: true })).toThrow(
      /figureCode/,
    );
  });

  it("does not require figureCode when withFigure was not requested", () => {
    const question = { ...PLAUSIBLE_QUESTION, figureCode: undefined };
    expect(() => assessGeneratedQuestionPlausibility(question, { ...INPUT, withFigure: false })).not.toThrow();
  });

  it("reports both failures together when alternatives are a placeholder AND the figure is missing", () => {
    const question: GeneratedQuestion = {
      bodyTypst: "¿Cuál es el resultado de $1 + 1$?",
      alternatives: ["1", "2", "3", "4", "5"],
      correctAnswer: "b",
      figureCode: undefined,
    };
    expect(() => assessGeneratedQuestionPlausibility(question, { ...INPUT, withFigure: true })).toThrow(
      /consecutive.*figureCode|figureCode.*consecutive/s,
    );
  });
});
