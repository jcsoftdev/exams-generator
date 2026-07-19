import { UnprocessableEntityException } from "@nestjs/common";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { ExtractQuestionService } from "./extract-question.service";

const EXTRACTED_QUESTION: GeneratedQuestion = {
  bodyTypst: "¿Cuánto es $2 + 2$?",
  alternatives: ["3", "4", "5", "6", "7"],
  // LETTER (QuestionGeneratorPort contract) — "b" is index 1.
  correctAnswer: "b",
};

function buildDeps() {
  const generator: jest.Mocked<QuestionGeneratorPort> = {
    generate: jest.fn(),
    reviseQuestion: jest.fn(),
    extractFromImage: jest.fn().mockResolvedValue(EXTRACTED_QUESTION),
  };

  const service = new ExtractQuestionService(generator);
  return { service, generator };
}

describe("ExtractQuestionService.extract", () => {
  it("returns the generator's validated, UNSAVED output with correctAnswer converted to an INDEX", async () => {
    const { service, generator } = buildDeps();
    const file = { buffer: Buffer.from("fake-png-bytes"), mimetype: "image/png" };

    const result = await service.extract(file);

    expect(generator.extractFromImage).toHaveBeenCalledWith({
      image: file.buffer,
      mimeType: file.mimetype,
    });
    // Generator returns LETTER "b"; bank storage/response convention expects INDEX "1".
    expect(result).toEqual({ ...EXTRACTED_QUESTION, correctAnswer: "1" });
  });

  it("converts the generator's LETTER correctAnswer to a 0-based INDEX before validating (Task 4 review fix, mirrored)", async () => {
    const { service, generator } = buildDeps();
    generator.extractFromImage.mockResolvedValue({
      bodyTypst: "¿Cuánto es $1+1$?",
      alternatives: ["1", "2", "3", "4", "5"],
      correctAnswer: "b",
    });
    const file = { buffer: Buffer.from("fake-png-bytes"), mimetype: "image/png" };

    const result = await service.extract(file);

    expect(result.correctAnswer).toBe("1");
  });

  it("throws UnprocessableEntityException when the AI output fails validateStructuredContent", async () => {
    const { service, generator } = buildDeps();
    generator.extractFromImage.mockResolvedValue({
      bodyTypst: "¿Cuánto es $2 + 2$?",
      // Only 1 alternative — fails validateStructuredContent's MIN_ALTERNATIVES=2 rule.
      alternatives: ["4"] as unknown as GeneratedQuestion["alternatives"],
      correctAnswer: "a",
    });
    const file = { buffer: Buffer.from("fake-png-bytes"), mimetype: "image/png" };

    await expect(service.extract(file)).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});
