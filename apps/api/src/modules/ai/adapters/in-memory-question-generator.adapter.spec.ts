import { Difficulty } from "@exams-generator/shared";
import { InMemoryQuestionGeneratorAdapter } from "./in-memory-question-generator.adapter";
import { runQuestionGeneratorPortContract } from "../domain/ports/question-generator.port.contract";

runQuestionGeneratorPortContract(
  "InMemoryQuestionGeneratorAdapter",
  () => new InMemoryQuestionGeneratorAdapter(),
);

describe("InMemoryQuestionGeneratorAdapter — reviseQuestion / extractFromImage", () => {
  const adapter = new InMemoryQuestionGeneratorAdapter();

  it("reviseQuestion returns a valid GeneratedQuestion echoing the instruction", async () => {
    const out = await adapter.reviseQuestion({
      current: { bodyTypst: "2+2", alternatives: ["4", "5", "6", "7", "8"], correctAnswer: "a" },
      instruction: "hazla más difícil",
      difficulty: Difficulty.Hard,
    });
    expect(out.alternatives).toHaveLength(5);
    expect(typeof out.bodyTypst).toBe("string");
    expect("abcde").toContain(out.correctAnswer);
  });

  it("extractFromImage returns a valid GeneratedQuestion", async () => {
    const out = await adapter.extractFromImage({ image: Buffer.from("png"), mimeType: "image/png" });
    expect(out.alternatives).toHaveLength(5);
  });
});
