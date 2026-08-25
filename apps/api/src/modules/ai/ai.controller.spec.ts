import {
  BadRequestException,
  HttpException,
  HttpStatus,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";
import { Role } from "@exams-generator/shared";
import { AuthTokenPayload } from "../auth/token.service";
import { AiController } from "./ai.controller";
import {
  AiGenerationError,
  AiInvalidResponseError,
  AiRateLimitError,
  GeneratedQuestion,
} from "./domain/ports/question-generator.port";
import { ExtractQuestionService } from "./extract-question.service";
import { GenerateQuestionsService } from "./generate-questions.service";
import { RecropQuestionService } from "./recrop-question.service";
import { ReviseQuestionService } from "./revise-question.service";

const EXTRACTED_QUESTION: GeneratedQuestion = {
  bodyTypst: "¿Cuánto es $2 + 2$?",
  alternatives: ["3", "4", "5", "6", "7"],
  correctAnswer: "1",
};

const TEACHER_USER: AuthTokenPayload = { sub: "teacher-1", tenantId: "tenant-1", role: Role.Teacher };

function buildController() {
  const extractService = { extract: jest.fn() } as unknown as jest.Mocked<ExtractQuestionService>;
  const reviseService = { revise: jest.fn() } as unknown as jest.Mocked<ReviseQuestionService>;
  const recropService = { recrop: jest.fn() } as unknown as jest.Mocked<RecropQuestionService>;
  const controller = new AiController(
    {} as GenerateQuestionsService,
    reviseService,
    extractService,
    recropService,
  );
  return { controller, extractService, reviseService, recropService };
}

const FILE = { buffer: Buffer.from("fake-png-bytes"), mimetype: "image/png" } as Express.Multer.File;

describe("AiController.extract", () => {
  it("throws BadRequestException when no file is uploaded", async () => {
    const { controller } = buildController();

    await expect(
      controller.extract(TEACHER_USER, undefined as unknown as Express.Multer.File),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns the service's result when extraction succeeds", async () => {
    const { controller, extractService } = buildController();
    extractService.extract.mockResolvedValue(EXTRACTED_QUESTION);

    await expect(controller.extract(TEACHER_USER, FILE)).resolves.toEqual(EXTRACTED_QUESTION);
    expect(extractService.extract).toHaveBeenCalledWith(TEACHER_USER, {
      buffer: FILE.buffer,
      mimetype: FILE.mimetype,
    });
  });

  it("maps AiRateLimitError to 429 instead of falling through to a generic 500", async () => {
    const { controller, extractService } = buildController();
    extractService.extract.mockRejectedValue(new AiRateLimitError());

    const rejection = controller.extract(TEACHER_USER, FILE);
    await expect(rejection).rejects.toBeInstanceOf(HttpException);
    await expect(rejection).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it("maps AiInvalidResponseError to 422", async () => {
    const { controller, extractService } = buildController();
    extractService.extract.mockRejectedValue(new AiInvalidResponseError("bad json", "{}"));

    await expect(controller.extract(TEACHER_USER, FILE)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("maps any other AiGenerationError to 502", async () => {
    const { controller, extractService } = buildController();
    extractService.extract.mockRejectedValue(
      new AiGenerationError("OpenRouter request failed with status 401"),
    );

    const rejection = controller.extract(TEACHER_USER, FILE);
    await expect(rejection).rejects.toBeInstanceOf(HttpException);
    await expect(rejection).rejects.toMatchObject({ status: HttpStatus.BAD_GATEWAY });
  });

  it("rethrows unrelated errors unchanged", async () => {
    const { controller, extractService } = buildController();
    const original = new Error("boom");
    extractService.extract.mockRejectedValue(original);

    await expect(controller.extract(TEACHER_USER, FILE)).rejects.toBe(original);
  });
});

describe("AiController.revise", () => {
  it("returns the service's revised draft on success", async () => {
    const { controller, reviseService } = buildController();
    reviseService.revise.mockResolvedValue(EXTRACTED_QUESTION);

    await expect(controller.revise(TEACHER_USER, "q1", { instruction: "más difícil" })).resolves.toEqual(
      EXTRACTED_QUESTION,
    );
    expect(reviseService.revise).toHaveBeenCalledWith(TEACHER_USER, "q1", "más difícil");
  });

  it("maps AiRateLimitError to 429 instead of falling through to a generic 500", async () => {
    const { controller, reviseService } = buildController();
    reviseService.revise.mockRejectedValue(new AiRateLimitError());

    const rejection = controller.revise(TEACHER_USER, "q1", { instruction: "x" });
    await expect(rejection).rejects.toBeInstanceOf(HttpException);
    await expect(rejection).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it("maps AiInvalidResponseError to 422", async () => {
    const { controller, reviseService } = buildController();
    reviseService.revise.mockRejectedValue(new AiInvalidResponseError("bad json", "{}"));

    await expect(controller.revise(TEACHER_USER, "q1", { instruction: "x" })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it("maps any other AiGenerationError to 502", async () => {
    const { controller, reviseService } = buildController();
    reviseService.revise.mockRejectedValue(
      new AiGenerationError("OpenRouter request failed with status 401"),
    );

    const rejection = controller.revise(TEACHER_USER, "q1", { instruction: "x" });
    await expect(rejection).rejects.toBeInstanceOf(HttpException);
    await expect(rejection).rejects.toMatchObject({ status: HttpStatus.BAD_GATEWAY });
  });

  it("passes the service's own HttpExceptions (400 image guard, 404, 422 validation) through unchanged", async () => {
    const { controller, reviseService } = buildController();
    reviseService.revise.mockRejectedValue(new NotFoundException("Question not found: q1"));

    const rejection = controller.revise(TEACHER_USER, "q1", { instruction: "x" });
    await expect(rejection).rejects.toBeInstanceOf(NotFoundException);
    await expect(rejection).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
  });

  it("rethrows unrelated errors unchanged", async () => {
    const { controller, reviseService } = buildController();
    const original = new Error("boom");
    reviseService.revise.mockRejectedValue(original);

    await expect(controller.revise(TEACHER_USER, "q1", { instruction: "x" })).rejects.toBe(original);
  });
});
