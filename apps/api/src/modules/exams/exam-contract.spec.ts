import { EXAM_STATUSES, QUESTION_TYPES } from "@exams-generator/shared";
import { EXAM_STATUSES as DB_EXAM_STATUSES, QUESTION_TYPES as DB_QUESTION_TYPES } from "../../db/schema/enums";

/**
 * Guards the one seam `packages/shared` cannot type-check on its own: the
 * `ExamListItem`/`ExamDetail` wire contract's `status`/`type` unions vs the
 * API's own database enums (audit 2026-08-21, M4b) — same pattern as
 * `exam-version-job-contract.spec.ts`.
 */
describe("exam contract", () => {
  it("keeps the shared exam status list identical to the database enum", () => {
    // shared can't import the API's schema (it must not depend on the API),
    // so the two lists are only as aligned as this test makes them. Add a
    // status to the column without adding it here and the UI gets a state
    // it has no label for.
    expect([...EXAM_STATUSES]).toEqual([...DB_EXAM_STATUSES]);
  });

  it("keeps the shared question type list identical to the database enum", () => {
    expect([...QUESTION_TYPES]).toEqual([...DB_QUESTION_TYPES]);
  });
});
