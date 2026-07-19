import { Difficulty, Role } from "@exams-generator/shared";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository } from "../bank/bank.repository";
import { TypstCompilationError } from "../exams/domain/ports/pdf-compiler.port";
import { AiInvalidResponseError } from "./domain/ports/question-generator.port";
import { GenerateQuestionsService } from "./generate-questions.service";

const TEACHER_USER: AuthTokenPayload = { sub: "teacher-1", tenantId: "tenant-1", role: Role.Teacher };
const STAFF_USER: AuthTokenPayload = { sub: "staff-1", tenantId: null, role: Role.ContentEditor };

const VALID_DTO = {
  courseId: "course-1",
  topicId: "topic-1",
  difficulty: Difficulty.Easy,
  gradeLevel: "primaria_1",
  count: 2,
  withFigure: false,
};

const GENERATED_QUESTION = {
  bodyTypst: "¿Cuánto es 1+1?",
  alternatives: ["1", "2", "3", "4", "5"] as const,
  correctAnswer: "b",
};

function buildDeps() {
  const generator = {
    generate: jest.fn().mockResolvedValue(GENERATED_QUESTION),
    reviseQuestion: jest.fn().mockResolvedValue(GENERATED_QUESTION),
    extractFromImage: jest.fn().mockResolvedValue(GENERATED_QUESTION),
  };
  const pdfCompiler = {
    compileExam: jest.fn().mockResolvedValue(Buffer.from("fake-pdf")),
    compileAnswerKey: jest.fn().mockResolvedValue(Buffer.from("fake-pdf")),
  };
  const bankRepository = {
    findCourseAndTopicNames: jest
      .fn()
      .mockResolvedValue({ courseName: "Matemática", topicName: "Fracciones" }),
    createStructuredQuestion: jest
      .fn()
      .mockImplementation(async () => ({ id: `question-${Math.random()}` })),
  } as unknown as jest.Mocked<BankRepository>;

  const service = new GenerateQuestionsService(generator, pdfCompiler, bankRepository);
  return { service, generator, pdfCompiler, bankRepository };
}

describe("GenerateQuestionsService.generateQuestions", () => {
  it("rejects with BadRequestException (aggregating every error) when required fields are missing", async () => {
    const { service, generator, bankRepository } = buildDeps();

    await expect(
      service.generateQuestions(TEACHER_USER, {
        courseId: undefined,
        topicId: undefined,
        difficulty: undefined,
        gradeLevel: undefined,
        count: undefined,
        withFigure: undefined,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(generator.generate).not.toHaveBeenCalled();
    expect(bankRepository.createStructuredQuestion).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when courseId/topicId don't resolve to a real course+topic pair", async () => {
    const { service, bankRepository } = buildDeps();
    bankRepository.findCourseAndTopicNames.mockResolvedValue(undefined);

    await expect(service.generateQuestions(TEACHER_USER, VALID_DTO)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("generates `count` questions, compiles a Typst preview for each, and persists them as drafts", async () => {
    const { service, generator, pdfCompiler, bankRepository } = buildDeps();

    const result = await service.generateQuestions(TEACHER_USER, VALID_DTO);

    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect(generator.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        course: "Matemática",
        topic: "Fracciones",
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        withFigure: false,
      }),
    );
    expect(pdfCompiler.compileExam).toHaveBeenCalledTimes(2);
    expect(bankRepository.createStructuredQuestion).toHaveBeenCalledTimes(2);
    expect(bankRepository.createStructuredQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        topicId: "topic-1",
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        bodyTypst: GENERATED_QUESTION.bodyTypst,
        alternatives: GENERATED_QUESTION.alternatives,
        correctAnswer: "1",
        createdBy: "teacher-1",
        status: "draft",
        aiGenerated: true,
      }),
    );
    expect(result.created).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
  });

  it("persists tenantId=null when the requester is platform staff", async () => {
    const { service, bankRepository } = buildDeps();

    await service.generateQuestions(STAFF_USER, { ...VALID_DTO, count: 1 });

    expect(bankRepository.createStructuredQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, createdBy: "staff-1" }),
    );
  });

  it("retries generation once when the Typst preview fails to compile, and persists the question that compiles on retry", async () => {
    const { service, generator, pdfCompiler, bankRepository } = buildDeps();
    pdfCompiler.compileExam.mockRejectedValueOnce(
      new TypstCompilationError("typst compile failed", undefined, "syntax error"),
    );

    const result = await service.generateQuestions(TEACHER_USER, { ...VALID_DTO, count: 1 });

    expect(generator.generate).toHaveBeenCalledTimes(2);
    expect(pdfCompiler.compileExam).toHaveBeenCalledTimes(2);
    expect(bankRepository.createStructuredQuestion).toHaveBeenCalledTimes(1);
    expect(result.created).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
  });

  it("does NOT save a question whose Typst preview keeps failing to compile after exhausting all retry attempts", async () => {
    const { service, generator, pdfCompiler, bankRepository } = buildDeps();
    const compileError = new TypstCompilationError("typst compile failed", undefined, "syntax error");
    pdfCompiler.compileExam
      .mockRejectedValueOnce(compileError)
      .mockRejectedValueOnce(compileError);

    const result = await service.generateQuestions(TEACHER_USER, { ...VALID_DTO, count: 2 });

    // The first item exhausts both attempts (2 generate calls, 2 compile
    // calls) before giving up; the second item succeeds on its first try.
    expect(generator.generate).toHaveBeenCalledTimes(3);
    expect(pdfCompiler.compileExam).toHaveBeenCalledTimes(3);
    expect(bankRepository.createStructuredQuestion).toHaveBeenCalledTimes(1);
    expect(result.created).toHaveLength(1);
    expect(result.failed).toEqual([
      expect.objectContaining({ index: 0, error: expect.stringContaining("Typst compile failed") }),
    ]);
  });

  it("does NOT abort the whole batch when the AI provider fails for one item (e.g. invalid JSON)", async () => {
    const { service, generator, bankRepository } = buildDeps();
    generator.generate.mockRejectedValueOnce(new AiInvalidResponseError("bad json", "{}"));

    const result = await service.generateQuestions(TEACHER_USER, { ...VALID_DTO, count: 2 });

    expect(bankRepository.createStructuredQuestion).toHaveBeenCalledTimes(1);
    expect(result.created).toHaveLength(1);
    expect(result.failed).toEqual([expect.objectContaining({ index: 0 })]);
  });
});
