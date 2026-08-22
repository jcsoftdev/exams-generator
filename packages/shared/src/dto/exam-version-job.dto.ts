/**
 * Lifecycle of an `exam_version_jobs` row, as the client sees it.
 *
 * The database column is driven by `GENERATION_JOB_STATUSES` in the API's
 * schema, which cannot be imported here — `packages/shared` must not depend on
 * the API. The two lists are kept honest by a test on the API side that
 * compares them, so a status added to one and not the other fails a suite
 * instead of surfacing as a status the UI has no label for.
 */
export const EXAM_VERSION_JOB_STATUSES = ["pending", "running", "completed", "failed", "cancelled"] as const;

export type ExamVersionJobStatus = (typeof EXAM_VERSION_JOB_STATUSES)[number];

/**
 * The wire shape of a version-generation job: what `POST /exams/:examId/versions`
 * (202) and `GET /exams/:examId/versions/jobs/:jobId` return, and what the SSE
 * stream pushes.
 *
 * Declared here rather than twice because it WAS twice — `ExamVersionJob` in
 * the web's `exam-versions.models.ts` and `ExamVersionJobRecord` in the API's
 * repository — with nothing to catch a rename crossing the wire (audit
 * 2026-08-20, M4). Now both sides compile against this one declaration, so a
 * field that disappears on the server stops compiling on the client.
 *
 * The API's record type stays wider on purpose: it also carries `tenantId`,
 * `createdBy` and timestamps, which are storage concerns the client has no use
 * for. This is the subset that is a contract.
 *
 * A `failed` job with `completedCount > 0` is a PARTIAL result, not a total
 * loss — those forms exist and are downloadable, which the versions screen has
 * to say out loud.
 */
export interface ExamVersionJob {
  readonly id: string;
  readonly examId: string;
  readonly versionCount: number;
  readonly status: ExamVersionJobStatus;
  readonly completedCount: number;
  readonly failedReason: string | null;
  readonly failedQuestionId: string | null;
}
