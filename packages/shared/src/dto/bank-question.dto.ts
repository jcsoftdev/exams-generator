import { Difficulty } from "../enums/difficulty.enum";
import { QuestionType } from "./exam.dto";

/**
 * Lifecycle of a bank question, as the client sees it — `questions.status` in
 * the database: `draft` (only reachable via AI generation, awaiting human
 * curation), `approved` (visible to blueprint selection), `archived`
 * (soft-removed, S9).
 *
 * The database column is driven by `QUESTION_STATUSES` in the API's schema
 * (`db/schema/enums.ts`), which cannot be imported here — `packages/shared`
 * must not depend on the API. The two lists are kept honest by a test on the
 * API side that compares them, same pattern as `EXAM_VERSION_JOB_STATUSES`.
 */
export const QUESTION_STATUSES = ["draft", "approved", "archived"] as const;

export type QuestionStatus = (typeof QUESTION_STATUSES)[number];

/**
 * One row of `GET /bank/questions` (and its paginated/single-question
 * siblings `GET /bank/questions/:id`, `PATCH /bank/questions/:id`).
 *
 * Declared here rather than twice — it was `QuestionListItem` in the API's
 * `bank-repository.port.ts` and `BankQuestion` in the web's `bank.models.ts`,
 * with nothing tying a field renamed on one side to a compile failure on the
 * other (audit 2026-08-21, M4b). Comparing the two turned up real drift, not
 * just a naming difference:
 *
 * - `status` and `type` were typed OPTIONAL on the web side, with a comment
 *   blaming the legacy unpaginated `GET /bank/questions` shape for omitting
 *   them. Reading `BankRepository.listQuestions` shows both overloads
 *   (paginated and not) select the exact same column set — neither field is
 *   ever actually missing. They are REQUIRED here, matching reality.
 * - `alternatives` is `unknown` on `QuestionListItem` (a raw Postgres jsonb
 *   column, untyped by Drizzle without an explicit `$type`). Every write path
 *   that populates it (`createStructuredQuestion`, `updateStructuredQuestion`)
 *   stores a plain string array, and every read path that consumes it
 *   (`bank.service.ts`) immediately casts it `as readonly string[]` — so the
 *   value that actually crosses the wire is `readonly string[] | null`, not
 *   `unknown`. `QuestionListItem` keeps the looser storage type on purpose
 *   (seeing `unknown` there is the honest description of what the jsonb
 *   column guarantees); this DTO narrows it to what is actually sent.
 * - `aiGenerated` and `figureCode` always crossed the wire (the repository
 *   selects them unconditionally and the controller returns the row
 *   unmodified) but the web had never declared them. They are part of the
 *   contract now: `aiGenerated` is what lets the client tell an AI-authored
 *   question from a school-authored one.
 * - `usedInExamCount` is the opposite case: the web declared it and NOTHING
 *   ever sent it, so the "used in N exams" warning could not fire (audit
 *   2026-08-21, M13). The repository now counts it on every read path.
 * - `origin` stays out on purpose. It is DERIVED, not stored — central when
 *   the question has no tenant, ai when it was AI-authored, school otherwise
 *   — and a derived field on the wire is a second thing to keep in sync with
 *   the two fields it is computed from. The web computes it (`questionOrigin`
 *   in `bank.models.ts`).
 */
export interface BankQuestionDto {
  readonly id: string;
  readonly tenantId: string | null;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  readonly type: QuestionType;
  readonly status: QuestionStatus;
  readonly imageAssetId: string | null;
  readonly bodyTypst: string | null;
  readonly alternatives: readonly string[] | null;
  readonly figureCode: string | null;
  readonly sourceName: string | null;
  readonly aiGenerated: boolean;
  /** Exams that already contain this question — 0, never absent. */
  readonly usedInExamCount: number;
}
