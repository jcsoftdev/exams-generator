import { Difficulty, Role } from "@exams-generator/shared";
import { BadRequestException, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { TypstCompilationError } from "../exams/domain/ports/pdf-compiler.port";
import { BankRepository, QuestionListItem } from "../bank/bank.repository";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { ReviseQuestionService } from "./revise-question.service";

const TEACHER_USER: AuthTokenPayload = { sub: "teacher-1", tenantId: "tenant-1", role: Role.Teacher };

const EXISTING_QUESTION: QuestionListItem = {
  id: "q1",
  tenantId: "tenant-1",
  courseId: "course-1",
  topicId: "topic-1",
  difficulty: Difficulty.Easy,
  gradeLevel: "primaria_1",
  // 0-based INDEX (bank storage convention) — letter "a".
  correctAnswer: "0",
  type: "structured",
  status: "draft",
  aiGenerated: true,
  imageAssetId: null,
  bodyTypst: "¿Cuánto es $1+1$?",
  alternatives: ["1", "2", "3", "4", "5"],
  figureCode: null,
};

const REVISED_QUESTION: GeneratedQuestion = {
  bodyTypst: "¿Cuánto es $1+1$? (más difícil)",
  alternatives: ["1", "2", "3", "4", "5"],
  // LETTER (QuestionGeneratorPort contract) — "b" is index 1.
  correctAnswer: "b",
};

function buildDeps() {
  const bankRepository = {
    findQuestionById: jest.fn().mockResolvedValue(EXISTING_QUESTION),
    createStructuredQuestion: jest.fn(),
    createImageQuestion: jest.fn(),
    updateStructuredQuestionAndTaxonomy: jest.fn(),
    approveQuestion: jest.fn(),
    rejectQuestion: jest.fn(),
    deleteQuestion: jest.fn(),
    updateStatus: jest.fn(),
    replaceImageAsset: jest.fn(),
  } as unknown as jest.Mocked<BankRepository>;

  const generator: jest.Mocked<QuestionGeneratorPort> = {
    generate: jest.fn(),
    reviseQuestion: jest.fn().mockResolvedValue(REVISED_QUESTION),
    extractFromImage: jest.fn(),
  };

  const pdfCompiler = {
    compileExam: jest.fn().mockResolvedValue(Buffer.from("fake-pdf-bytes")),
    compileAnswerKey: jest.fn().mockResolvedValue(Buffer.from("fake-pdf-bytes")),
  };

  const service = new ReviseQuestionService(generator, pdfCompiler, bankRepository);
  return { service, bankRepository, generator, pdfCompiler };
}

describe("ReviseQuestionService.revise", () => {
  it("returns the generator's validated, UNSAVED output and never writes to the repository", async () => {
    const { service, bankRepository } = buildDeps();

    const result = await service.revise(TEACHER_USER, "q1", "más difícil");

    expect(result).toEqual({ ...REVISED_QUESTION, correctAnswer: "1" });
    expect(bankRepository.updateStructuredQuestionAndTaxonomy).not.toHaveBeenCalled();
    expect(bankRepository.createStructuredQuestion).not.toHaveBeenCalled();
  });

  it("converts the DB question's INDEX correctAnswer to a LETTER before calling the generator, and the generator's LETTER back to an INDEX in the response (Task 4 review fix)", async () => {
    const { service, generator } = buildDeps();

    const result = await service.revise(TEACHER_USER, "q1", "más difícil");

    // Generator port contract expects a LETTER ("a".."e"), matching GeneratedQuestion.
    expect(generator.reviseQuestion).toHaveBeenCalledWith({
      current: {
        bodyTypst: EXISTING_QUESTION.bodyTypst,
        alternatives: EXISTING_QUESTION.alternatives,
        correctAnswer: "a", // index "0" -> letter "a"
      },
      instruction: "más difícil",
      difficulty: EXISTING_QUESTION.difficulty,
    });

    // Bank storage/PATCH convention expects a 0-based INDEX — letter "b" -> "1".
    expect(result.correctAnswer).toBe("1");
  });

  it("throws BadRequestException when the instruction is blank", async () => {
    const { service, bankRepository, generator } = buildDeps();

    await expect(service.revise(TEACHER_USER, "q1", "   ")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(bankRepository.findQuestionById).not.toHaveBeenCalled();
    expect(generator.reviseQuestion).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when the question doesn't exist or isn't visible to the requester", async () => {
    const { service, bankRepository } = buildDeps();
    bankRepository.findQuestionById.mockResolvedValue(undefined);

    await expect(service.revise(TEACHER_USER, "missing", "más difícil")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("throws BadRequestException for IMAGE questions instead of crashing on their LETTER correctAnswer — there is no structured content to revise", async () => {
    const { service, bankRepository, generator } = buildDeps();
    bankRepository.findQuestionById.mockResolvedValue({
      ...EXISTING_QUESTION,
      type: "image",
      // Image rows store the clave as a LETTER ("a".."d") and carry no
      // bodyTypst/alternatives — feeding them to the generator would be
      // meaningless even if correctAnswerIndexToLetter didn't throw first.
      correctAnswer: "a",
      bodyTypst: null,
      alternatives: null,
      imageAssetId: "asset-1",
    });

    await expect(service.revise(TEACHER_USER, "q1", "más difícil")).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(generator.reviseQuestion).not.toHaveBeenCalled();
  });

  it("throws UnprocessableEntityException when the AI output fails validateStructuredContent", async () => {
    const { service, generator } = buildDeps();
    generator.reviseQuestion.mockResolvedValue({
      bodyTypst: "¿Cuánto es $1+1$?",
      // Only 1 alternative — fails validateStructuredContent's MIN_ALTERNATIVES=2 rule.
      alternatives: ["1"] as unknown as GeneratedQuestion["alternatives"],
      correctAnswer: "a",
    });

    await expect(service.revise(TEACHER_USER, "q1", "más difícil")).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("throws UnprocessableEntityException when the AI output fails the Typst compile", async () => {
    const { service, pdfCompiler } = buildDeps();
    pdfCompiler.compileExam.mockRejectedValue(
      new TypstCompilationError("typst compile failed", undefined, "syntax error"),
    );

    await expect(service.revise(TEACHER_USER, "q1", "más difícil")).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });
});
