/**
 * Mirrors `GeneratedVersionResult` returned by
 * `POST /exams/:examId/versions` (Lane B exams module). `pdfUrl` and
 * `answerSheetUrl` are direct (MinIO presigned) download URLs.
 */
export interface GeneratedVersionResult {
  readonly code: string;
  readonly pdfUrl: string;
  readonly answerSheetUrl: string;
}

/**
 * Shape of the 422 error body returned when the exam has insufficient
 * questions or a Typst compile failure occurs. `questionId` is only present
 * when the failure is attributable to a specific question.
 */
export interface GenerateVersionsErrorPayload {
  readonly message: string;
  readonly examId: string;
  readonly questionId?: string;
}

/**
 * Mirrors the `GET /exams/:examId/versions` (B4) response row — DECISION
 * B4-A: `pdfUrl`/`answerSheetUrl` here are RELATIVE `/assets/:id` paths
 * (tenant-scoped, Bearer-JWT protected), NOT the transient presigned URLs
 * `GeneratedVersionResult` carries. This is the single source of truth for
 * the versions screen's download links — see `ExamVersionsService.listVersions`.
 */
export interface ExamVersion {
  readonly code: string;
  readonly pdfUrl: string;
  readonly answerSheetUrl: string;
}
