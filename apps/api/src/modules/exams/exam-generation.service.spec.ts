import { Role } from "@exams-generator/shared";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { InMemoryStorageAdapter } from "./adapters/storage/in-memory-storage.adapter";
import { createSeededRng } from "./domain/ports/random.port";
import {
  AnswerKeyDocumentInput,
  ExamPdfDocumentInput,
  PdfCompilerPort,
  TypstCompilationError,
} from "./domain/ports/pdf-compiler.port";
import { AuthTokenPayload } from "../auth/token.service";
import { ExamForGenerationRecord, ExamsRepository } from "./exams.repository";
import { ExamPdfGenerationError, ExamVersionGenerationService } from "./exam-generation.service";

const TEACHER: AuthTokenPayload = { sub: "teacher-1", tenantId: "tenant-1", role: Role.Teacher };

const READY_EXAM: ExamForGenerationRecord = {
  id: "exam-1",
  tenantId: "tenant-1",
  title: "Simulacro San Marcos",
  status: "ready",
  logoStorageKey: "tenants/tenant-1/logo/logo.png",
  selectedQuestions: [
    {
      questionId: "q1",
      position: 0,
      type: "image",
      correctAnswer: "b",
      imageStorageKey: "bank/questions/q1",
      imageMime: "image/png",
      bodyTypst: null,
      alternatives: null,
      figureCode: null,
    },
    {
      questionId: "q2",
      position: 1,
      type: "image",
      correctAnswer: "d",
      imageStorageKey: "bank/questions/q2",
      imageMime: "image/png",
      bodyTypst: null,
      alternatives: null,
      figureCode: null,
    },
  ],
};

const STRUCTURED_QUESTION_RECORD = {
  questionId: "q3",
  position: 2,
  type: "structured" as const,
  correctAnswer: "1",
  imageStorageKey: null,
  imageMime: null,
  bodyTypst: "¿Cuánto es $3 + 3$?",
  alternatives: ["5", "6", "7"],
  figureCode: null,
};

class FakePdfCompiler implements PdfCompilerPort {
  readonly examCalls: ExamPdfDocumentInput[] = [];
  readonly answerKeyCalls: AnswerKeyDocumentInput[] = [];

  async compileExam(input: ExamPdfDocumentInput): Promise<Buffer> {
    this.examCalls.push(input);
    return Buffer.from(`exam-pdf:${input.versionLabel}`);
  }

  async compileAnswerKey(input: AnswerKeyDocumentInput): Promise<Buffer> {
    this.answerKeyCalls.push(input);
    return Buffer.from(`answer-key-pdf:${input.versionLabel}`);
  }
}

function buildDeps() {
  const repository = {
    getExamForGeneration: jest.fn(),
    createAsset: jest.fn(),
    saveVersion: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ExamsRepository>;

  const storage = new InMemoryStorageAdapter();
  void storage.put("bank/questions/q1", Buffer.from("fake-png-1"), "image/png");
  void storage.put("bank/questions/q2", Buffer.from("fake-png-2"), "image/png");
  void storage.put("tenants/tenant-1/logo/logo.png", Buffer.from("fake-logo"), "image/png");

  const pdfCompiler = new FakePdfCompiler();

  const service = new ExamVersionGenerationService(repository, storage, pdfCompiler, () => createSeededRng(7));

  return { service, repository, storage, pdfCompiler };
}

describe("ExamVersionGenerationService.generateVersions", () => {
  it("rejects when the exam does not exist or belongs to another tenant", async () => {
    const { service, repository } = buildDeps();
    repository.getExamForGeneration.mockResolvedValue(undefined);

    await expect(service.generateVersions(TEACHER, "exam-1", 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects when the exam is not yet confirmed (status != ready)", async () => {
    const { service, repository } = buildDeps();
    repository.getExamForGeneration.mockResolvedValue({ ...READY_EXAM, status: "draft" });

    await expect(service.generateVersions(TEACHER, "exam-1", 2)).rejects.toBeInstanceOf(ConflictException);
  });

  it("rejects a non-positive versionCount", async () => {
    const { service, repository } = buildDeps();
    repository.getExamForGeneration.mockResolvedValue(READY_EXAM);

    await expect(service.generateVersions(TEACHER, "exam-1", 0)).rejects.toThrow();
  });

  it("generates K versions, compiling exam + answer key per version and uploading both PDFs", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.getExamForGeneration.mockResolvedValue(READY_EXAM);
    repository.createAsset.mockResolvedValue({ id: "asset-id" });

    const results = await service.generateVersions(TEACHER, "exam-1", 2);

    expect(results).toHaveLength(2);
    expect(pdfCompiler.examCalls).toHaveLength(2);
    expect(pdfCompiler.answerKeyCalls).toHaveLength(2);

    // Every version's exam PDF gets both questions, referencing real on-disk paths.
    for (const call of pdfCompiler.examCalls) {
      expect(call.title).toBe("Simulacro San Marcos");
      expect(call.tenantLogoAbsolutePath).toBeDefined();
      expect(call.questions.map((q) => q.id).sort()).toEqual(["q1", "q2"]);
      for (const q of call.questions) {
        // READY_EXAM fixture is all image questions; narrow the discriminated
        // union (structured questions carry no on-disk image path).
        expect(q.type).not.toBe("structured");
        if (q.type !== "structured") {
          expect(q.imageAbsolutePath).toMatch(/^\//);
        }
      }
    }

    // answer key entries reflect the correct answer regardless of shuffled position.
    for (const call of pdfCompiler.answerKeyCalls) {
      const byId = new Map(call.entries.map((e) => [e.questionId, e.correctOption]));
      expect(byId.get("q1")).toBe("b");
      expect(byId.get("q2")).toBe("d");
    }

    expect(repository.createAsset).toHaveBeenCalledTimes(4); // 2 versions * (exam pdf + answer key)
    expect(repository.saveVersion).toHaveBeenCalledTimes(2);
    for (const result of results) {
      expect(result.pdfUrl).toMatch(/^memory:\/\//);
      expect(result.answerSheetUrl).toMatch(/^memory:\/\//);
    }
  });

  it("mixes image + structured questions: structured alternatives are shuffled per version, image is untouched, and the answer key follows the shuffled position (Lane B1xD4 gap)", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    const mixedExam: ExamForGenerationRecord = {
      ...READY_EXAM,
      selectedQuestions: [...READY_EXAM.selectedQuestions, STRUCTURED_QUESTION_RECORD],
    };
    repository.getExamForGeneration.mockResolvedValue(mixedExam);
    repository.createAsset.mockResolvedValue({ id: "asset-id" });

    const results = await service.generateVersions(TEACHER, "exam-1", 3);

    expect(results).toHaveLength(3);
    expect(pdfCompiler.examCalls).toHaveLength(3);
    expect(pdfCompiler.answerKeyCalls).toHaveLength(3);

    for (let i = 0; i < pdfCompiler.examCalls.length; i++) {
      const examCall = pdfCompiler.examCalls[i]!;
      const answerKeyCall = pdfCompiler.answerKeyCalls[i]!;

      expect(examCall.questions.map((q) => q.id).sort()).toEqual(["q1", "q2", "q3"]);

      const structuredQuestion = examCall.questions.find((q) => q.id === "q3");
      expect(structuredQuestion?.type).toBe("structured");
      if (structuredQuestion?.type !== "structured") {
        throw new Error("expected q3 to render as a structured question");
      }
      // Alternatives are shuffled (a permutation of the original 3), never
      // the untouched original image-baked answer letter passthrough.
      expect(structuredQuestion.bodyTypst).toBe(STRUCTURED_QUESTION_RECORD.bodyTypst);
      expect([...structuredQuestion.alternatives].sort()).toEqual(["5", "6", "7"]);

      // The image question in the same version is completely unaffected —
      // still a materialized on-disk path, never shuffled alternatives.
      const imageQuestion = examCall.questions.find((q) => q.id === "q1");
      expect(imageQuestion?.type).not.toBe("structured");

      // Release-gate invariant (Lane D4): the answer key's letter for q3
      // must point at the alternative text that was ORIGINALLY correct
      // (index 1 -> "6"), regardless of where shuffling moved it.
      const structuredEntry = answerKeyCall.entries.find((e) => e.questionId === "q3");
      expect(structuredEntry).toBeDefined();
      const letterIndex = structuredEntry!.correctOption.charCodeAt(0) - "A".charCodeAt(0);
      expect(structuredQuestion.alternatives[letterIndex]).toBe("6");

      // Image answer keys still pass through unchanged.
      const byId = new Map(answerKeyCall.entries.map((e) => [e.questionId, e.correctOption]));
      expect(byId.get("q1")).toBe("b");
      expect(byId.get("q2")).toBe("d");
    }
  });

  it("wraps TypstCompilationError into ExamPdfGenerationError, surfacing the failing question id", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.getExamForGeneration.mockResolvedValue(READY_EXAM);
    repository.createAsset.mockResolvedValue({ id: "asset-id" });
    jest
      .spyOn(pdfCompiler, "compileExam")
      .mockRejectedValue(new TypstCompilationError("typst compile failed", "q2", "stderr contents"));

    const promise = service.generateVersions(TEACHER, "exam-1", 1);

    await expect(promise).rejects.toBeInstanceOf(ExamPdfGenerationError);
    await expect(promise).rejects.toMatchObject({ examId: "exam-1", questionId: "q2" });
  });
});
