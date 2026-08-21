import { Difficulty } from "../enums/difficulty.enum";

/**
 * Lifecycle of an exam, as the client sees it — `exams.status` in the
 * database: `draft` while the blueprint/selection is still editable,
 * `ready` once confirmed and locked (S4 rename, replace-question, etc. all
 * gate on this).
 *
 * The database column is driven by `EXAM_STATUSES` in the API's schema,
 * which cannot be imported here — `packages/shared` must not depend on
 * the API. The two lists are kept honest by a test on the API side that
 * compares them (`exam-contract.spec.ts`), same pattern as
 * `EXAM_VERSION_JOB_STATUSES`.
 */
export const EXAM_STATUSES = ["draft", "ready"] as const;

export type ExamStatus = (typeof EXAM_STATUSES)[number];

/**
 * `image`: MVP — a full statement + alternatives baked into one image; only
 * the correct-answer letter is stored separately, and alternatives are
 * never shuffled (impossible by format).
 * `structured`: Typst markup body + a JSON alternatives array; alternatives
 * ARE shuffled per version.
 *
 * Mirrors `questions.type` — same can't-import-the-API-schema constraint as
 * `EXAM_STATUSES` above, pinned the same way in `exam-contract.spec.ts`.
 */
export const QUESTION_TYPES = ["image", "structured"] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * One row in the `GET /exams` (S1) response `items` array —
 * `questionCount`/`versionCount` are correlated counts, not a hint to join
 * on client side.
 *
 * Declared here rather than twice — it was `ExamListItem` in the web's
 * `exams.models.ts` and `ExamListItem` again in the API's
 * `domain/ports/exams-repository.port.ts`, with `status` typed as a bare
 * `string` on the API side, so nothing stopped that copy from drifting
 * away from `EXAM_STATUSES` (audit 2026-08-21, M4b).
 */
export interface ExamListItem {
  readonly id: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly status: ExamStatus;
  readonly questionCount: number;
  readonly versionCount: number;
  readonly createdAt: string;
}

/** `GET /exams` (S1) response. */
export interface ExamListResult {
  readonly items: readonly ExamListItem[];
  readonly total: number;
}

/**
 * One selected question in the `GET /exams/:examId` (design doc §5.3/§5.4
 * review screen) detail response. `type='image'` questions carry
 * `imageAssetId` (`bodyTypst`/`alternatives`/`figureCode` are `null`);
 * `type='structured'` questions carry `bodyTypst`/`alternatives`/
 * `figureCode` instead (`imageAssetId` is `null`).
 */
export interface ExamDetailQuestion {
  readonly id: string;
  readonly position: number;
  readonly type: QuestionType;
  readonly courseId: string;
  /** Display name for `courseId` — the review screen renders this, never the uuid (audit 2026-08-15). */
  readonly courseName: string;
  readonly topicId: string;
  /** Display name for `topicId` — same reason as `courseName`. */
  readonly topicName: string;
  readonly difficulty: Difficulty;
  readonly correctAnswer: string;
  readonly imageAssetId: string | null;
  readonly bodyTypst: string | null;
  readonly alternatives: readonly string[] | null;
  readonly figureCode: string | null;
}

/**
 * `GET /exams/:examId` response — the exam header plus its full selection,
 * ordered by position.
 *
 * Declared here rather than twice — it was `ExamDetail`/`ExamDetailQuestion`
 * in the web's `exams.models.ts` and `ExamDetailRecord`/
 * `ExamDetailQuestionRecord` in the API's
 * `domain/ports/exams-repository.port.ts`, with nothing tying a field
 * renamed on one side to a compile failure on the other (audit 2026-08-21,
 * M4b).
 *
 * Unlike `ExamVersionJob`, neither record carries a storage-only field on
 * top of this — the query that builds them already projects exactly this
 * shape, so the API's own type is a plain alias of this one instead of a
 * wider sibling with a compile-assertion test.
 */
export interface ExamDetail {
  readonly id: string;
  readonly title: string;
  readonly gradeLevel: string;
  readonly status: ExamStatus;
  readonly questions: readonly ExamDetailQuestion[];
}
