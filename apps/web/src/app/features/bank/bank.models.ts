import { Difficulty } from '@exams-generator/shared';

/**
 * LOCAL grade-level catalog for apps/web's bank feature.
 *
 * Mirrors the fixed backend catalog defined in
 * apps/api/src/modules/exams/domain/value-objects/grade-level.ts (1ro-6to
 * primaria, 1ro-5to secundaria, pre). That file is NOT exported from
 * @exams-generator/shared yet — its own comment flags it should be promoted
 * "if/when the bank module needs the same catalog", which is exactly this
 * feature. Kept as a local duplicate (same pattern as auth.models.ts) until
 * that promotion happens; replace this with a shared import once it does.
 */
export const GRADE_LEVELS = [
  'primaria_1',
  'primaria_2',
  'primaria_3',
  'primaria_4',
  'primaria_5',
  'primaria_6',
  'secundaria_1',
  'secundaria_2',
  'secundaria_3',
  'secundaria_4',
  'secundaria_5',
  'pre',
] as const;

export type GradeLevel = (typeof GRADE_LEVELS)[number];

export const GRADE_LEVEL_LABELS: Record<GradeLevel, string> = {
  primaria_1: '1° primaria',
  primaria_2: '2° primaria',
  primaria_3: '3° primaria',
  primaria_4: '4° primaria',
  primaria_5: '5° primaria',
  primaria_6: '6° primaria',
  secundaria_1: '1° secundaria',
  secundaria_2: '2° secundaria',
  secundaria_3: '3° secundaria',
  secundaria_4: '4° secundaria',
  secundaria_5: '5° secundaria',
  pre: 'Pre-admisión',
};

/**
 * Mirrors `QuestionListItem` from apps/api/src/modules/bank/bank.repository.ts.
 *
 * `GET /bank/questions` returns the bare `imageAssetId` (the asset row's
 * UUID), not a URL or mime type/dimensions. `GET /assets/:id` serves the
 * actual bytes — see `BankService.buildImageAssetUrl`/`fetchQuestionImage`.
 */
export type QuestionStatus = 'draft' | 'approved' | 'archived';
export type QuestionOrigin = 'school' | 'ai' | 'central';

export interface BankQuestion {
  readonly id: string;
  readonly tenantId: string | null;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  readonly imageAssetId: string | null;
  /**
   * Optional (retro-compat): the unpaginated `GET /bank/questions` legacy
   * shape doesn't send these. Populated by the paginated Task 5 flow — see
   * GAP backend #3 in the plan (`docs/superpowers/plans/2026-07-18-screens-frontend.md`)
   * re: `origin` deriving from `tenantId === null` (never truly `'ai'` yet).
   */
  readonly status?: QuestionStatus;
  readonly type?: 'image' | 'structured';
  readonly origin?: QuestionOrigin;
  readonly usedInExamCount?: number;
  /**
   * Structured (`type: 'structured'`) questions carry their statement +
   * options directly on the row (`image` questions leave these `null`).
   * `GET /bank/questions` returns them (see `QuestionListItem` in
   * apps/api/src/modules/bank/bank.repository.ts) — the bank UI renders them
   * so text questions aren't shown as blank cards.
   */
  readonly bodyTypst?: string | null;
  readonly alternatives?: readonly string[] | null;
  /**
   * Where a seeded question came from ("UNCP — Admisión 2021-I, Álgebra,
   * pregunta 4"). Load-bearing in the list: an `image` question has no
   * statement, so without this its row can only show its answer letter, and a
   * topic full of them reads as a wall of identical rows.
   */
  readonly sourceName?: string | null;
}

/**
 * One row of `GET /bank/questions/summary` — mirrors `BankTopicQuestionCount`
 * in apps/api/src/modules/bank/domain/ports/bank-repository.port.ts.
 *
 * This is what the bank tree loads on entry INSTEAD of the question list:
 * enough to render Curso -> Tema with real counts, and not one byte of
 * question payload. `total` is the count under the SAME filters the summary
 * request carried, so it always equals what fetching that topic returns.
 */
export interface BankTopicCount {
  readonly courseId: string;
  readonly topicId: string;
  readonly total: number;
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
