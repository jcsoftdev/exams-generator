import { BadRequestException, HttpException, HttpStatus, UnprocessableEntityException } from "@nestjs/common";
import { AiController } from "./ai.controller";
import {
  AiGenerationError,
  AiInvalidResponseError,
  AiRateLimitError,
  GeneratedQuestion,
} from "./domain/ports/question-generator.port";
import { ExtractQuestionService } from "./extract-question.service";
import { GenerateQuestionsService } from "./generate-questions.service";
import { ReviseQuestionService } from "./revise-question.service";

const EXTRACTED_QUESTION: GeneratedQuestion = {
  bodyTypst: "¿Cuánto es $2 + 2$?",
  alternatives: ["3", "4", "5", "6", "7"],
  correctAnswer: "1",
};

function buildController() {
  const extractService = { extract: jest.fn() } as unknown as jest.Mocked<ExtractQuestionService>;
  const controller = new AiController(
    {} as GenerateQuestionsService,
    {} as ReviseQuestionService,
    extractService,
  );
  return { controller, extractService };
}

const FILE = { buffer: Buffer.from("fake-png-bytes"), mimetype: "image/png" } as Express.Multer.File;

describe("AiController.extract", () => {
  it("throws BadRequestException when no file is uploaded", async () => {
    const { controller } = buildController();

    await expect(controller.extract(undefined as unknown as Express.Multer.File)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("returns the service's result when extraction succeeds", async () => {
    const { controller, extractService } = buildController();
    extractService.extract.mockResolvedValue(EXTRACTED_QUESTION);

    await expect(controller.extract(FILE)).resolves.toEqual(EXTRACTED_QUESTION);
    expect(extractService.extract).toHaveBeenCalledWith({ buffer: FILE.buffer, mimetype: FILE.mimetype });
  });

  it("maps AiRateLimitError to 429 instead of falling through to a generic 500", async () => {
    const { controller, extractService } = buildController();
    extractService.extract.mockRejectedValue(new AiRateLimitError());

    const rejection = controller.extract(FILE);
    await expect(rejection).rejects.toBeInstanceOf(HttpException);
    await expect(rejection).rejects.toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS });
  });

  it("maps AiInvalidResponseError to 422", async () => {
    const { controller, extractService } = buildController();
    extractService.extract.mockRejectedValue(new AiInvalidResponseError("bad json", "{}"));

    await expect(controller.extract(FILE)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("maps any other AiGenerationError to 502", async () => {
    const { controller, extractService } = buildController();
    extractService.extract.mockRejectedValue(new AiGenerationError("OpenRouter request failed with status 401"));

    const rejection = controller.extract(FILE);
    await expect(rejection).rejects.toBeInstanceOf(HttpException);
    await expect(rejection).rejects.toMatchObject({ status: HttpStatus.BAD_GATEWAY });
  });

  it("rethrows unrelated errors unchanged", async () => {
    const { controller, extractService } = buildController();
    const original = new Error("boom");
    extractService.extract.mockRejectedValue(original);

    await expect(controller.extract(FILE)).rejects.toBe(original);
  });
});
