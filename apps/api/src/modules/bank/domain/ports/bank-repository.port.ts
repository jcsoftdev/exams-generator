import { Difficulty } from "@exams-generator/shared";
import { QuestionStatus, QuestionType } from "../../../../db/schema/enums";

/**
 * The persistence port for the bank module. `BankRepository` (the Drizzle
 * adapter) implements this; the data-contract types live here in the domain
 * rather than in the adapter. For backward compatibility the adapter
 * re-exports every type below, so existing
 * `import { XRecord } from "./bank.repository"` sites keep resolving.
 */

export interface CreateImageQuestionRecord {
  readonly tenantId: string | null;
  readonly topicId: string;
  /** Optional fine-grained classification under `topicId` (canonical topic taxonomy). */
  readonly subtopicId?: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  /**
   * Where this question came from, for the questions the seeders ingest from
   * published exams. NULL for anything authored in the app. Stored so that
   * "pull every question from this source" stays a query when its licensing
   * changes — see `questions.schema.ts`.
   */
  readonly sourceUrl?: string;
  readonly sourceName?: string;
  readonly createdBy: string;
  readonly image: {
    readonly storageKey: string;
    readonly mime: string;
    readonly width?: number;
    readonly height?: number;
  };
}

export interface CreateStructuredQuestionRecord {
  readonly tenantId: string | null;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly bodyTypst: string;
  /** `hashBodyTypst(bodyTypst)` — computed by the service, persisted as-is here. */
  readonly bodyHash: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly figureCode: string | undefined;
  /**
   * Where this question came from, for the questions the seeders ingest from
   * published exams. NULL for anything authored in the app. Stored so that
   * "pull every question from this source" stays a query when its licensing
   * changes — see `questions.schema.ts`.
   */
  readonly sourceUrl?: string;
  readonly sourceName?: string;
  readonly createdBy: string;
  /**
   * Defaults to `'approved'` (manual creation is curated by definition).
   * The AI generation flow (Lane D3) passes `'draft'` explicitly — the AI
   * NEVER publishes directly to the bank.
   */
  readonly status?: QuestionStatus;
  /** Defaults to `false`. `true` only for AI-generated drafts (Lane D3). */
  readonly aiGenerated?: boolean;
}

export interface UpdateStructuredQuestionRecord {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly figureCode: string | undefined;
}

/**
 * One row of `GET /bank/questions` and its single-question siblings.
 *
 * The wire contract this crosses the HTTP boundary as is `BankQuestionDto`
 * (`@exams-generator/shared`), pinned against this type by
 * `bank-question-contract.spec.ts` — see that file, and the DTO's own doc,
 * for the differences found comparing this to the web's old separately
 * declared `BankQuestion` (audit 2026-08-21, M4b):
 *
 * - `aiGenerated` and `figureCode` DO cross the wire (selected unconditionally,
 *   returned unmodified) but aren't part of the shared DTO — the web's type
 *   never declared them, so this stays wider on purpose, same shape as
 *   `ExamVersionJobRecord` carrying storage-only fields `ExamVersionJob` omits.
 * - `alternatives` stays `unknown` here: it's a raw jsonb column with no
 *   Drizzle `$type`, so `unknown` is the honest static type of what Drizzle
 *   hands back. The DTO narrows it to `readonly string[] | null`, which is
 *   what every write path actually stores and every read path already casts
 *   it to (see `bank.service.ts`).
 */
export interface QuestionListItem {
  readonly id: string;
  readonly tenantId: string | null;
  readonly courseId: string;
  readonly topicId: string;
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
  readonly type: QuestionType;
  readonly status: QuestionStatus;
  readonly aiGenerated: boolean;
  readonly imageAssetId: string | null;
  readonly bodyTypst: string | null;
  readonly alternatives: unknown;
  readonly figureCode: string | null;
  /** Provenance, when the question came from a seeded source. */
  readonly sourceName: string | null;
  /**
   * The tenant folder this question is filed under, or `null` (unfiled, or a
   * central-bank question). Selected by `listQuestions` and `findQuestionById`
   * — the two read paths `BankQuestionDto.folderId` is documented to always
   * carry. The three update-returning methods below (`updateStructuredQuestion`
   * and friends) do not yet select it — same pre-existing gap `usedInExamCount`
   * has on those paths, out of scope here.
   */
  readonly folderId: string | null;
}

export interface QuestionListFilter {
  /** The requesting user's own tenant (null = platform staff). */
  readonly currentTenantId: string | null;
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly gradeLevel?: string;
  readonly status?: QuestionStatus;
}

/** S6: opt-in pagination for `listQuestions` — 1-indexed page, clamped by the caller (controller). */
export interface QuestionListPagination {
  readonly page: number;
  readonly pageSize: number;
}

/** One `{difficulty, status}` bucket from `countByDifficultyAndStatus` — feeds the dashboard's bank card. */
export interface BankStatusDifficultyCount {
  readonly difficulty: Difficulty;
  readonly status: QuestionStatus;
  readonly total: number;
}

/**
 * One `{courseId, topicId, total, gradeLevel}` bucket from
 * `countByCourseAndTopic` — feeds the web bank tree's lazy skeleton (`GET
 * /bank/questions/summary`). Deliberately carries NO question payload: the
 * whole point is that the tree can render Curso -> Tema with real counts
 * while a topic's leaves are only fetched when that topic is expanded.
 *
 * `gradeLevel` is the TOPIC's own grade from `topics.grade_level` (the
 * taxonomy scoping — see `topics.schema.ts`), NEVER derived from the
 * questions counted in `total`: a topic can hold questions tagged with any
 * grade (or none), so the topic's own grade is the only value stable enough
 * to label a collapsed tree branch with. `null` means the topic applies to
 * the whole stage (unscoped), same as `topics.grade_level IS NULL`.
 */
export interface BankTopicQuestionCount {
  readonly courseId: string;
  readonly topicId: string;
  readonly total: number;
  readonly gradeLevel: string | null;
}

/** Persistence port for the bank module — implemented by `BankRepository`. */
export interface BankRepositoryPort {
  createImageQuestion(record: CreateImageQuestionRecord): Promise<{ id: string }>;
  createStructuredQuestion(record: CreateStructuredQuestionRecord): Promise<{ id: string }>;
  listQuestions(filter: QuestionListFilter): Promise<QuestionListItem[]>;
  listQuestions(
    filter: QuestionListFilter,
    pagination: QuestionListPagination,
  ): Promise<{ items: QuestionListItem[]; total: number }>;
  /**
   * Per-topic question totals under the SAME visibility rule and the SAME
   * filters `listQuestions` applies — so a bucket's `total` is exactly the
   * number of rows a `listQuestions` call with `{...filter, topicId}` would
   * return. That equality is load-bearing: the web tree renders these counts
   * next to a topic and then fetches that topic's questions on expand, and a
   * count that disagreed with the fetch would surface as a phantom "Ver más".
   */
  countByCourseAndTopic(filter: QuestionListFilter): Promise<BankTopicQuestionCount[]>;
  findQuestionById(id: string, currentTenantId: string | null): Promise<QuestionListItem | undefined>;
  /**
   * Scoped to the SAME `tenantId` the new row would be written to (not the
   * central+tenant visibility OR) — a duplicate only matters within the
   * exact bank (central, or one tenant's own) being written into.
   */
  findByBodyHash(tenantId: string | null, bodyHash: string): Promise<{ id: string } | undefined>;

  /**
   * Duplicate check for `type = 'image'` questions, which have no `bodyTypst`
   * and so no `body_hash` to collide on. Their identity is the provenance
   * string the seeder writes (exam, subject, question number), which is what
   * makes re-running a seeding run idempotent.
   */
  findBySourceName(tenantId: string | null, sourceName: string): Promise<{ id: string } | undefined>;
  findCourseAndTopicNames(
    courseId: string,
    topicId: string,
  ): Promise<{ courseName: string; topicName: string } | undefined>;
  approveQuestion(
    id: string,
    currentTenantId: string | null,
  ): Promise<{ id: string; status: QuestionStatus } | undefined>;
  rejectQuestion(id: string, currentTenantId: string | null): Promise<boolean>;
  updateStructuredQuestion(
    id: string,
    currentTenantId: string | null,
    patch: UpdateStructuredQuestionRecord,
  ): Promise<QuestionListItem | undefined>;
  topicExists(topicId: string): Promise<boolean>;
  /**
   * The subtopic's own `topic_id`, or `undefined` if `subtopicId` doesn't
   * exist. Lets callers validate a `subtopicId` belongs to the request's
   * `topicId` before persisting (design doc: bank create validation, review
   * fix) — a mismatched pair would otherwise write an inconsistent
   * `question.topic_id`/`subtopic.topic_id` row.
   */
  getSubtopicTopicId(subtopicId: string): Promise<string | undefined>;
  updateStructuredQuestionAndTaxonomy(
    id: string,
    currentTenantId: string | null,
    contentPatch: UpdateStructuredQuestionRecord,
    taxonomyPatch: { topicId?: string; difficulty?: string; gradeLevel?: string },
  ): Promise<QuestionListItem | undefined>;
  updateImageQuestionTaxonomyAndCorrectAnswer(
    id: string,
    currentTenantId: string | null,
    patch: { correctAnswer?: string; topicId?: string; difficulty?: string; gradeLevel?: string },
  ): Promise<QuestionListItem | undefined>;
  replaceImageAsset(
    id: string,
    currentTenantId: string | null,
    image: { readonly storageKey: string; readonly mime: string },
  ): Promise<string | undefined>;
  /**
   * All-or-nothing re-attachment of a structured question's per-alternative
   * images — each entry names the slot it belongs to. Replaces the FULL
   * existing set (delete+insert in a transaction) rather than patching
   * individual slots, since a partial patch could leave a stale image on a
   * slot the caller meant to clear. Slots not named in `images` end up with
   * no image, which is how a question with drawings on only some
   * alternatives is stored. Same tenant-visibility scoping as
   * `replaceImageAsset`.
   */
  setAlternativeImages(
    id: string,
    currentTenantId: string | null,
    images: readonly {
      readonly storageKey: string;
      readonly mime: string;
      readonly alternativeIndex: number;
    }[],
  ): Promise<string | undefined>;
  updateStatus(id: string, status: QuestionStatus): Promise<void>;
  deleteQuestion(id: string): Promise<void>;
  countByDifficultyAndStatus(tenantId: string | null): Promise<BankStatusDifficultyCount[]>;
}
