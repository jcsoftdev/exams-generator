/**
 * "¿Cuántas formas?" (design doc §5.2) — the only counts the product offers.
 *
 * Shared by the two screens that can start a generation: the versions panel
 * (regenerate) and the exam builder (first generation). The builder used to
 * hardcode 2 with no way to change it, so a teacher who wanted 4 had to
 * generate 2 and then regenerate — a wasted compile plus a danger modal
 * (audit 2026-08-15). One catalog so the two screens can't drift.
 */
export const VERSION_COUNT_OPTIONS: readonly number[] = [2, 3, 4, 5];
export const DEFAULT_VERSION_COUNT = 2;

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
