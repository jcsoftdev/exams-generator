import { Difficulty } from '@exams-generator/shared';
import type { BankQuestionDto } from '@exams-generator/shared';

/**
 * The catalog and its labels are re-exported, not re-declared: the codes are a
 * contract shared with the API (`@exams-generator/shared`) and the Spanish
 * labels live once in the taxonomy feature. This file used to hold its own copy
 * of both, with a comment promising to promote them "if/when the bank module
 * needs the same catalog" — it did (audit 2026-08-20, M4).
 */
export { GRADE_LEVELS } from '@exams-generator/shared';
export type { GradeLevel } from '@exams-generator/shared';
export { GRADE_LEVEL_LABELS } from '../taxonomy/grade-level-labels';

/**
 * The wire shape of `GET /bank/questions` (and its paginated/single-question
 * siblings) comes from `@exams-generator/shared`, which the API compiles
 * against too — re-exported here so this feature keeps its own vocabulary
 * while there is only ONE declaration of the contract. It used to be
 * `QuestionListItem` on the API's `bank.repository.ts` and `BankQuestion`
 * here, redeclared field-by-field with nothing to catch a rename crossing the
 * wire (audit 2026-08-21, M4b). See `BankQuestionDto`'s own doc for the real
 * drift that comparison turned up (a wrongly-optional `status`/`type`, and an
 * imprecise `alternatives: unknown` on the API side).
 */
export type { QuestionStatus, BankQuestionDto } from '@exams-generator/shared';

export type QuestionOrigin = 'school' | 'ai' | 'central';

/**
 * `GET /bank/questions` returns the bare `imageAssetId` (the asset row's
 * UUID), not a URL or mime type/dimensions. `GET /assets/:id` serves the
 * actual bytes — see `BankService.buildImageAssetUrl`/`fetchQuestionImage`.
 *
 * Nothing local is added on top of the wire contract any more. `origin` and
 * `usedInExamCount` used to be optional fields here that the API never sent:
 * `usedInExamCount` is now really counted and part of the contract, and
 * `origin` is derived below rather than transmitted (audit 2026-08-21, M13).
 */
export type BankQuestion = BankQuestionDto;

/**
 * Where a question came from, computed from the two fields that actually
 * decide it.
 *
 * A question with no tenant belongs to the central bank; one a tenant owns is
 * theirs, authored either by a teacher or by the AI. Deriving beats shipping a
 * fourth field that has to be kept consistent with the other two — and the
 * previous version of this, an optional `origin` the server never sent, meant
 * the "IA" tag in the bank list could never render.
 */
export function questionOrigin(question: BankQuestion): QuestionOrigin {
  if (question.tenantId === null) {
    return 'central';
  }
  return question.aiGenerated ? 'ai' : 'school';
}

/**
 * One row of `GET /bank/questions/summary` — mirrors `BankTopicQuestionCount`
 * in apps/api/src/modules/bank/domain/ports/bank-repository.port.ts.
 *
 * This is what the bank tree loads on entry INSTEAD of the question list:
 * enough to render Curso -> Tema with real counts, and not one byte of
 * question payload. `total` is the count under the SAME filters the summary
 * request carried, so it always equals what fetching that topic returns.
 *
 * `gradeLevel` is the TOPIC's own grade from the taxonomy (`topics.gradeLevel`
 * on the API), never derived from any question — it lets the bank tree label
 * two same-named topics by grade WITHOUT expanding either one (D2b). `null`
 * means the topic applies to the whole stage (unscoped).
 */
export interface BankTopicCount {
  readonly courseId: string;
  readonly topicId: string;
  readonly total: number;
  readonly gradeLevel: string | null;
}

/** S6: paginated envelope for `GET /bank/questions?page=&pageSize=`. */
export interface PagedQuestions {
  readonly items: readonly BankQuestion[];
  readonly total: number;
}

export interface BankQuestionFilters {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly gradeLevel?: string;
}

export interface CreateImageQuestionPayload {
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  readonly image: File;
}

/** Task 6: payload for `POST /bank/questions/structured` (JSON, no file). */
export interface CreateStructuredQuestionPayload {
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
}

/**
 * Task 7: `PATCH /bank/questions/:id` request body for the inline question
 * editor. NOTE: no `courseId` — the backend dropped it (see
 * `EditDraftQuestionBody` in apps/api/src/modules/bank/bank.controller.ts):
 * a question's course is derived from `topicId`, so moving a question to
 * another course means PATCHing `topicId`, not `courseId`.
 */
export interface UpdateQuestionPayload {
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly gradeLevel?: string;
  readonly correctAnswer?: string;
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
  readonly figureCode?: string;
}
