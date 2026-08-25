import { Difficulty, Role } from "@exams-generator/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { createSeededRng } from "./domain/ports/random.port";
import { AuthTokenPayload } from "../auth/token.service";
import { BlueprintRowRecord, ExamsRepository, QuestionPoolCandidateRecord } from "./exams.repository";
import { ExamsService, InsufficientQuestionStockError } from "./exams.service";

const TEACHER: AuthTokenPayload = { sub: "teacher-1", tenantId: "tenant-1", role: Role.Teacher };
const STAFF: AuthTokenPayload = { sub: "staff-1", tenantId: null, role: Role.ContentEditor };

function buildDeps() {
  const repository = {
    createExam: jest.fn(),
    getExamById: jest.fn(),
    getExamDetail: jest.fn(),
    getBlueprintRows: jest.fn(),
    getQuestionPool: jest.fn(),
    countStock: jest.fn(),
    saveSelection: jest.fn().mockResolvedValue(undefined),
    getSelectedQuestionIds: jest.fn(),
    findExamQuestion: jest.fn(),
    replaceQuestion: jest.fn().mockResolvedValue(undefined),
    confirmExam: jest.fn().mockResolvedValue(undefined),
    getVersions: jest.fn(),
    findExamType: jest.fn(),
    findCurrentTemplate: jest.fn(),
    getTemplateRows: jest.fn(),
    getSyllabusForTemplate: jest.fn(),
    getTopicsForCourses: jest.fn().mockResolvedValue([]),
    findActiveCycle: jest.fn(),
  } as unknown as jest.Mocked<ExamsRepository>;

  const service = new ExamsService(repository, () => createSeededRng(1));
  return { service, repository };
}

const ROW: BlueprintRowRecord = {
  id: "row-1",
  courseId: "course-1",
  courseName: "Aritmética",
  topicId: undefined,
  topicName: undefined,
  difficulty: Difficulty.Easy,
  count: 2,
};

const POOL: QuestionPoolCandidateRecord[] = [
  { id: "q1", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy },
  { id: "q2", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy },
  { id: "q3", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy },
];

/**
 * Layout defaults for a template row that carries none — mirrors the helper in
 * `resolve-blueprint.spec.ts`. Spread into an expected blueprint row so these
 * assertions keep using exact `toEqual` instead of being weakened to
 * `toMatchObject`, which would stop catching an unexpected extra field.
 */
const noLayout = (sortOrder: number) => ({
  sortOrder,
  blockCode: null,
  blockLabel: null,
  sectionCode: null,
  sectionLabel: null,
});

describe("ExamsService.createExam", () => {
  it("rejects platform staff (no tenant) — exams always belong to a tenant", async () => {
    const { service } = buildDeps();

    await expect(
      service.createExam(STAFF, {
        title: "X",
        gradeLevel: "primaria_1",
        blueprint: [{ courseId: "c1", count: 1 }],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects invalid input with BadRequestException before touching the repository", async () => {
    const { service, repository } = buildDeps();

    await expect(
      service.createExam(TEACHER, { title: undefined, gradeLevel: undefined, blueprint: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createExam).not.toHaveBeenCalled();
  });

  it("creates the exam, builds the pool scoped to the caller's tenant, and saves the selection when stock is sufficient", async () => {
    const { service, repository } = buildDeps();
    repository.createExam.mockResolvedValue({ id: "exam-1" });
    repository.getBlueprintRows.mockResolvedValue([ROW]);
    repository.getQuestionPool.mockResolvedValue(POOL);

    const result = await service.createExam(TEACHER, {
      title: "Simulacro",
      gradeLevel: "primaria_1",
      blueprint: [{ courseId: "course-1", difficulty: Difficulty.Easy, count: 2 }],
    });

    expect(repository.createExam).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", createdBy: "teacher-1", gradeLevel: "primaria_1" }),
    );
    expect(repository.getQuestionPool).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      gradeLevel: "primaria_1",
    });
    expect(repository.saveSelection).toHaveBeenCalledTimes(1);
    const [, savedSelections] = repository.saveSelection.mock.calls[0]!;
    expect(savedSelections).toHaveLength(2);
    expect(savedSelections.every((s: { blueprintRowId: string }) => s.blueprintRowId === "row-1")).toBe(true);
    expect(result).toEqual({ id: "exam-1", status: "draft", selectedQuestionIds: expect.any(Array) });
    expect(result.selectedQuestionIds).toHaveLength(2);
  });

  it("throws InsufficientQuestionStockError naming the short row and does NOT save any selection", async () => {
    const { service, repository } = buildDeps();
    repository.createExam.mockResolvedValue({ id: "exam-2" });
    repository.getBlueprintRows.mockResolvedValue([{ ...ROW, count: 5 }]);
    repository.getQuestionPool.mockResolvedValue(POOL); // only 3 available, row wants 5

    const promise = service.createExam(TEACHER, {
      title: "Simulacro",
      gradeLevel: "primaria_1",
      blueprint: [{ courseId: "course-1", difficulty: Difficulty.Easy, count: 5 }],
    });

    await expect(promise).rejects.toBeInstanceOf(InsufficientQuestionStockError);
    await expect(promise).rejects.toMatchObject({
      examId: "exam-2",
      shortages: [
        expect.objectContaining({
          courseId: "course-1",
          courseName: "Aritmética",
          requested: 5,
          available: 3,
        }),
      ],
    });
    expect(repository.saveSelection).not.toHaveBeenCalled();
  });
});

describe("ExamsService.replaceQuestion", () => {
  it("rejects when the exam does not exist or belongs to another tenant", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue(undefined);

    await expect(service.replaceQuestion(TEACHER, "exam-1", "q1", { mode: "reroll" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rejects when the exam is already confirmed (status=ready) — selection is locked", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue({
      id: "exam-1",
      tenantId: "tenant-1",
      title: "X",
      gradeLevel: "primaria_1",
      status: "ready",
      createdBy: "teacher-1",
    });

    await expect(service.replaceQuestion(TEACHER, "exam-1", "q1", { mode: "reroll" })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("rejects when the question is not part of the exam's current selection", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue({
      id: "exam-1",
      tenantId: "tenant-1",
      title: "X",
      gradeLevel: "primaria_1",
      status: "draft",
      createdBy: "teacher-1",
    });
    repository.findExamQuestion.mockResolvedValue(undefined);

    await expect(
      service.replaceQuestion(TEACHER, "exam-1", "q-not-selected", { mode: "reroll" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("reroll: picks another matching, unused candidate and persists the swap", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue({
      id: "exam-1",
      tenantId: "tenant-1",
      title: "X",
      gradeLevel: "primaria_1",
      status: "draft",
      createdBy: "teacher-1",
    });
    repository.findExamQuestion.mockResolvedValue({ blueprintRowId: "row-1", position: 0 });
    repository.getBlueprintRows.mockResolvedValue([ROW]);
    repository.getQuestionPool.mockResolvedValue(POOL);
    repository.getSelectedQuestionIds.mockResolvedValue(["q1"]);

    const result = await service.replaceQuestion(TEACHER, "exam-1", "q1", { mode: "reroll" });

    expect(repository.replaceQuestion).toHaveBeenCalledWith("exam-1", "q1", expect.stringMatching(/^q[23]$/));
    expect(result.newQuestionId).not.toBe("q1");
  });

  it("reroll: throws when no alternative candidate is available", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue({
      id: "exam-1",
      tenantId: "tenant-1",
      title: "X",
      gradeLevel: "primaria_1",
      status: "draft",
      createdBy: "teacher-1",
    });
    repository.findExamQuestion.mockResolvedValue({ blueprintRowId: "row-1", position: 0 });
    repository.getBlueprintRows.mockResolvedValue([ROW]);
    repository.getQuestionPool.mockResolvedValue([POOL[0]!]); // only the currently-selected one matches
    repository.getSelectedQuestionIds.mockResolvedValue(["q1"]);

    await expect(service.replaceQuestion(TEACHER, "exam-1", "q1", { mode: "reroll" })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.replaceQuestion).not.toHaveBeenCalled();
  });

  it("manual: accepts a caller-specified replacement that matches the row's criteria and isn't already used", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue({
      id: "exam-1",
      tenantId: "tenant-1",
      title: "X",
      gradeLevel: "primaria_1",
      status: "draft",
      createdBy: "teacher-1",
    });
    repository.findExamQuestion.mockResolvedValue({ blueprintRowId: "row-1", position: 0 });
    repository.getBlueprintRows.mockResolvedValue([ROW]);
    repository.getQuestionPool.mockResolvedValue(POOL);
    repository.getSelectedQuestionIds.mockResolvedValue(["q1"]);

    const result = await service.replaceQuestion(TEACHER, "exam-1", "q1", {
      mode: "manual",
      replacementQuestionId: "q2",
    });

    expect(repository.replaceQuestion).toHaveBeenCalledWith("exam-1", "q1", "q2");
    expect(result.newQuestionId).toBe("q2");
  });

  it("manual: rejects a replacement that doesn't match the row's criteria", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue({
      id: "exam-1",
      tenantId: "tenant-1",
      title: "X",
      gradeLevel: "primaria_1",
      status: "draft",
      createdBy: "teacher-1",
    });
    repository.findExamQuestion.mockResolvedValue({ blueprintRowId: "row-1", position: 0 });
    repository.getBlueprintRows.mockResolvedValue([ROW]);
    repository.getQuestionPool.mockResolvedValue([
      ...POOL,
      { id: "q-wrong-course", courseId: "course-2", topicId: "topic-1", difficulty: Difficulty.Easy },
    ]);
    repository.getSelectedQuestionIds.mockResolvedValue(["q1"]);

    await expect(
      service.replaceQuestion(TEACHER, "exam-1", "q1", {
        mode: "manual",
        replacementQuestionId: "q-wrong-course",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.replaceQuestion).not.toHaveBeenCalled();
  });

  it("manual: rejects a replacement that is already used elsewhere in the exam", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue({
      id: "exam-1",
      tenantId: "tenant-1",
      title: "X",
      gradeLevel: "primaria_1",
      status: "draft",
      createdBy: "teacher-1",
    });
    repository.findExamQuestion.mockResolvedValue({ blueprintRowId: "row-1", position: 0 });
    repository.getBlueprintRows.mockResolvedValue([ROW]);
    repository.getQuestionPool.mockResolvedValue(POOL);
    repository.getSelectedQuestionIds.mockResolvedValue(["q1", "q2"]);

    await expect(
      service.replaceQuestion(TEACHER, "exam-1", "q1", { mode: "manual", replacementQuestionId: "q2" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.replaceQuestion).not.toHaveBeenCalled();
  });
});

describe("ExamsService.getExamDetail", () => {
  it("rejects platform staff (no tenant) — exams always belong to a tenant", async () => {
    const { service } = buildDeps();

    await expect(service.getExamDetail(STAFF, "exam-1")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects when the exam does not exist or belongs to another tenant", async () => {
    const { service, repository } = buildDeps();
    repository.getExamDetail.mockResolvedValue(undefined);

    await expect(service.getExamDetail(TEACHER, "exam-1")).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.getExamDetail).toHaveBeenCalledWith("exam-1", "tenant-1");
  });

  it("returns the exam header + its selected questions for the owning tenant", async () => {
    const { service, repository } = buildDeps();
    repository.getExamDetail.mockResolvedValue({
      id: "exam-1",
      title: "Simulacro",
      gradeLevel: "primaria_1",
      status: "draft",
      questions: [
        {
          id: "q1",
          position: 0,
          type: "image",
          courseId: "course-1",
          courseName: "Aritmética",
          topicId: "topic-1",
          topicName: "Teoría de conjuntos",
          difficulty: Difficulty.Easy,
          correctAnswer: "a",
          imageAssetId: "asset-1",
          bodyTypst: null,
          alternatives: null,
          figureCode: null,
        },
      ],
    });

    const result = await service.getExamDetail(TEACHER, "exam-1");

    expect(result).toEqual({
      id: "exam-1",
      title: "Simulacro",
      gradeLevel: "primaria_1",
      status: "draft",
      questions: [expect.objectContaining({ id: "q1", position: 0, type: "image", imageAssetId: "asset-1" })],
    });
  });
});

describe("ExamsService.confirmExam", () => {
  it("rejects when the exam does not exist or belongs to another tenant", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue(undefined);

    await expect(service.confirmExam(TEACHER, "exam-1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("rejects when the exam has no selected questions yet", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue({
      id: "exam-1",
      tenantId: "tenant-1",
      title: "X",
      gradeLevel: "primaria_1",
      status: "draft",
      createdBy: "teacher-1",
    });
    repository.getSelectedQuestionIds.mockResolvedValue([]);

    await expect(service.confirmExam(TEACHER, "exam-1")).rejects.toBeInstanceOf(ConflictException);
    expect(repository.confirmExam).not.toHaveBeenCalled();
  });

  it("rejects when the exam is already ready", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue({
      id: "exam-1",
      tenantId: "tenant-1",
      title: "X",
      gradeLevel: "primaria_1",
      status: "ready",
      createdBy: "teacher-1",
    });
    repository.getSelectedQuestionIds.mockResolvedValue(["q1"]);

    await expect(service.confirmExam(TEACHER, "exam-1")).rejects.toBeInstanceOf(ConflictException);
    expect(repository.confirmExam).not.toHaveBeenCalled();
  });

  it("confirms a draft exam with a non-empty selection", async () => {
    const { service, repository } = buildDeps();
    repository.getExamById.mockResolvedValue({
      id: "exam-1",
      tenantId: "tenant-1",
      title: "X",
      gradeLevel: "primaria_1",
      status: "draft",
      createdBy: "teacher-1",
    });
    repository.getSelectedQuestionIds.mockResolvedValue(["q1", "q2"]);

    const result = await service.confirmExam(TEACHER, "exam-1");

    expect(repository.confirmExam).toHaveBeenCalledWith("exam-1");
    expect(result).toEqual({ id: "exam-1", status: "ready" });
  });
});

describe("ExamsService.countStock (B1)", () => {
  it("rejects platform staff (no tenant) with 403, before touching the repository", async () => {
    const { service, repository } = buildDeps();

    await expect(
      service.countStock(STAFF, { gradeLevel: "primaria_1", cells: [{ courseId: "c1" }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.countStock).not.toHaveBeenCalled();
  });

  it("rejects an invalid gradeLevel with 400, before touching the repository", async () => {
    const { service, repository } = buildDeps();

    await expect(
      service.countStock(TEACHER, { gradeLevel: "not-a-real-grade", cells: [{ courseId: "c1" }] }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.countStock).not.toHaveBeenCalled();
  });

  it("rejects a missing/empty cells array with 400", async () => {
    const { service, repository } = buildDeps();

    await expect(service.countStock(TEACHER, { gradeLevel: "primaria_1", cells: [] })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(repository.countStock).not.toHaveBeenCalled();
  });

  it("rejects with 400 naming the offending cell index when courseId is missing", async () => {
    const { service, repository } = buildDeps();

    let caught: BadRequestException | undefined;
    try {
      await service.countStock(TEACHER, {
        gradeLevel: "primaria_1",
        cells: [{ courseId: "c1" }, { courseId: undefined }],
      });
    } catch (error) {
      caught = error as BadRequestException;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect(caught?.getResponse()).toMatchObject({
      message: expect.arrayContaining([expect.stringContaining("cells[1].courseId")]),
    });
    expect(repository.countStock).not.toHaveBeenCalled();
  });

  it("rejects an invalid difficulty with 400", async () => {
    const { service, repository } = buildDeps();

    await expect(
      service.countStock(TEACHER, {
        gradeLevel: "primaria_1",
        cells: [{ courseId: "c1", difficulty: "impossible" }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.countStock).not.toHaveBeenCalled();
  });

  it("delegates to repository.countStock() on valid input and returns order-matched results", async () => {
    const { service, repository } = buildDeps();
    repository.countStock.mockResolvedValue([20, 0]);

    const result = await service.countStock(TEACHER, {
      gradeLevel: "secundaria_1",
      cells: [
        { courseId: "course-1", difficulty: "easy" },
        { courseId: "course-1", topicId: "topic-1", difficulty: "hard" },
      ],
    });

    expect(repository.countStock).toHaveBeenCalledWith({ tenantId: "tenant-1", gradeLevel: "secundaria_1" }, [
      { courseId: "course-1", topicId: undefined, difficulty: "easy" },
      { courseId: "course-1", topicId: "topic-1", difficulty: "hard" },
    ]);
    expect(result).toEqual({
      results: [
        { courseId: "course-1", topicId: undefined, difficulty: "easy", available: 20 },
        { courseId: "course-1", topicId: "topic-1", difficulty: "hard", available: 0 },
      ],
    });
  });
});

describe("ExamsService.previewExam (B2)", () => {
  it("rejects platform staff (no tenant) with 403, before touching the repository", async () => {
    const { service, repository } = buildDeps();

    await expect(
      service.previewExam(STAFF, { gradeLevel: "primaria_1", blueprint: [{ courseId: "c1", count: 1 }] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.getQuestionPool).not.toHaveBeenCalled();
  });

  it("rejects invalid input (no title required, unlike createExam) with 400, before touching the repository", async () => {
    const { service, repository } = buildDeps();

    await expect(
      service.previewExam(TEACHER, { gradeLevel: undefined, blueprint: undefined }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.getQuestionPool).not.toHaveBeenCalled();

    // No title field at all in the DTO -- still valid input, proving title is genuinely not required.
    repository.getQuestionPool.mockResolvedValue(POOL);
    const result = await service.previewExam(TEACHER, {
      gradeLevel: "primaria_1",
      blueprint: [{ courseId: "course-1", difficulty: Difficulty.Easy, count: 1 }],
    });
    expect(result.shortages).toEqual([]);
  });

  it("exact-fill row: deterministic full-pool selection, matches the seeded rng", async () => {
    const { service, repository } = buildDeps();
    const exactPool: QuestionPoolCandidateRecord[] = [
      { id: "q1", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy },
    ];
    repository.getQuestionPool.mockResolvedValue(exactPool);

    const result = await service.previewExam(TEACHER, {
      gradeLevel: "primaria_1",
      blueprint: [{ courseId: "course-1", difficulty: Difficulty.Easy, count: 2 }],
    });

    expect(result.shortages).toEqual([]);
    expect(result.selections).toHaveLength(1);
    expect([...result.selections[0]!.questionIds].sort()).toEqual(["q1", "q2"]);
  });

  it("shortage row: partial fill with all available ids + a shortages entry, still 200-shaped (no throw)", async () => {
    const { service, repository } = buildDeps();
    repository.getQuestionPool.mockResolvedValue(POOL); // 3 available

    const result = await service.previewExam(TEACHER, {
      gradeLevel: "primaria_1",
      blueprint: [{ courseId: "course-1", difficulty: Difficulty.Easy, count: 10 }],
    });

    expect(result.shortages).toHaveLength(1);
    expect(result.shortages[0]).toMatchObject({ rowIndex: 0, requested: 10, available: 3 });
    expect([...result.selections[0]!.questionIds].sort()).toEqual(["q1", "q2", "q3"]);
  });

  it("over-supplied row: questionIds.length === count and every id is a subset of the pool (never asserts exact ids)", async () => {
    const { service, repository } = buildDeps();
    const bigPool: QuestionPoolCandidateRecord[] = [
      { id: "q1", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy },
      { id: "q2", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy },
      { id: "q3", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy },
      { id: "q4", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy },
      { id: "q5", courseId: "course-1", topicId: "topic-1", difficulty: Difficulty.Easy },
    ];
    repository.getQuestionPool.mockResolvedValue(bigPool);

    const result = await service.previewExam(TEACHER, {
      gradeLevel: "primaria_1",
      blueprint: [{ courseId: "course-1", difficulty: Difficulty.Easy, count: 2 }],
    });

    expect(result.shortages).toEqual([]);
    expect(result.selections[0]!.questionIds).toHaveLength(2);
    for (const id of result.selections[0]!.questionIds) {
      expect(bigPool.map((c) => c.id)).toContain(id);
    }
  });

  it("does NOT persist anything — no createExam/getBlueprintRows/saveSelection calls (B2-R2)", async () => {
    const { service, repository } = buildDeps();
    repository.getQuestionPool.mockResolvedValue(POOL);

    await service.previewExam(TEACHER, {
      gradeLevel: "primaria_1",
      blueprint: [{ courseId: "course-1", difficulty: Difficulty.Easy, count: 2 }],
    });

    expect(repository.createExam).not.toHaveBeenCalled();
    expect(repository.getBlueprintRows).not.toHaveBeenCalled();
    expect(repository.saveSelection).not.toHaveBeenCalled();
  });
});

describe("ExamsService.listVersions (B4)", () => {
  it("rejects platform staff (no tenant) with 403", async () => {
    const { service } = buildDeps();

    await expect(service.listVersions(STAFF, "exam-1")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects with 404 for a missing/cross-tenant exam — never leaks existence", async () => {
    const { service, repository } = buildDeps();
    repository.getVersions.mockResolvedValue(undefined);

    await expect(service.listVersions(TEACHER, "exam-1")).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.getVersions).toHaveBeenCalledWith("exam-1", "tenant-1");
  });

  it("delegates to repository.getVersions() and returns its result", async () => {
    const { service, repository } = buildDeps();
    const versions = [{ code: "A", pdfUrl: "/assets/x", answerSheetUrl: "/assets/y" }];
    repository.getVersions.mockResolvedValue(versions);

    const result = await service.listVersions(TEACHER, "exam-1");

    expect(result).toEqual(versions);
  });
});

/**
 * The Fase 4 wiring orchestrator (design doc §7.4/§5): looks up the exam
 * type's `course_scope`/`week_scope`, resolves the current template (and, for
 * week-scoped types, the active cycle's `currentWeek`), then delegates to the
 * pure `resolveBlueprint()` domain function. Every dependency is mocked —
 * this suite never touches Postgres.
 */
describe("ExamsService.resolveExamBlueprint", () => {
  it("returns an empty blueprint immediately for course_scope='none' (manual) — never touches templates/cycles", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "none", weekScope: "none" });

    const result = await service.resolveExamBlueprint({
      examTypeCode: "manual",
      universityId: "uni-1",
      trackId: null,
      tenantId: "tenant-1",
    });

    expect(result).toEqual({
      blueprint: [],
      weekNumber: null,
      templateId: null,
      usedCumulativeFallback: false,
      // No template at all, so nothing published counts.
      countsFromTemplate: false,
      effectiveWeekNumber: null,
    });
    expect(repository.findCurrentTemplate).not.toHaveBeenCalled();
    expect(repository.findActiveCycle).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when the exam type code doesn't exist in the catalog", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue(null);

    await expect(
      service.resolveExamBlueprint({
        examTypeCode: "not-a-real-type",
        universityId: "uni-1",
        trackId: null,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws NotFoundException when no current template exists for the (university, track) pair — never falls back to a default", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "none" });
    repository.findCurrentTemplate.mockResolvedValue(null);

    await expect(
      service.resolveExamBlueprint({
        examTypeCode: "eta",
        universityId: "uni-1",
        trackId: null,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.getTemplateRows).not.toHaveBeenCalled();
  });

  it("resolves a week_scope='none' type (eta) without ever calling findActiveCycle, and weekNumber stays null", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "none" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 5 }]);
    repository.getSyllabusForTemplate.mockResolvedValue([]);

    const result = await service.resolveExamBlueprint({
      examTypeCode: "eta",
      universityId: "uni-1",
      trackId: null,
      tenantId: "tenant-1",
    });

    expect(repository.findActiveCycle).not.toHaveBeenCalled();
    expect(result.weekNumber).toBeNull();
    expect(result.templateId).toBe("template-1");
    expect(result.blueprint).toEqual([{ courseId: "course-1", count: 5, difficulty: undefined, ...noLayout(0) }]);
  });

  it("pre-selects each course's topics for a week_scope='none' type, asking only for the in-scope courses", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "selected", weekScope: "none" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([
      { courseId: "course-1", questionCount: 4 },
      { courseId: "course-2", questionCount: 9 },
    ]);
    repository.getSyllabusForTemplate.mockResolvedValue([]);
    repository.getTopicsForCourses.mockResolvedValue([
      { courseId: "course-1", topicId: "topic-a" },
      { courseId: "course-1", topicId: "topic-b" },
    ]);

    const result = await service.resolveExamBlueprint({
      examTypeCode: "eta",
      universityId: "uni-1",
      trackId: null,
      tenantId: "tenant-1",
      selectedCourseIds: ["course-1"],
    });

    expect(repository.getTopicsForCourses).toHaveBeenCalledWith(["course-1"], "pre");
    expect(result.blueprint).toEqual([
      { courseId: "course-1", topicId: "topic-a", count: 2, difficulty: undefined, ...noLayout(0) },
      { courseId: "course-1", topicId: "topic-b", count: 2, difficulty: undefined, ...noLayout(0) },
    ]);
  });

  it("never asks for the topic catalog when the week scope already expands by syllabus", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "cumulative" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 4 }]);
    repository.getSyllabusForTemplate.mockResolvedValue([
      { courseId: "course-1", topicId: "topic-a", weekNumber: 0 },
    ]);
    repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-03-05"), weekLengthDays: 7 });

    await service.resolveExamBlueprint({
      examTypeCode: "eta_by_week",
      universityId: "uni-1",
      trackId: null,
      tenantId: "tenant-1",
    });

    expect(repository.getTopicsForCourses).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when week_scope != 'none' and no active cycle is found — never silently defaults to week 0", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "cumulative" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([]);
    repository.getSyllabusForTemplate.mockResolvedValue([]);
    repository.findActiveCycle.mockResolvedValue(null);

    await expect(
      service.resolveExamBlueprint({
        examTypeCode: "eta_by_week",
        universityId: "uni-1",
        trackId: null,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws BadRequestException when the active cycle has an invalid weekLengthDays (<= 0) — loud, never a silent empty blueprint", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "cumulative" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 4 }]);
    repository.getSyllabusForTemplate.mockResolvedValue([]);
    // Bad server-side data: computeCurrentWeek would divide by zero and
    // return Infinity, which resolveBlueprint then turns into "no topics".
    repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-03-05"), weekLengthDays: 0 });

    await expect(
      service.resolveExamBlueprint({
        examTypeCode: "eta_by_week",
        universityId: "uni-1",
        trackId: null,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("computes weekNumber from the active cycle via computeCurrentWeek() and threads it into resolveBlueprint (week_scope='cumulative')", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "cumulative" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 4 }]);
    repository.getSyllabusForTemplate.mockResolvedValue([
      { courseId: "course-1", topicId: "topic-1", weekNumber: 0 },
      { courseId: "course-1", topicId: "topic-2", weekNumber: 1 },
    ]);
    repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-03-05"), weekLengthDays: 7 });

    jest.useFakeTimers().setSystemTime(new Date("2026-03-12")); // exactly one week after startsOn -> week 1
    try {
      const result = await service.resolveExamBlueprint({
        examTypeCode: "eta_by_week",
        universityId: "uni-1",
        trackId: null,
        tenantId: "tenant-1",
      });

      expect(result.weekNumber).toBe(1);
      expect(result.templateId).toBe("template-1");
      // week 1 is cumulative (weeks 0..1) -> both syllabus topics are in scope, sharing the row's 4 questions.
      expect(result.blueprint.reduce((sum, row) => sum + row.count, 0)).toBe(4);
    } finally {
      jest.useRealTimers();
    }
  });

  it("threads selectedCourseIds/totalQuestionsOverride through to the resolver for course_scope='selected' (fastest)", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "selected", weekScope: "current_only" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([
      { courseId: "course-1", weightPoints: 100 },
      { courseId: "course-2", weightPoints: 100 },
    ]);
    repository.getSyllabusForTemplate.mockResolvedValue([
      { courseId: "course-1", topicId: "topic-1", weekNumber: 0 },
    ]);
    repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-03-05"), weekLengthDays: 7 });

    jest.useFakeTimers().setSystemTime(new Date("2026-03-05")); // week 0
    try {
      const result = await service.resolveExamBlueprint({
        examTypeCode: "fastest",
        universityId: "uni-1",
        trackId: "track-1",
        tenantId: "tenant-1",
        selectedCourseIds: ["course-1"],
        totalQuestionsOverride: 10,
      });

      // course-2 was never selected, so its row must be filtered out entirely, not just zero-counted.
      expect(result.blueprint.every((row) => row.courseId === "course-1")).toBe(true);
      expect(result.blueprint.reduce((sum, row) => sum + row.count, 0)).toBe(10);
    } finally {
      jest.useRealTimers();
    }
  });

  it("resolves templateId/weekNumber correctly and calls findCurrentTemplate/findActiveCycle with the exact (universityId, trackId, tenantId) triple given", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "current_only" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-9" });
    repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 5 }]);
    // Week 0 is always `<= currentWeek` regardless of "today", so the
    // cumulative fallback always finds it — the blueprint stays non-empty no
    // matter which real calendar week this test runs on (this test isn't
    // about that behavior, just about the call-argument threading below).
    repository.getSyllabusForTemplate.mockResolvedValue([
      { courseId: "course-1", topicId: "topic-1", weekNumber: 0 },
    ]);
    repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-01-01"), weekLengthDays: 7 });

    await service.resolveExamBlueprint({
      examTypeCode: "eta",
      universityId: "uni-42",
      trackId: "track-7",
      tenantId: "tenant-3",
    });

    expect(repository.findCurrentTemplate).toHaveBeenCalledWith("uni-42", "track-7", "tenant-3");
    expect(repository.findActiveCycle).toHaveBeenCalledWith("uni-42", "track-7", "tenant-3");
  });

  it("throws BadRequestException when an in-scope row has no questionCount and no totalQuestionsOverride is given (UNI rows only carry weightPoints)", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "none" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", weightPoints: 100 }]);
    repository.getSyllabusForTemplate.mockResolvedValue([]);

    await expect(
      service.resolveExamBlueprint({
        examTypeCode: "eta",
        universityId: "uni-1",
        trackId: null,
        tenantId: "tenant-1",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    let caught: BadRequestException | undefined;
    try {
      await service.resolveExamBlueprint({
        examTypeCode: "eta",
        universityId: "uni-1",
        trackId: null,
        tenantId: "tenant-1",
      });
    } catch (error) {
      caught = error as BadRequestException;
    }
    expect(caught?.message).toBe(
      "Esta plantilla no tiene conteo de preguntas por curso — indica un total de preguntas.",
    );
  });

  it("says the counts came from the TEMPLATE when every row publishes its own", async () => {
    // The teacher's total is ignored in this case, and the UI has to explain
    // WHY. Guessing from the numbers gets it wrong: it looks like a rounding
    // remainder and is not one (audit 2026-08-23, seen live on UNCP área I —
    // asking for 60 and for 200 both return the template's 80).
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "none" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([
      { courseId: "course-1", questionCount: 5 },
      { courseId: "course-2", questionCount: 3 },
    ]);
    repository.getSyllabusForTemplate.mockResolvedValue([]);

    const result = await service.resolveExamBlueprint({
      examTypeCode: "eta",
      universityId: "uni-1",
      trackId: null,
      tenantId: "tenant-1",
      totalQuestionsOverride: 60,
    });

    expect(result.countsFromTemplate).toBe(true);
  });

  it("says the counts came from the requested TOTAL when the template publishes none", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "none" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([
      { courseId: "course-1", weightPoints: 100 },
      { courseId: "course-2", weightPoints: 100 },
    ]);
    repository.getSyllabusForTemplate.mockResolvedValue([]);

    const result = await service.resolveExamBlueprint({
      examTypeCode: "eta",
      universityId: "uni-1",
      trackId: null,
      tenantId: "tenant-1",
      totalQuestionsOverride: 60,
    });

    expect(result.countsFromTemplate).toBe(false);
  });

  it("does not throw when courseScope='selected' and the only row lacking questionCount is excluded by selectedCourseIds — exclusion happens before the check", async () => {
    const { service, repository } = buildDeps();
    repository.findExamType.mockResolvedValue({ courseScope: "selected", weekScope: "none" });
    repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
    repository.getTemplateRows.mockResolvedValue([
      { courseId: "course-1", questionCount: 5 },
      { courseId: "course-2", weightPoints: 100 }, // missing questionCount, but not selected below
    ]);
    repository.getSyllabusForTemplate.mockResolvedValue([]);

    const result = await service.resolveExamBlueprint({
      examTypeCode: "fastest",
      universityId: "uni-1",
      trackId: null,
      tenantId: "tenant-1",
      selectedCourseIds: ["course-1"],
    });

    expect(result.blueprint).toEqual([{ courseId: "course-1", count: 5, difficulty: undefined, ...noLayout(0) }]);
  });

  // --- P0 fix: "Rápido (semana actual)" produced a silent empty exam once
  // the cycle's calendar-computed week ran past the last week the syllabus
  // has real data for (docs/audit-2026-08-14.md — UNI's "Ciclo
  // Preuniversitario" reaches week 23 while syllabus_week_maps only covers
  // 0-20). Product decision: fall back to cumulative ("everything seen so
  // far") and say so in the response — never a silent empty 200, and never a
  // hard error just because the syllabus stopped early.
  describe("current_only past the loaded syllabus (P0: was a silent empty exam)", () => {
    it("falls back to cumulative and reports it via usedCumulativeFallback when currentWeek has no exact syllabus match but earlier weeks do", async () => {
      const { service, repository } = buildDeps();
      repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "current_only" });
      repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
      repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 12 }]);
      // Syllabus only covers weeks 0-2 — the real UNI shape covers 0-20, but
      // the boundary behavior is identical either way.
      repository.getSyllabusForTemplate.mockResolvedValue([
        { courseId: "course-1", topicId: "topic-0", weekNumber: 0 },
        { courseId: "course-1", topicId: "topic-1", weekNumber: 1 },
        { courseId: "course-1", topicId: "topic-2", weekNumber: 2 },
      ]);
      repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-03-05"), weekLengthDays: 7 });

      jest.useFakeTimers().setSystemTime(new Date("2026-08-14")); // ~week 23 — past the syllabus
      try {
        const result = await service.resolveExamBlueprint({
          examTypeCode: "fastest",
          universityId: "uni-1",
          trackId: null,
          tenantId: "tenant-1",
        });

        expect(result.weekNumber).toBeGreaterThan(2);
        expect(result.blueprint).toHaveLength(3); // every topic the syllabus has, not empty
        expect(result.blueprint.reduce((sum, row) => sum + row.count, 0)).toBe(12); // course total unchanged
        expect(result.usedCumulativeFallback).toBe(true);
        // The refinement (docs/audit-2026-08-14.md, same item): the exam must
        // report the last week that actually HAS syllabus data (2), not the
        // calendar week (23) nobody taught — `weekNumber` keeps the calendar
        // snapshot (provenance contract, see ResolveExamBlueprintResult
        // docstring) while `effectiveWeekNumber` names the truth.
        expect(result.effectiveWeekNumber).toBe(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it("does NOT throw for courseScope='selected' with zero selectedCourseIds — the exam builder auto-fires this call before any course checkbox is ticked (found via live-app verification, not the test suite)", async () => {
      const { service, repository } = buildDeps();
      repository.findExamType.mockResolvedValue({ courseScope: "selected", weekScope: "current_only" });
      repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
      repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 12 }]);
      repository.getSyllabusForTemplate.mockResolvedValue([]);
      repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-03-05"), weekLengthDays: 7 });

      jest.useFakeTimers().setSystemTime(new Date("2026-08-14"));
      try {
        const result = await service.resolveExamBlueprint({
          examTypeCode: "fastest",
          universityId: "uni-1",
          trackId: "track-1",
          tenantId: "tenant-1",
          // no selectedCourseIds at all — same shape the exam builder sends
          // right after picking a track, before the user checks a course.
        });

        expect(result.blueprint).toEqual([]);
        expect(result.usedCumulativeFallback).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });

    it("throws BadRequestException instead of returning a silent empty blueprint when the syllabus has zero rows at all for this template", async () => {
      const { service, repository } = buildDeps();
      repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "current_only" });
      repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
      repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 12 }]);
      repository.getSyllabusForTemplate.mockResolvedValue([]); // nothing loaded — cumulative fallback has nothing to widen into either
      repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-03-05"), weekLengthDays: 7 });

      jest.useFakeTimers().setSystemTime(new Date("2026-08-14"));
      try {
        await expect(
          service.resolveExamBlueprint({
            examTypeCode: "fastest",
            universityId: "uni-1",
            trackId: null,
            tenantId: "tenant-1",
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  // --- Refinement on top of the P0 fix above (docs/audit-2026-08-14.md, same
  // item): "Rápido (semana actual)" no longer goes empty once the calendar
  // outruns the syllabus, but it still NAMED the wrong week — `weekNumber:
  // 23` when nobody taught week 23. `effectiveWeekNumber` is the last week
  // this template's syllabus actually has data for, derived per (university,
  // track) from `getSyllabusForTemplate()` — never a global/hardcoded
  // constant, so a track whose syllabus is still in range (UNCP) is
  // untouched. `weekNumber` itself is UNCHANGED on purpose: it stays the
  // calendar snapshot `computeCurrentWeek()` produces, because
  // `ResolveExamBlueprintResult`'s own docstring says the frontend feeds it
  // straight back into `POST /exams` as `weekNumber` provenance — and
  // `exams.weekNumber` (schema) is documented as "a frozen snapshot of
  // computeCurrentWeek() at generation time", not "the last taught week".
  // Redefining `weekNumber` itself would silently corrupt that future
  // provenance contract, so this adds a field instead of repurposing one.
  describe("effective week (last week the syllabus actually has content for)", () => {
    it("current_only WITHIN the loaded syllabus: no clamp, no fallback — weekNumber and effectiveWeekNumber both equal the calendar week (the untouched happy path, e.g. UNCP today)", async () => {
      const { service, repository } = buildDeps();
      repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "current_only" });
      repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
      repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 9 }]);
      repository.getSyllabusForTemplate.mockResolvedValue([
        { courseId: "course-1", topicId: "topic-0", weekNumber: 0 },
        { courseId: "course-1", topicId: "topic-3", weekNumber: 3 },
        { courseId: "course-1", topicId: "topic-5", weekNumber: 5 },
      ]);
      repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-03-05"), weekLengthDays: 7 });

      jest.useFakeTimers().setSystemTime(new Date("2026-03-05")); // week 0 -> then advance to exactly week 3 below
      try {
        jest.setSystemTime(new Date("2026-03-26")); // 3 weeks after startsOn -> week 3, an exact syllabus match
        const result = await service.resolveExamBlueprint({
          examTypeCode: "fastest",
          universityId: "uni-1",
          trackId: null,
          tenantId: "tenant-1",
        });

        expect(result.weekNumber).toBe(3);
        expect(result.effectiveWeekNumber).toBe(3);
        expect(result.usedCumulativeFallback).toBe(false);
        expect(result.blueprint).toEqual([
          { courseId: "course-1", topicId: "topic-3", count: 9, difficulty: undefined, ...noLayout(0) },
        ]);
      } finally {
        jest.useRealTimers();
      }
    });

    it("cumulative/eta_by_week: effectiveWeekNumber clamps to the last syllabus week while the row set stays byte-identical past that point — proof the fix is reporting only, never content selection", async () => {
      const { service, repository } = buildDeps();
      repository.findExamType.mockResolvedValue({ courseScope: "all", weekScope: "cumulative" });
      repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
      repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 10 }]);
      repository.getSyllabusForTemplate.mockResolvedValue([
        { courseId: "course-1", topicId: "topic-0", weekNumber: 0 },
        { courseId: "course-1", topicId: "topic-5", weekNumber: 5 },
        { courseId: "course-1", topicId: "topic-10", weekNumber: 10 },
        { courseId: "course-1", topicId: "topic-15", weekNumber: 15 },
        { courseId: "course-1", topicId: "topic-20", weekNumber: 20 }, // last real content -> effective week
      ]);
      repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-03-05"), weekLengthDays: 7 });

      const resolveAt = async (today: string) => {
        jest.useFakeTimers().setSystemTime(new Date(today));
        try {
          return await service.resolveExamBlueprint({
            examTypeCode: "eta_by_week",
            universityId: "uni-1",
            trackId: null,
            tenantId: "tenant-1",
          });
        } finally {
          jest.useRealTimers();
        }
      };

      // startsOn 2026-03-05, 7-day weeks -> +140 days lands exactly on week 20.
      const atMaxWeek = await resolveAt("2026-07-23");
      // Three months further out — well past any taught content.
      const farBeyond = await resolveAt("2026-11-05");

      expect(atMaxWeek.weekNumber).toBe(20);
      expect(farBeyond.weekNumber).toBeGreaterThan(20); // calendar snapshot keeps moving...
      expect(atMaxWeek.effectiveWeekNumber).toBe(20);
      expect(farBeyond.effectiveWeekNumber).toBe(20); // ...but the reported effective week does not.
      // The set of rows resolved must be IDENTICAL — the refinement is pure
      // reporting/communication, never a change to which content is selected.
      expect(farBeyond.blueprint).toEqual(atMaxWeek.blueprint);
    });

    it("effectiveWeekNumber is null when the template's syllabus has zero rows at all (nothing dictated yet — honest 'unknown', not a fabricated calendar week)", async () => {
      const { service, repository } = buildDeps();
      repository.findExamType.mockResolvedValue({ courseScope: "selected", weekScope: "current_only" });
      repository.findCurrentTemplate.mockResolvedValue({ id: "template-1" });
      repository.getTemplateRows.mockResolvedValue([{ courseId: "course-1", questionCount: 12 }]);
      repository.getSyllabusForTemplate.mockResolvedValue([]);
      repository.findActiveCycle.mockResolvedValue({ startsOn: new Date("2026-03-05"), weekLengthDays: 7 });

      jest.useFakeTimers().setSystemTime(new Date("2026-08-14"));
      try {
        const result = await service.resolveExamBlueprint({
          examTypeCode: "fastest",
          universityId: "uni-1",
          trackId: "track-1",
          tenantId: "tenant-1",
          // no selectedCourseIds -> inScopeRows is [], so this is the
          // harmless pre-course-pick auto-fire, not the 400 path.
        });

        expect(result.blueprint).toEqual([]);
        expect(result.effectiveWeekNumber).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
