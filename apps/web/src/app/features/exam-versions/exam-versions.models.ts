/** Lifecycle of an `exam_version_jobs` row — same vocabulary as the AI generation jobs. */
export type ExamVersionJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/**
 * Mirrors the `exam_version_jobs` row returned by `POST
 * /exams/:examId/versions` (202) and `GET .../versions/jobs/:jobId`.
 *
 * PDF compilation runs in a BullMQ worker, so the POST no longer returns the
 * generated forms — it returns this job, whose `completedCount` climbs to
 * `versionCount` as each form is persisted. A `failed` job with
 * `completedCount > 0` is a PARTIAL result, not a total loss: those forms
 * exist and are downloadable, which is exactly what the versions screen has
 * to say out loud (audit P1 — the UI used to report a blanket failure while
 * PDFs sat in storage).
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

/**
 * Mirrors the `GET /exams/:examId/versions` (B4) response row — DECISION
 * B4-A: `pdfUrl`/`answerSheetUrl` here are RELATIVE `/assets/:id` paths
 * (tenant-scoped, Bearer-JWT protected), NOT the transient presigned URLs
 * a presigned MinIO URL would carry. This is the single source of truth for
 * the versions screen's download links — see `ExamVersionsService.listVersions`.
 */
export interface ExamVersion {
  readonly code: string;
  readonly pdfUrl: string;
  readonly answerSheetUrl: string;
}
