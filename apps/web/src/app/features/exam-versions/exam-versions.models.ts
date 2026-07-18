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
