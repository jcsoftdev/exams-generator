import { BankQuestionDto, Difficulty, QUESTION_STATUSES } from "@exams-generator/shared";
import { QUESTION_STATUSES as DB_QUESTION_STATUSES } from "../../db/schema/enums";
import { QuestionListItem } from "./bank.repository";

/**
 * Guards the one seam `packages/shared` cannot type-check on its own: the
 * shared wire contract vs the API's own storage type (audit 2026-08-21, M4b).
 */
describe("bank question contract", () => {
  it("keeps the shared status list identical to the database enum", () => {
    // shared can't import the API's schema (it must not depend on the API),
    // so the two lists are only as aligned as this test makes them. Add a
    // status to the column without adding it here and the UI gets a state it
    // has no label for.
    expect([...QUESTION_STATUSES]).toEqual([...DB_QUESTION_STATUSES]);
  });

  it("keeps the stored record assignable to the wire contract", () => {
    // Compile-time assertion: if a field the client depends on is renamed or
    // dropped from the record, this stops building.
    const record: QuestionListItem = {
      id: "question-1",
      tenantId: null,
      courseId: "course-1",
      topicId: "topic-1",
      difficulty: Difficulty.Easy,
      gradeLevel: "pre",
      correctAnswer: "a",
      type: "structured",
      status: "approved",
      aiGenerated: false,
      imageAssetId: null,
      bodyTypst: "2 + 2 = ?",
      alternatives: ["3", "4", "5", "6"],
      figureCode: null,
      sourceName: null,
    };

    // `alternatives` is `unknown` on the storage side (raw jsonb, no runtime
    // shape guarantee) — narrowed here to what every write path actually
    // stores, exactly like the `as readonly string[]` casts already
    // sprinkled through `bank.service.ts` wherever this column is consumed.
    // `aiGenerated`/`figureCode` are dropped: they cross the wire but aren't
    // part of the contract yet (see `BankQuestionDto`'s doc).
    const wire: BankQuestionDto = {
      ...record,
      alternatives: record.alternatives as readonly string[] | null,
    };

    expect(wire.status).toBe("approved");
  });
});
