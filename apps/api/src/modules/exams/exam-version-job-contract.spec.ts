import { EXAM_VERSION_JOB_STATUSES, ExamVersionJob } from "@exams-generator/shared";
import { GENERATION_JOB_STATUSES } from "../../db/schema/enums";
import { ExamVersionJobRecord } from "./exam-version-jobs.repository";

/**
 * Guards the one seam `packages/shared` cannot type-check on its own: the
 * shared wire contract vs the API's own storage types (audit 2026-08-20, M4).
 */
describe("exam version job contract", () => {
  it("keeps the shared status list identical to the database enum", () => {
    // shared can't import the API's schema (it must not depend on the API), so
    // the two lists are only as aligned as this test makes them. Add a status
    // to the column without adding it here and the UI gets a state it has no
    // label for.
    expect([...EXAM_VERSION_JOB_STATUSES]).toEqual([...GENERATION_JOB_STATUSES]);
  });

  it("keeps the stored record assignable to the wire contract", () => {
    // Compile-time assertion: if a field the client depends on is renamed or
    // dropped from the record, this stops building. The record stays WIDER on
    // purpose — tenantId, createdBy and timestamps are storage, not contract.
    const record: ExamVersionJobRecord = {
      id: "job-1",
      tenantId: "tenant-1",
      examId: "exam-1",
      createdBy: "user-1",
      createdByRole: "teacher" as ExamVersionJobRecord["createdByRole"],
      versionCount: 3,
      status: "running",
      completedCount: 1,
      failedReason: null,
      failedQuestionId: null,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      completedAt: null,
    };

    const wire: ExamVersionJob = record;

    expect(wire.completedCount).toBe(1);
  });
});
