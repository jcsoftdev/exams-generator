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
    { questionId: "q1", position: 0, correctAnswer: "b", imageStorageKey: "bank/questions/q1", imageMime: "image/png" },
    { questionId: "q2", position: 1, correctAnswer: "d", imageStorageKey: "bank/questions/q2", imageMime: "image/png" },
  ],
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
  storage.put("bank/questions/q1", Buffer.from("fake-png-1"), "image/png");
  storage.put("bank/questions/q2", Buffer.from("fake-png-2"), "image/png");
  storage.put("tenants/tenant-1/logo/logo.png", Buffer.from("fake-logo"), "image/png");

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
        expect(q.imageAbsolutePath).toMatch(/^\//);
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
