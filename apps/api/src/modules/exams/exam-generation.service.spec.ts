import { Difficulty, Role } from "@exams-generator/shared";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
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

/**
 * The PDF port takes a booklet as sections -> blocks -> questions, but these
 * tests assert on the FLAT set of questions the service handed it: which ids
 * were compiled, which paths were materialized, how the answer key lines up.
 * None of that cares how the booklet is divided, so the two helpers below
 * flatten the input once and every assertion stays as it was.
 */
function allQuestions(input: ExamPdfDocumentInput) {
  return input.sections.flatMap((section) => section.blocks.flatMap((block) => block.questions));
}

function allEntries(input: AnswerKeyDocumentInput) {
  return input.sections.flatMap((section) => section.entries);
}

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
    confirmExam: jest.fn().mockResolvedValue(undefined),
    clearVersions: jest.fn().mockResolvedValue([]),
    getVersionAssetRecords: jest.fn(),
    // The uncompilable-question swap path calls these. Left as "nothing to
    // swap" by default (no blueprint row for the question) so the base
    // fixture keeps the original fail-loudly behaviour; the swap tests
    // override them with a bank that actually has a replacement.
    archiveQuestion: jest.fn().mockResolvedValue(undefined),
    findExamQuestion: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<ExamsRepository>;

  const storage = new InMemoryStorageAdapter();
  void storage.put("bank/questions/q1", Buffer.from("fake-png-1"), "image/png");
  void storage.put("bank/questions/q2", Buffer.from("fake-png-2"), "image/png");
  void storage.put("tenants/tenant-1/logo/logo.png", Buffer.from("fake-logo"), "image/png");

  const pdfCompiler = new FakePdfCompiler();

  // Only `error` is exercised; the service takes the nestjs-pino Logger.
  const logger = { error: jest.fn() } as unknown as import("nestjs-pino").Logger;

  const service = new ExamVersionGenerationService(
    repository,
    storage,
    pdfCompiler,
    () => createSeededRng(7),
    logger,
  );

  return { service, repository, storage, pdfCompiler, logger };
}

describe("ExamVersionGenerationService.generateVersions", () => {
  it("rejects when the exam does not exist or belongs to another tenant", async () => {
    const { service, repository } = buildDeps();
    repository.getExamForGeneration.mockResolvedValue(undefined);

    await expect(service.generateVersions(TEACHER, "exam-1", 2)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects a draft exam with ZERO selected questions with 409, and does NOT call confirmExam (B3-R2)", async () => {
    const { service, repository } = buildDeps();
    repository.getExamForGeneration.mockResolvedValue({
      ...READY_EXAM,
      status: "draft",
      selectedQuestions: [],
    });

    await expect(service.generateVersions(TEACHER, "exam-1", 2)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.confirmExam).not.toHaveBeenCalled();
  });

  it("auto-confirms a draft exam WITH selected questions (calls confirmExam) then generates normally (B3-R1/R5)", async () => {
    const { service, repository } = buildDeps();
    repository.getExamForGeneration.mockResolvedValue({ ...READY_EXAM, status: "draft" });
    repository.createAsset.mockResolvedValue({ id: "asset-id" });

    const results = await service.generateVersions(TEACHER, "exam-1", 2);

    expect(repository.confirmExam).toHaveBeenCalledWith("exam-1");
    expect(results).toHaveLength(2);
  });

  it("a ready exam does NOT trigger confirmExam — no regression (B3-R3)", async () => {
    const { service, repository } = buildDeps();
    repository.getExamForGeneration.mockResolvedValue(READY_EXAM);
    repository.createAsset.mockResolvedValue({ id: "asset-id" });

    await service.generateVersions(TEACHER, "exam-1", 1);

    expect(repository.confirmExam).not.toHaveBeenCalled();
  });

  it("rejects when the exam's status is neither draft nor ready — unchanged rejection (B3-R4)", async () => {
    const { service, repository } = buildDeps();
    repository.getExamForGeneration.mockResolvedValue({ ...READY_EXAM, status: "archived" as never });

    await expect(service.generateVersions(TEACHER, "exam-1", 2)).rejects.toBeInstanceOf(ConflictException);
    expect(repository.confirmExam).not.toHaveBeenCalled();
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
      expect(allQuestions(call).map((q) => q.id).sort()).toEqual(["q1", "q2"]);
      for (const q of allQuestions(call)) {
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
      const byId = new Map(allEntries(call).map((e) => [e.questionId, e.correctOption]));
      expect(byId.get("q1")).toBe("b");
      expect(byId.get("q2")).toBe("d");
    }

    expect(repository.createAsset).toHaveBeenCalledTimes(4); // 2 versions * (exam pdf + answer key)
    expect(repository.saveVersion).toHaveBeenCalledTimes(2);
    for (const result of results) {
      expect(result.pdfUrl).toMatch(/^\/assets\//);
      expect(result.answerSheetUrl).toMatch(/^\/assets\//);
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

      expect(allQuestions(examCall).map((q) => q.id).sort()).toEqual(["q1", "q2", "q3"]);

      const structuredQuestion = allQuestions(examCall).find((q) => q.id === "q3");
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
      const imageQuestion = allQuestions(examCall).find((q) => q.id === "q1");
      expect(imageQuestion?.type).not.toBe("structured");

      // Release-gate invariant (Lane D4): the answer key's letter for q3
      // must point at the alternative text that was ORIGINALLY correct
      // (index 1 -> "6"), regardless of where shuffling moved it.
      const structuredEntry = allEntries(answerKeyCall).find((e) => e.questionId === "q3");
      expect(structuredEntry).toBeDefined();
      const letterIndex = structuredEntry!.correctOption.charCodeAt(0) - "A".charCodeAt(0);
      expect(structuredQuestion.alternatives[letterIndex]).toBe("6");

      // Image answer keys still pass through unchanged.
      const byId = new Map(allEntries(answerKeyCall).map((e) => [e.questionId, e.correctOption]));
      expect(byId.get("q1")).toBe("b");
      expect(byId.get("q2")).toBe("d");
    }
  });

  it("materializes a structured question's complement image and sets imageAbsolutePath alongside bodyTypst/alternatives", async () => {
    const { service, repository, storage, pdfCompiler } = buildDeps();
    await storage.put("bank/questions/q3-complement", Buffer.from("fake-chart-png"), "image/png");

    const examWithComplementImage: ExamForGenerationRecord = {
      ...READY_EXAM,
      selectedQuestions: [
        ...READY_EXAM.selectedQuestions,
        {
          ...STRUCTURED_QUESTION_RECORD,
          imageStorageKey: "bank/questions/q3-complement",
          imageMime: "image/png",
        },
      ],
    };
    repository.getExamForGeneration.mockResolvedValue(examWithComplementImage);
    repository.createAsset.mockResolvedValue({ id: "asset-id" });

    const results = await service.generateVersions(TEACHER, "exam-1", 1);

    expect(results).toHaveLength(1);
    const examCall = pdfCompiler.examCalls[0]!;
    const structuredQuestion = allQuestions(examCall).find((q) => q.id === "q3");
    expect(structuredQuestion?.type).toBe("structured");
    if (structuredQuestion?.type !== "structured") {
      throw new Error("expected q3 to render as a structured question");
    }
    expect(structuredQuestion.bodyTypst).toBe(STRUCTURED_QUESTION_RECORD.bodyTypst);
    expect(structuredQuestion.imageAbsolutePath).toMatch(/^\//);
  });

  it("materializes per-alternative images and threads alternativeImagePaths, staying attached to the SAME alternative text regardless of shuffle position", async () => {
    const { service, repository, storage, pdfCompiler } = buildDeps();
    await storage.put("bank/alt-images/five", Buffer.from("fake-alt-5-png"), "image/png");
    await storage.put("bank/alt-images/seven", Buffer.from("fake-alt-7-png"), "image/png");

    const examWithAlternativeImages: ExamForGenerationRecord = {
      ...READY_EXAM,
      selectedQuestions: [
        ...READY_EXAM.selectedQuestions,
        {
          ...STRUCTURED_QUESTION_RECORD,
          alternativeImages: [
            { storageKey: "bank/alt-images/five", mime: "image/png" },
            null,
            { storageKey: "bank/alt-images/seven", mime: "image/png" },
          ],
        },
      ],
    };
    repository.getExamForGeneration.mockResolvedValue(examWithAlternativeImages);
    repository.createAsset.mockResolvedValue({ id: "asset-id" });

    const results = await service.generateVersions(TEACHER, "exam-1", 3);

    expect(results).toHaveLength(3);
    for (const examCall of pdfCompiler.examCalls) {
      const structuredQuestion = allQuestions(examCall).find((q) => q.id === "q3");
      expect(structuredQuestion?.type).toBe("structured");
      if (structuredQuestion?.type !== "structured") {
        throw new Error("expected q3 to render as a structured question");
      }

      expect(structuredQuestion.alternativeImagePaths).toHaveLength(3);

      // "5" and "7" (original indices 0 and 2) have images; "6" (index 1)
      // never had one — this must hold no matter where shuffling moved each
      // alternative's printed position.
      const indexOfFive = structuredQuestion.alternatives.indexOf("5");
      const indexOfSix = structuredQuestion.alternatives.indexOf("6");
      const indexOfSeven = structuredQuestion.alternatives.indexOf("7");

      expect(structuredQuestion.alternativeImagePaths?.[indexOfFive]).toMatch(/^\//);
      expect(structuredQuestion.alternativeImagePaths?.[indexOfSeven]).toMatch(/^\//);
      expect(structuredQuestion.alternativeImagePaths?.[indexOfSix]).toBeUndefined();
    }
  });

  describe("a question that does not compile", () => {
    /**
     * Wires the repository lookups the swap path needs: the failing question
     * belongs to blueprint row `row-1`, and the bank holds one healthy
     * candidate (`q9`) for that same row.
     */
    function wireSwappableBank(repository: jest.Mocked<ExamsRepository>) {
      repository.createAsset.mockResolvedValue({ id: "asset-id" });
      repository.findExamQuestion = jest
        .fn()
        .mockResolvedValue({ questionId: "q2", blueprintRowId: "row-1" });
      repository.getExamById = jest.fn().mockResolvedValue({ id: "exam-1", gradeLevel: "pre" });
      repository.getBlueprintRows = jest
        .fn()
        .mockResolvedValue([{ id: "row-1", courseId: "course-1", courseName: "Aritmética", count: 2 }]);
      repository.getQuestionPool = jest
        .fn()
        .mockResolvedValue([
          { id: "q9", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Medium },
        ]);
      repository.getSelectedQuestionIds = jest.fn().mockResolvedValue(["q1", "q2"]);
      repository.replaceQuestion = jest.fn().mockResolvedValue(undefined);
      repository.archiveQuestion = jest.fn().mockResolvedValue(undefined);
    }

    const HEALTHY_REPLACEMENT = {
      questionId: "q9",
      position: 1,
      type: "image" as const,
      correctAnswer: "a",
      imageStorageKey: "bank/questions/q9",
      imageMime: "image/png",
      bodyTypst: null,
      alternatives: null,
      figureCode: null,
    };

    it("swaps it for another question from the same blueprint row instead of failing the whole job", async () => {
      const { service, repository, storage, pdfCompiler } = buildDeps();
      void storage.put("bank/questions/q9", Buffer.from("fake-png-9"), "image/png");
      wireSwappableBank(repository);
      repository.getExamForGeneration.mockResolvedValueOnce(READY_EXAM).mockResolvedValue({
        ...READY_EXAM,
        selectedQuestions: [READY_EXAM.selectedQuestions[0]!, HEALTHY_REPLACEMENT],
      });
      jest
        .spyOn(pdfCompiler, "compileExam")
        .mockRejectedValueOnce(new TypstCompilationError("typst compile failed", "q2", "stderr contents"));

      const results = await service.generateVersions(TEACHER, "exam-1", 1);

      expect(results).toHaveLength(1);
      expect(repository.replaceQuestion).toHaveBeenCalledWith("exam-1", "q2", "q9");
    });

    it("archives it so it stops breaking every other exam that selects it", async () => {
      const { service, repository, storage, pdfCompiler } = buildDeps();
      void storage.put("bank/questions/q9", Buffer.from("fake-png-9"), "image/png");
      wireSwappableBank(repository);
      repository.getExamForGeneration.mockResolvedValueOnce(READY_EXAM).mockResolvedValue({
        ...READY_EXAM,
        selectedQuestions: [READY_EXAM.selectedQuestions[0]!, HEALTHY_REPLACEMENT],
      });
      jest
        .spyOn(pdfCompiler, "compileExam")
        .mockRejectedValueOnce(new TypstCompilationError("typst compile failed", "q2", "stderr contents"));

      await service.generateVersions(TEACHER, "exam-1", 1);

      expect(repository.archiveQuestion).toHaveBeenCalledWith("q2");
    });

    /**
     * Audit 2026-08-20 (L1): this was the one error path logged via bare
     * `console.error`, invisible to the structured pino stream — no queryable
     * examId/questionId fields. The original compile error must still win
     * (recovery is best-effort), but the recovery failure has to land in the
     * injected logger.
     */
    it("logs a swap-recovery failure through the structured logger and still surfaces the ORIGINAL compile error", async () => {
      const { service, repository, pdfCompiler, logger } = buildDeps();
      wireSwappableBank(repository);
      repository.archiveQuestion = jest.fn().mockRejectedValue(new Error("db down"));
      repository.getExamForGeneration.mockResolvedValue(READY_EXAM);
      jest
        .spyOn(pdfCompiler, "compileExam")
        .mockRejectedValue(new TypstCompilationError("typst compile failed", "q2", "stderr contents"));

      const promise = service.generateVersions(TEACHER, "exam-1", 1);

      await expect(promise).rejects.toBeInstanceOf(ExamPdfGenerationError);
      await expect(promise).rejects.toMatchObject({ questionId: "q2" });
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ examId: "exam-1", questionId: "q2", err: "db down" }),
        expect.stringContaining("could not swap"),
      );
    });

    it("still fails loudly when the blueprint row has no healthy question left to swap in", async () => {
      const { service, repository, pdfCompiler } = buildDeps();
      wireSwappableBank(repository);
      repository.getQuestionPool = jest.fn().mockResolvedValue([]);
      repository.getExamForGeneration.mockResolvedValue(READY_EXAM);
      jest
        .spyOn(pdfCompiler, "compileExam")
        .mockRejectedValue(new TypstCompilationError("typst compile failed", "q2", "stderr contents"));

      const promise = service.generateVersions(TEACHER, "exam-1", 1);

      await expect(promise).rejects.toBeInstanceOf(ExamPdfGenerationError);
      await expect(promise).rejects.toMatchObject({ examId: "exam-1", questionId: "q2" });
    });

    it("gives up rather than swapping forever when replacements keep failing", async () => {
      const { service, repository, storage, pdfCompiler } = buildDeps();
      void storage.put("bank/questions/q9", Buffer.from("fake-png-9"), "image/png");
      wireSwappableBank(repository);
      repository.getQuestionPool = jest.fn().mockResolvedValue(
        Array.from({ length: 20 }, (_unused, index) => ({
          id: `q-bad-${index}`,
          courseId: "course-1",
          topicId: "topic-1",
          difficulty: Difficulty.Medium,
        })),
      );
      repository.getExamForGeneration.mockResolvedValue(READY_EXAM);
      const compileExam = jest
        .spyOn(pdfCompiler, "compileExam")
        .mockRejectedValue(new TypstCompilationError("typst compile failed", "q2", "stderr contents"));

      await expect(service.generateVersions(TEACHER, "exam-1", 1)).rejects.toBeInstanceOf(
        ExamPdfGenerationError,
      );
      expect(compileExam.mock.calls.length).toBeLessThanOrEqual(5);
    });
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

  describe("idempotent regeneration (B4)", () => {
    it("calls clearVersions() AFTER auto-confirm and BEFORE buildVersions() on a regeneration, then best-effort deletes each returned storage key", async () => {
      const { service, repository, storage } = buildDeps();
      repository.getExamForGeneration.mockResolvedValue(READY_EXAM);
      repository.createAsset.mockResolvedValue({ id: "asset-id" });
      repository.clearVersions.mockResolvedValue([
        "exams/exam-1/versions/A/exam.pdf",
        "exams/exam-1/versions/A/answer-key.pdf",
      ]);
      await storage.put("exams/exam-1/versions/A/exam.pdf", Buffer.from("old-pdf"), "application/pdf");
      await storage.put(
        "exams/exam-1/versions/A/answer-key.pdf",
        Buffer.from("old-answer"),
        "application/pdf",
      );
      const deleteSpy = jest.spyOn(storage, "delete");

      await service.generateVersions(TEACHER, "exam-1", 2);

      expect(repository.clearVersions).toHaveBeenCalledWith("exam-1");
      expect(deleteSpy).toHaveBeenCalledWith("exams/exam-1/versions/A/exam.pdf");
      expect(deleteSpy).toHaveBeenCalledWith("exams/exam-1/versions/A/answer-key.pdf");
    });

    it("first-time generation (clearVersions returns []) skips every storage.delete call — no regression", async () => {
      const { service, repository, storage } = buildDeps();
      repository.getExamForGeneration.mockResolvedValue(READY_EXAM);
      repository.createAsset.mockResolvedValue({ id: "asset-id" });
      repository.clearVersions.mockResolvedValue([]);
      const deleteSpy = jest.spyOn(storage, "delete");

      await service.generateVersions(TEACHER, "exam-1", 1);

      expect(repository.clearVersions).toHaveBeenCalledWith("exam-1");
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("clearVersions() runs on a draft-with-questions exam too, AFTER the auto-confirm call", async () => {
      const { service, repository } = buildDeps();
      repository.getExamForGeneration.mockResolvedValue({ ...READY_EXAM, status: "draft" });
      repository.createAsset.mockResolvedValue({ id: "asset-id" });
      const callOrder: string[] = [];
      repository.confirmExam.mockImplementation(async () => {
        callOrder.push("confirmExam");
      });
      repository.clearVersions.mockImplementation(async () => {
        callOrder.push("clearVersions");
        return [];
      });

      await service.generateVersions(TEACHER, "exam-1", 1);

      expect(callOrder).toEqual(["confirmExam", "clearVersions"]);
    });
  });
});

describe("ExamVersionGenerationService.buildVersionsZip (N1)", () => {
  const STAFF: AuthTokenPayload = { sub: "staff-1", tenantId: null, role: Role.PlatformAdmin };

  it("rejects platform staff (no tenant) with 400 before touching the repository", async () => {
    const { service, repository } = buildDeps();

    await expect(service.buildVersionsZip(STAFF, "exam-1")).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.getVersionAssetRecords).not.toHaveBeenCalled();
  });

  it("rejects a missing/cross-tenant exam with 404 (getVersionAssetRecords -> undefined)", async () => {
    const { service, repository } = buildDeps();
    repository.getVersionAssetRecords.mockResolvedValue(undefined);

    await expect(service.buildVersionsZip(TEACHER, "exam-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects an exam with zero generated versions with 409 (nothing to download)", async () => {
    const { service, repository } = buildDeps();
    repository.getVersionAssetRecords.mockResolvedValue([]);

    await expect(service.buildVersionsZip(TEACHER, "exam-1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("bundles each version's exam PDF + answer sheet into one ZIP buffer, named by code", async () => {
    const { service, repository, storage } = buildDeps();
    await storage.put("exams/exam-1/versions/A/exam.pdf", Buffer.from("pdf-A"), "application/pdf");
    await storage.put("exams/exam-1/versions/A/answer-key.pdf", Buffer.from("key-A"), "application/pdf");
    await storage.put("exams/exam-1/versions/B/exam.pdf", Buffer.from("pdf-B"), "application/pdf");
    await storage.put("exams/exam-1/versions/B/answer-key.pdf", Buffer.from("key-B"), "application/pdf");
    repository.getVersionAssetRecords.mockResolvedValue([
      {
        code: "A",
        pdfStorageKey: "exams/exam-1/versions/A/exam.pdf",
        pdfMime: "application/pdf",
        answerSheetStorageKey: "exams/exam-1/versions/A/answer-key.pdf",
        answerSheetMime: "application/pdf",
      },
      {
        code: "B",
        pdfStorageKey: "exams/exam-1/versions/B/exam.pdf",
        pdfMime: "application/pdf",
        answerSheetStorageKey: "exams/exam-1/versions/B/answer-key.pdf",
        answerSheetMime: "application/pdf",
      },
    ]);

    const zip = await service.buildVersionsZip(TEACHER, "exam-1");

    // Valid ZIP local-file-header magic ("PK\x03\x04").
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
    // Filenames are stored uncompressed in the (level 0) local headers.
    for (const name of ["Examen-A.pdf", "Claves-A.pdf", "Examen-B.pdf", "Claves-B.pdf"]) {
      expect(zip.includes(Buffer.from(name))).toBe(true);
    }
  });

  it("maps a missing storage object to 404 (integrity fault, same as AssetsService)", async () => {
    const { service, repository } = buildDeps();
    repository.getVersionAssetRecords.mockResolvedValue([
      {
        code: "A",
        pdfStorageKey: "exams/exam-1/versions/A/does-not-exist.pdf",
        pdfMime: "application/pdf",
        answerSheetStorageKey: "exams/exam-1/versions/A/answer-key.pdf",
        answerSheetMime: "application/pdf",
      },
    ]);

    await expect(service.buildVersionsZip(TEACHER, "exam-1")).rejects.toBeInstanceOf(NotFoundException);
  });
});
