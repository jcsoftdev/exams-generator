import {
  AiExtractedQuestion,
  AiRevisedQuestion,
  Difficulty,
  GENERATION_JOB_STATUSES,
  GenerationJob,
  GenerationJobListItem,
  Role,
} from "@exams-generator/shared";
import { GENERATION_JOB_STATUSES as DB_GENERATION_JOB_STATUSES } from "../../db/schema/enums";
import { ExtractedQuestion, GeneratedQuestion } from "./domain/ports/question-generator.port";
import { GenerationJobListRecord, GenerationJobRecord } from "./generation-jobs.repository";

/**
 * Guards the two seams `packages/shared` cannot type-check on its own: the
 * shared `/ai/questions/jobs/*` and revise/extract wire contracts vs the
 * API's own storage/port types (audit 2026-08-21, M4b).
 */
describe("ai contract", () => {
  it("keeps the shared generation-job status list identical to the database enum", () => {
    // shared can't import the API's schema (it must not depend on the API),
    // so the two lists are only as aligned as this test makes them. Add a
    // status to the column without adding it here and the UI gets a state it
    // has no label for.
    expect([...GENERATION_JOB_STATUSES]).toEqual([...DB_GENERATION_JOB_STATUSES]);
  });

  it("keeps the stored generation-job record assignable to the wire contract", () => {
    // Compile-time assertion: if a field the client depends on is renamed or
    // dropped from the record, this stops building. The record stays WIDER
    // on purpose — createdBy/createdByRole are storage/audit concerns, not
    // contract.
    const record: GenerationJobRecord = {
      id: "job-1",
      tenantId: "tenant-1",
      createdBy: "user-1",
      createdByRole: Role.Teacher,
      courseId: "course-1",
      topicId: "topic-1",
      difficulty: Difficulty.Easy,
      gradeLevel: "5-primaria",
      count: 5,
      withFigure: false,
      status: "running",
      createdCount: 1,
      failedCount: 0,
      createdQuestionIds: ["question-1"],
      failedItems: [],
      cancelRequested: false,
      retriedFromJobId: null,
      rootJobId: null,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      completedAt: null,
    };

    const wire: GenerationJob = record;

    expect(wire.count).toBe(5);
  });

  it("keeps the stored generation-job LIST record assignable to the wire contract", () => {
    const record: GenerationJobRecord = {
      id: "job-1",
      tenantId: "tenant-1",
      createdBy: "user-1",
      createdByRole: Role.Teacher,
      courseId: "course-1",
      topicId: "topic-1",
      difficulty: Difficulty.Easy,
      gradeLevel: "5-primaria",
      count: 5,
      withFigure: false,
      status: "completed",
      createdCount: 5,
      failedCount: 0,
      createdQuestionIds: [],
      failedItems: [],
      cancelRequested: false,
      retriedFromJobId: null,
      rootJobId: null,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
      completedAt: "2026-08-21T00:05:00.000Z",
    };
    const listRecord: GenerationJobListRecord = {
      ...record,
      attemptCount: 1,
      courseName: "Matemática",
      topicName: "Álgebra",
    };

    const wire: GenerationJobListItem = listRecord;

    expect(wire.attemptCount).toBe(1);
  });

  it("keeps the generator port's GeneratedQuestion assignable to the revise/extract wire contract", () => {
    // Compile-time assertion: `AiController.revise()`/`extract()` return this
    // port type directly — if the port's shape drifts from what the client
    // was promised, this stops building instead of surfacing as a runtime
    // shape mismatch.
    const generated: GeneratedQuestion = {
      bodyTypst: "$x + 1$",
      alternatives: ["0", "1", "2", "3", "4"],
      correctAnswer: "0",
    };

    const wire: AiRevisedQuestion = generated;

    expect(wire.correctAnswer).toBe("0");
  });

  it("keeps the generator port's ExtractedQuestion — including its permissive empty-alternatives/null-key shape — assignable to the extract wire contract", () => {
    // Compile-time assertion: `ExtractQuestionService.extract()` (via
    // `AiController.extract()`) returns a value built from this port type.
    // `alternatives: []` and `correctAnswer: null` are the exact shape
    // `validateExtractedQuestionShape` allows through when the photo shows
    // no alternatives/key at all — if `AiExtractedQuestion` ever tightened
    // `alternatives`/`correctAnswer` back to the stricter `revise`/`generate`
    // shape, this stops building instead of the mismatch surfacing as a
    // runtime response shape nobody asked for.
    const extracted: ExtractedQuestion = {
      bodyTypst: "¿Cuánto es $1+1$?",
      alternatives: [],
      correctAnswer: null,
    };

    const wire: AiExtractedQuestion = extracted;

    expect(wire.alternatives).toEqual([]);
    expect(wire.correctAnswer).toBeNull();
  });
});
