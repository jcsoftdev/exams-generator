import { Difficulty, Role } from "@exams-generator/shared";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from "@nestjs/common";
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
    saveSelection: jest.fn().mockResolvedValue(undefined),
    getSelectedQuestionIds: jest.fn(),
    findExamQuestion: jest.fn(),
    replaceQuestion: jest.fn().mockResolvedValue(undefined),
    confirmExam: jest.fn().mockResolvedValue(undefined),
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

describe("ExamsService.createExam", () => {
  it("rejects platform staff (no tenant) — exams always belong to a tenant", async () => {
    const { service } = buildDeps();

    await expect(
      service.createExam(STAFF, { title: "X", gradeLevel: "primaria_1", blueprint: [{ courseId: "c1", count: 1 }] }),
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
    expect(repository.getQuestionPool).toHaveBeenCalledWith({ tenantId: "tenant-1", gradeLevel: "primaria_1" });
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
        expect.objectContaining({ courseId: "course-1", courseName: "Aritmética", requested: 5, available: 3 }),
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

    await expect(service.replaceQuestion(TEACHER, "exam-1", "q-not-selected", { mode: "reroll" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
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
      service.replaceQuestion(TEACHER, "exam-1", "q1", { mode: "manual", replacementQuestionId: "q-wrong-course" }),
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
          topicId: "topic-1",
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
      questions: [
        expect.objectContaining({ id: "q1", position: 0, type: "image", imageAssetId: "asset-1" }),
      ],
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
