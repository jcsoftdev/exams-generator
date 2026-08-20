import { Difficulty, Role } from "@exams-generator/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { TypstCompilationError } from "../exams/domain/ports/pdf-compiler.port";
import { fakePng } from "../../test-support/image-fixtures";
import { BankRepository, QuestionListItem } from "./bank.repository";
import { BankService } from "./bank.service";
import { hashBodyTypst } from "./domain/hash-body-typst";

const STAFF_USER: AuthTokenPayload = { sub: "staff-1", tenantId: null, role: Role.ContentEditor };
const TEACHER_USER: AuthTokenPayload = { sub: "teacher-1", tenantId: "tenant-1", role: Role.Teacher };
/**
 * A `teacher` (tenant role) whose token carries `tenantId: null` — this is
 * exactly what "a tenant tries to create/manage centrally" looks like at
 * the JWT-payload level, since a legitimate tenant account always has
 * `tenantId` set (see design doc §2). `JwtAuthGuard` doesn't touch the DB,
 * so a forged/misissued token like this reaches the service — this is the
 * authorization boundary the service-level check protects.
 */
const TENANT_ROLE_NO_TENANT_ID_USER: AuthTokenPayload = {
  sub: "rogue-1",
  tenantId: null,
  role: Role.Teacher,
};
/** A staff role (`content_editor`) whose token carries a `tenantId` — mirror case. */
const STAFF_ROLE_WITH_TENANT_ID_USER: AuthTokenPayload = {
  sub: "rogue-2",
  tenantId: "tenant-1",
  role: Role.ContentEditor,
};

const VALID_FILE = {
  buffer: fakePng("fake-image-bytes"),
  mimetype: "image/png",
} as Express.Multer.File;

function buildDeps() {
  const repository = {
    createImageQuestion: jest.fn().mockResolvedValue({ id: "question-1" }),
    createStructuredQuestion: jest.fn().mockResolvedValue({ id: "question-2" }),
    findByBodyHash: jest.fn().mockResolvedValue(undefined),
    findBySourceName: jest.fn().mockResolvedValue(undefined),
    listQuestions: jest.fn().mockResolvedValue([] as QuestionListItem[]),
    countByCourseAndTopic: jest.fn().mockResolvedValue([]),
    findQuestionById: jest.fn().mockResolvedValue(undefined as QuestionListItem | undefined),
    approveQuestion: jest.fn().mockResolvedValue(undefined as { id: string; status: string } | undefined),
    rejectQuestion: jest.fn().mockResolvedValue(false),
    topicExists: jest.fn().mockResolvedValue(true),
    getSubtopicTopicId: jest.fn().mockResolvedValue(undefined as string | undefined),
    updateStructuredQuestionAndTaxonomy: jest.fn().mockResolvedValue(undefined as QuestionListItem | undefined),
  } as unknown as jest.Mocked<BankRepository>;

  const storage = {
    put: jest.fn().mockResolvedValue("https://minio.local/bucket/key"),
    get: jest.fn(),
    delete: jest.fn(),
    ping: jest.fn().mockResolvedValue(undefined),
  };

  const pdfCompiler = {
    compileExam: jest.fn().mockResolvedValue(Buffer.from("fake-pdf-bytes")),
    compileAnswerKey: jest.fn().mockResolvedValue(Buffer.from("fake-pdf-bytes")),
  };

  const service = new BankService(repository, storage, pdfCompiler);
  return { service, repository, storage, pdfCompiler };
}

describe("BankService.createImageQuestion", () => {
  it("uploads the image via StoragePort then persists the question with the requester's tenant", async () => {
    const { service, repository, storage } = buildDeps();

    const result = await service.createImageQuestion(TEACHER_USER, {
      courseId: "course-1",
      topicId: "topic-1",
      difficulty: Difficulty.Medium,
      gradeLevel: "primaria_2",
      correctAnswer: "c",
      file: VALID_FILE,
    });

    expect(storage.put).toHaveBeenCalledTimes(1);
    expect(repository.createImageQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        topicId: "topic-1",
        difficulty: Difficulty.Medium,
        gradeLevel: "primaria_2",
        correctAnswer: "c",
        createdBy: "teacher-1",
      }),
    );
    expect(result).toEqual({ id: "question-1" });
  });

  it("refuses an image question whose source name is already in the bank", async () => {
    // An image question has no statement, so body_hash cannot catch a re-seed.
    // Without this, every retry of a rate-limited seeding run duplicates the
    // whole batch — which is exactly how 451 duplicates got in.
    const { service, repository } = buildDeps();
    (repository.findBySourceName as jest.Mock).mockResolvedValueOnce({ id: "question-9" });

    await expect(
      service.createImageQuestion(STAFF_USER, {
        courseId: "course-1",
        topicId: "topic-1",
        subtopicId: undefined,
        difficulty: Difficulty.Hard,
        gradeLevel: "pre",
        correctAnswer: "b",
        file: { buffer: fakePng(), mimetype: "image/png" } as Express.Multer.File,
        sourceUrl: "https://example.test/examen.pdf",
        sourceName: "UNCP 2021-I, Geometría, pregunta 1 (clave B)",
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(repository.createImageQuestion).not.toHaveBeenCalled();
  });

  it("keeps the provenance of an image question, which has no statement to trace it by", async () => {
    const { service, repository } = buildDeps();

    await service.createImageQuestion(STAFF_USER, {
      courseId: "course-1",
      topicId: "topic-1",
      subtopicId: undefined,
      difficulty: Difficulty.Hard,
      gradeLevel: "pre",
      correctAnswer: "b",
      file: { buffer: fakePng(), mimetype: "image/png" } as Express.Multer.File,
      sourceUrl: "https://admision.uni.edu.pe/solucionario2019.pdf",
      sourceName: "UNI — Admisión 2019-1, Geometría, pregunta 12 (clave B)",
    });

    expect(repository.createImageQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "https://admision.uni.edu.pe/solucionario2019.pdf",
        sourceName: "UNI — Admisión 2019-1, Geometría, pregunta 12 (clave B)",
      }),
    );
  });

  it("persists tenantId=null when the requester is platform staff", async () => {
    const { service, repository } = buildDeps();

    await service.createImageQuestion(STAFF_USER, {
      courseId: "course-1",
      topicId: "topic-1",
      difficulty: Difficulty.Easy,
      gradeLevel: "pre",
      correctAnswer: "a",
      file: VALID_FILE,
    });

    expect(repository.createImageQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, createdBy: "staff-1" }),
    );
  });

  it("rejects with BadRequestException (aggregating every error) when required fields are missing", async () => {
    const { service, repository, storage } = buildDeps();

    await expect(
      service.createImageQuestion(TEACHER_USER, {
        courseId: undefined,
        topicId: undefined,
        difficulty: undefined,
        gradeLevel: undefined,
        correctAnswer: undefined,
        file: undefined,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.createImageQuestion).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when a tenant role (teacher) attempts to create centrally (tenantId=null)", async () => {
    const { service, repository, storage } = buildDeps();

    await expect(
      service.createImageQuestion(TENANT_ROLE_NO_TENANT_ID_USER, {
        courseId: "course-1",
        topicId: "topic-1",
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        correctAnswer: "a",
        file: VALID_FILE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.createImageQuestion).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when a staff role (content_editor) attempts to create for a tenant", async () => {
    const { service, repository, storage } = buildDeps();

    await expect(
      service.createImageQuestion(STAFF_ROLE_WITH_TENANT_ID_USER, {
        courseId: "course-1",
        topicId: "topic-1",
        difficulty: Difficulty.Easy,
        gradeLevel: "primaria_1",
        correctAnswer: "a",
        file: VALID_FILE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.createImageQuestion).not.toHaveBeenCalled();
  });

  it("throws BadRequestException when subtopicId doesn't exist", async () => {
    const { service, repository, storage } = buildDeps();
    repository.getSubtopicTopicId.mockResolvedValue(undefined);

    await expect(
      service.createImageQuestion(TEACHER_USER, {
        courseId: "course-1",
        topicId: "topic-1",
        subtopicId: "nonexistent-subtopic",
        difficulty: Difficulty.Medium,
        gradeLevel: "primaria_2",
        correctAnswer: "c",
        file: VALID_FILE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.getSubtopicTopicId).toHaveBeenCalledWith("nonexistent-subtopic");
    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.createImageQuestion).not.toHaveBeenCalled();
  });

  it("throws BadRequestException when subtopicId belongs to a different topic than topicId", async () => {
    const { service, repository, storage } = buildDeps();
    repository.getSubtopicTopicId.mockResolvedValue("topic-999");

    await expect(
      service.createImageQuestion(TEACHER_USER, {
        courseId: "course-1",
        topicId: "topic-1",
        subtopicId: "subtopic-1",
        difficulty: Difficulty.Medium,
        gradeLevel: "primaria_2",
        correctAnswer: "c",
        file: VALID_FILE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.createImageQuestion).not.toHaveBeenCalled();
  });

  it("persists the question when subtopicId belongs to the given topicId", async () => {
    const { service, repository } = buildDeps();
    repository.getSubtopicTopicId.mockResolvedValue("topic-1");

    const result = await service.createImageQuestion(TEACHER_USER, {
      courseId: "course-1",
      topicId: "topic-1",
      subtopicId: "subtopic-1",
      difficulty: Difficulty.Medium,
      gradeLevel: "primaria_2",
      correctAnswer: "c",
      file: VALID_FILE,
    });

    expect(repository.getSubtopicTopicId).toHaveBeenCalledWith("subtopic-1");
    expect(repository.createImageQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ topicId: "topic-1", subtopicId: "subtopic-1" }),
    );
    expect(result).toEqual({ id: "question-1" });
  });
});

describe("BankService.createStructuredQuestion", () => {
  const VALID_DTO = {
    courseId: "course-1",
    topicId: "topic-1",
    difficulty: Difficulty.Medium,
    gradeLevel: "primaria_2",
    bodyTypst: "$x + 1 = 2$",
    alternatives: ["1", "2", "3"],
    correctAnswer: "1",
    figureCode: undefined,
  };

  it("persists the structured question with the requester's tenant, no storage upload involved", async () => {
    const { service, repository, storage } = buildDeps();

    const result = await service.createStructuredQuestion(TEACHER_USER, VALID_DTO);

    expect(storage.put).not.toHaveBeenCalled();
    expect(repository.createStructuredQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        topicId: "topic-1",
        difficulty: Difficulty.Medium,
        gradeLevel: "primaria_2",
        bodyTypst: "$x + 1 = 2$",
        alternatives: ["1", "2", "3"],
        correctAnswer: "1",
        createdBy: "teacher-1",
      }),
    );
    expect(result).toEqual({ id: "question-2" });
  });

  it("hashes the figure alongside the statement so two drawings of one wording both fit", async () => {
    // A circuits or geometry set repeats one wording across many drawings
    // ("¿A qué componente corresponde el símbolo de la figura?"). The unique
    // index is on the hash, so the fingerprint is what keeps the second one
    // from being rejected as a duplicate of the first.
    const { service, repository } = buildDeps();
    const figureA = "a".repeat(64);
    const figureB = "b".repeat(64);

    await service.createStructuredQuestion(TEACHER_USER, { ...VALID_DTO, figureFingerprint: figureA });
    await service.createStructuredQuestion(TEACHER_USER, { ...VALID_DTO, figureFingerprint: figureB });

    const [firstCall, secondCall] = (
      repository.createStructuredQuestion as jest.Mock
    ).mock.calls;
    expect(firstCall[0].bodyHash).not.toBe(secondCall[0].bodyHash);
    expect(firstCall[0].bodyHash).toBe(hashBodyTypst(VALID_DTO.bodyTypst, figureA));
  });

  it("keeps the figure-less hash unchanged, so the questions already stored still dedupe", async () => {
    const { service, repository } = buildDeps();

    await service.createStructuredQuestion(TEACHER_USER, VALID_DTO);

    const [call] = (repository.createStructuredQuestion as jest.Mock).mock.calls;
    expect(call[0].bodyHash).toBe(hashBodyTypst(VALID_DTO.bodyTypst));
  });

  it("rejects a figure fingerprint that is not a sha256 hex digest", async () => {
    const { service, repository } = buildDeps();

    await expect(
      service.createStructuredQuestion(TEACHER_USER, {
        ...VALID_DTO,
        figureFingerprint: "not-a-hash",
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createStructuredQuestion).not.toHaveBeenCalled();
  });

  it("keeps the provenance the seeder sends, so a licence change stays a query", async () => {
    // questions.source_url exists to answer "pull every question from host X"
    // without re-deriving it from the seed files; dropping it on the way in
    // makes that impossible for anything created over HTTP.
    const { service, repository } = buildDeps();

    await service.createStructuredQuestion(STAFF_USER, {
      ...VALID_DTO,
      sourceUrl: "https://admision.uni.edu.pe/solucionario2021.pdf",
      sourceName: "UNI — Admisión 2021-1, Física, pregunta 7 (clave C)",
    });

    expect(repository.createStructuredQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceUrl: "https://admision.uni.edu.pe/solucionario2021.pdf",
        sourceName: "UNI — Admisión 2021-1, Física, pregunta 7 (clave C)",
      }),
    );
  });

  it("persists tenantId=null when the requester is platform staff", async () => {
    const { service, repository } = buildDeps();

    await service.createStructuredQuestion(STAFF_USER, VALID_DTO);

    expect(repository.createStructuredQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: null, createdBy: "staff-1" }),
    );
  });

  it("rejects with BadRequestException (aggregating every error) when required fields are missing", async () => {
    const { service, repository } = buildDeps();

    await expect(
      service.createStructuredQuestion(TEACHER_USER, {
        courseId: undefined,
        topicId: undefined,
        difficulty: undefined,
        gradeLevel: undefined,
        bodyTypst: undefined,
        alternatives: undefined,
        correctAnswer: undefined,
        figureCode: undefined,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.createStructuredQuestion).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when a tenant role (teacher) attempts to create centrally (tenantId=null)", async () => {
    const { service, repository } = buildDeps();

    await expect(
      service.createStructuredQuestion(TENANT_ROLE_NO_TENANT_ID_USER, VALID_DTO),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.createStructuredQuestion).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when a staff role (content_editor) attempts to create for a tenant", async () => {
    const { service, repository } = buildDeps();

    await expect(
      service.createStructuredQuestion(STAFF_ROLE_WITH_TENANT_ID_USER, VALID_DTO),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(repository.createStructuredQuestion).not.toHaveBeenCalled();
  });

  it("throws ConflictException without inserting when a question with the same bodyTypst already exists in the same tenant", async () => {
    const { service, repository } = buildDeps();
    repository.findByBodyHash.mockResolvedValue({ id: "existing-question" });

    await expect(service.createStructuredQuestion(TEACHER_USER, VALID_DTO)).rejects.toBeInstanceOf(
      ConflictException,
    );

    expect(repository.findByBodyHash).toHaveBeenCalledWith("tenant-1", expect.any(String));
    expect(repository.createStructuredQuestion).not.toHaveBeenCalled();
  });
});

describe("BankService.listQuestions", () => {
  it("scopes the repository query to the requester's own tenant", async () => {
    const { service, repository } = buildDeps();

    await service.listQuestions(TEACHER_USER, { courseId: "course-1" });

    expect(repository.listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ currentTenantId: "tenant-1", courseId: "course-1" }),
    );
  });

  it("scopes to tenantId=null for platform staff", async () => {
    const { service, repository } = buildDeps();

    await service.listQuestions(STAFF_USER, {});

    expect(repository.listQuestions).toHaveBeenCalledWith(
      expect.objectContaining({ currentTenantId: null }),
    );
  });
});

describe("BankService.countQuestionsByTopic", () => {
  it("scopes the summary to the requester's own tenant, carrying the same filters listQuestions takes", async () => {
    const { service, repository } = buildDeps();

    await service.countQuestionsByTopic(TEACHER_USER, {
      difficulty: Difficulty.Hard,
      gradeLevel: "secundaria_1",
    });

    expect(repository.countByCourseAndTopic).toHaveBeenCalledWith(
      expect.objectContaining({
        currentTenantId: "tenant-1",
        difficulty: Difficulty.Hard,
        gradeLevel: "secundaria_1",
      }),
    );
  });

  it("scopes to tenantId=null for platform staff", async () => {
    const { service, repository } = buildDeps();

    await service.countQuestionsByTopic(STAFF_USER, {});

    expect(repository.countByCourseAndTopic).toHaveBeenCalledWith(
      expect.objectContaining({ currentTenantId: null }),
    );
  });
});

describe("BankService.getQuestionById", () => {
  const QUESTION: QuestionListItem = {
    id: "question-1",
    tenantId: "tenant-1",
    courseId: "course-1",
    topicId: "topic-1",
    difficulty: Difficulty.Easy,
    gradeLevel: "primaria_1",
    correctAnswer: "a",
    type: "image",
    status: "approved",
    aiGenerated: false,
    imageAssetId: "asset-1",
    bodyTypst: null,
    alternatives: null,
    figureCode: null,
  };

  it("scopes the repository lookup to the requester's own tenant and returns the question", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(QUESTION);

    const result = await service.getQuestionById(TEACHER_USER, "question-1");

    expect(repository.findQuestionById).toHaveBeenCalledWith("question-1", "tenant-1");
    expect(result).toEqual(QUESTION);
  });

  it("throws NotFoundException when the repository returns nothing (not found OR belongs to another tenant)", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(undefined);

    await expect(service.getQuestionById(TEACHER_USER, "question-999")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

const DRAFT_QUESTION: QuestionListItem = {
  id: "draft-1",
  tenantId: "tenant-1",
  courseId: "course-1",
  topicId: "topic-1",
  difficulty: Difficulty.Easy,
  gradeLevel: "primaria_1",
  correctAnswer: "0",
  type: "structured",
  status: "draft",
  aiGenerated: true,
  imageAssetId: null,
  bodyTypst: "draft body",
  alternatives: ["1", "2", "3"],
  figureCode: null,
};

describe("BankService.approveQuestion", () => {
  it("approves a draft owned by the requester's tenant", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);
    repository.approveQuestion.mockResolvedValue({ id: "draft-1", status: "approved" });

    const result = await service.approveQuestion(TEACHER_USER, "draft-1");

    expect(repository.approveQuestion).toHaveBeenCalledWith("draft-1", "tenant-1");
    expect(result).toEqual({ id: "draft-1" });
  });

  it("throws NotFoundException when the question doesn't exist or isn't visible to the requester", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(undefined);

    await expect(service.approveQuestion(TEACHER_USER, "missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.approveQuestion).not.toHaveBeenCalled();
  });

  it("throws ConflictException when the question is already approved", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue({ ...DRAFT_QUESTION, status: "approved" });

    await expect(service.approveQuestion(TEACHER_USER, "draft-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.approveQuestion).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when a tenant role (teacher) tries to approve a central draft", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue({ ...DRAFT_QUESTION, tenantId: null });

    await expect(service.approveQuestion(TEACHER_USER, "draft-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.approveQuestion).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when a staff role (content_editor) tries to approve a tenant's draft", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);

    await expect(service.approveQuestion(STAFF_USER, "draft-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.approveQuestion).not.toHaveBeenCalled();
  });
});

describe("BankService.rejectQuestion", () => {
  it("rejects (deletes) a draft owned by the requester's tenant", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);
    repository.rejectQuestion.mockResolvedValue(true);

    const result = await service.rejectQuestion(TEACHER_USER, "draft-1");

    expect(repository.rejectQuestion).toHaveBeenCalledWith("draft-1", "tenant-1");
    expect(result).toEqual({ id: "draft-1" });
  });

  it("throws NotFoundException when the question doesn't exist or isn't visible to the requester", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(undefined);

    await expect(service.rejectQuestion(TEACHER_USER, "missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("throws ConflictException when the question is already approved", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue({ ...DRAFT_QUESTION, status: "approved" });

    await expect(service.rejectQuestion(TEACHER_USER, "draft-1")).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("throws ForbiddenException when a tenant role (teacher) tries to reject a central draft", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue({ ...DRAFT_QUESTION, tenantId: null });

    await expect(service.rejectQuestion(TEACHER_USER, "draft-1")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(repository.rejectQuestion).not.toHaveBeenCalled();
  });
});

describe("BankService.editQuestion", () => {
  it("recompiles the Typst preview and persists the merged edit", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);
    repository.updateStructuredQuestionAndTaxonomy.mockResolvedValue({
      ...DRAFT_QUESTION,
      bodyTypst: "edited body",
    });

    const result = await service.editQuestion(TEACHER_USER, "draft-1", {
      bodyTypst: "edited body",
    });

    expect(pdfCompiler.compileExam).toHaveBeenCalledTimes(1);
    expect(repository.updateStructuredQuestionAndTaxonomy).toHaveBeenCalledWith(
      "draft-1",
      "tenant-1",
      expect.objectContaining({ bodyTypst: "edited body", alternatives: ["1", "2", "3"] }),
      expect.objectContaining({ topicId: undefined, difficulty: undefined, gradeLevel: undefined }),
    );
    expect(result.bodyTypst).toBe("edited body");
  });

  it("throws BadRequestException and does NOT persist when the Typst preview fails to compile", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);
    pdfCompiler.compileExam.mockRejectedValue(
      new TypstCompilationError("typst compile failed", "draft-1", "syntax error"),
    );

    await expect(
      service.editQuestion(TEACHER_USER, "draft-1", { bodyTypst: "#broken{" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.updateStructuredQuestionAndTaxonomy).not.toHaveBeenCalled();
  });

  it("throws NotFoundException when the question doesn't exist or isn't visible to the requester", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(undefined);

    await expect(
      service.editQuestion(TEACHER_USER, "missing", { bodyTypst: "x" }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("edits an already-approved question too (not just draft)", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue({ ...DRAFT_QUESTION, status: "approved" });
    repository.updateStructuredQuestionAndTaxonomy.mockResolvedValue({
      ...DRAFT_QUESTION,
      status: "approved",
      bodyTypst: "edited approved body",
    });

    const result = await service.editQuestion(TEACHER_USER, "draft-1", {
      bodyTypst: "edited approved body",
    });

    expect(repository.updateStructuredQuestionAndTaxonomy).toHaveBeenCalled();
    expect(result.bodyTypst).toBe("edited approved body");
  });

  it("throws ConflictException when the question is archived", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue({ ...DRAFT_QUESTION, status: "archived" });

    await expect(
      service.editQuestion(TEACHER_USER, "draft-1", { bodyTypst: "x" }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(repository.updateStructuredQuestionAndTaxonomy).not.toHaveBeenCalled();
  });

  it("throws BadRequestException when the merged content fails validation", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);

    await expect(
      service.editQuestion(TEACHER_USER, "draft-1", { bodyTypst: "   " }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateStructuredQuestionAndTaxonomy).not.toHaveBeenCalled();
  });

  it("throws ForbiddenException when a tenant role (teacher) tries to edit a central draft", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue({ ...DRAFT_QUESTION, tenantId: null });

    await expect(
      service.editQuestion(TEACHER_USER, "draft-1", { bodyTypst: "x" }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repository.updateStructuredQuestionAndTaxonomy).not.toHaveBeenCalled();
  });

  it("throws BadRequestException and does NOT persist when the taxonomy patch is invalid", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);

    await expect(
      service.editQuestion(TEACHER_USER, "draft-1", { difficulty: "trivial" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.updateStructuredQuestionAndTaxonomy).not.toHaveBeenCalled();
  });

  it("persists provided taxonomy fields via repository.updateStructuredQuestionAndTaxonomy", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);
    repository.updateStructuredQuestionAndTaxonomy.mockResolvedValue(DRAFT_QUESTION);

    await service.editQuestion(TEACHER_USER, "draft-1", { difficulty: "hard" });

    expect(repository.updateStructuredQuestionAndTaxonomy).toHaveBeenCalledWith(
      "draft-1",
      "tenant-1",
      expect.anything(),
      expect.objectContaining({ difficulty: "hard" }),
    );
  });

  it("throws BadRequestException and does NOT persist when topicId doesn't exist (FK pre-check, before any write)", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);
    repository.topicExists.mockResolvedValue(false);

    await expect(
      service.editQuestion(TEACHER_USER, "draft-1", { topicId: "nonexistent-topic" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(repository.topicExists).toHaveBeenCalledWith("nonexistent-topic");
    expect(pdfCompiler.compileExam).not.toHaveBeenCalled();
    expect(repository.updateStructuredQuestionAndTaxonomy).not.toHaveBeenCalled();
  });

  it("does not call topicExists when topicId is not part of the patch", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);
    repository.updateStructuredQuestionAndTaxonomy.mockResolvedValue(DRAFT_QUESTION);

    await service.editQuestion(TEACHER_USER, "draft-1", { difficulty: "hard" });

    expect(repository.topicExists).not.toHaveBeenCalled();
  });
});

describe("BankService.previewQuestion", () => {
  it("compiles and caches the Typst preview for a structured question", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);
    const mockPdf = Buffer.from("fake-pdf-bytes");
    pdfCompiler.compileExam.mockResolvedValue(mockPdf);

    const result = await service.previewQuestion(TEACHER_USER, "draft-1");

    expect(pdfCompiler.compileExam).toHaveBeenCalledTimes(1);
    expect(result).toBe(mockPdf);

    // Second call should hit cache
    const cachedResult = await service.previewQuestion(TEACHER_USER, "draft-1");
    expect(pdfCompiler.compileExam).toHaveBeenCalledTimes(1); // Still 1, not 2
    expect(cachedResult).toBe(mockPdf);
  });

  it("throws BadRequestException when the Typst compilation fails", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.findQuestionById.mockResolvedValue(DRAFT_QUESTION);
    pdfCompiler.compileExam.mockRejectedValue(
      new TypstCompilationError("typst compile failed", "draft-1", "syntax error"),
    );

    await expect(service.previewQuestion(TEACHER_USER, "draft-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("throws NotFoundException when the question doesn't exist or isn't visible to the requester", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(undefined);

    await expect(service.previewQuestion(TEACHER_USER, "missing")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("throws BadRequestException when the question is not structured", async () => {
    const { service, repository } = buildDeps();
    const imageQuestion: QuestionListItem = {
      id: "image-1",
      tenantId: "tenant-1",
      courseId: "course-1",
      topicId: "topic-1",
      difficulty: Difficulty.Easy,
      gradeLevel: "primaria_1",
      correctAnswer: "a",
      type: "image",
      status: "approved",
      aiGenerated: false,
      imageAssetId: "asset-1",
      bodyTypst: null,
      alternatives: null,
      figureCode: null,
    };
    repository.findQuestionById.mockResolvedValue(imageQuestion);

    await expect(service.previewQuestion(TEACHER_USER, "image-1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("evicts the oldest entry once the preview cache exceeds MAX_PREVIEW_CACHE (50)", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.findQuestionById.mockImplementation((id: string) =>
      Promise.resolve({ ...DRAFT_QUESTION, id }),
    );

    // Insert 51 distinct previews — one over the cap — to force eviction.
    for (let i = 0; i < 51; i += 1) {
      await service.previewQuestion(TEACHER_USER, `draft-${i}`);
    }

    const cache = (service as unknown as { previewCache: Map<string, Buffer> }).previewCache;
    expect(cache.size).toBeLessThanOrEqual(50);
    expect(cache.has("draft-0")).toBe(false);
    expect(cache.has("draft-50")).toBe(true);

    // Behavioral proof: the evicted entry is a genuine cache miss (recompiles),
    // not just absent from the Map.
    const compileCallsBeforeRefetch = pdfCompiler.compileExam.mock.calls.length;
    await service.previewQuestion(TEACHER_USER, "draft-0");
    expect(pdfCompiler.compileExam.mock.calls.length).toBe(compileCallsBeforeRefetch + 1);
  });
});
