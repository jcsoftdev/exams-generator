import { Difficulty, Role } from "@exams-generator/shared";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { BankRepository, QuestionListItem } from "./bank.repository";
import { BankService } from "./bank.service";

const STAFF_USER: AuthTokenPayload = { sub: "staff-1", tenantId: null, role: Role.ContentEditor };
const TEACHER_USER: AuthTokenPayload = { sub: "teacher-1", tenantId: "tenant-1", role: Role.Teacher };

const VALID_FILE = {
  buffer: Buffer.from("fake-image-bytes"),
  mimetype: "image/png",
} as Express.Multer.File;

function buildDeps() {
  const repository = {
    createImageQuestion: jest.fn().mockResolvedValue({ id: "question-1" }),
    createStructuredQuestion: jest.fn().mockResolvedValue({ id: "question-2" }),
    listQuestions: jest.fn().mockResolvedValue([] as QuestionListItem[]),
    findQuestionById: jest.fn().mockResolvedValue(undefined as QuestionListItem | undefined),
  } as unknown as jest.Mocked<BankRepository>;

  const storage = {
    put: jest.fn().mockResolvedValue("https://minio.local/bucket/key"),
    get: jest.fn(),
    delete: jest.fn(),
  };

  const service = new BankService(repository, storage);
  return { service, repository, storage };
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
