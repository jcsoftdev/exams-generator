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
  readonly difficulty: Difficulty;
  readonly gradeLevel: string;
  readonly correctAnswer: string;
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
  readonly alternatives: readonly string[];
  readonly correctAnswer: string;
  readonly figureCode: string | undefined;
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

/** Persistence port for the bank module — implemented by `BankRepository`. */
export interface BankRepositoryPort {
  createImageQuestion(record: CreateImageQuestionRecord): Promise<{ id: string }>;
  createStructuredQuestion(record: CreateStructuredQuestionRecord): Promise<{ id: string }>;
  listQuestions(filter: QuestionListFilter): Promise<QuestionListItem[]>;
  listQuestions(
    filter: QuestionListFilter,
    pagination: QuestionListPagination,
  ): Promise<{ items: QuestionListItem[]; total: number }>;
  findQuestionById(id: string, currentTenantId: string | null): Promise<QuestionListItem | undefined>;
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
  updateStatus(id: string, status: QuestionStatus): Promise<void>;
  deleteQuestion(id: string): Promise<void>;
  countByDifficultyAndStatus(tenantId: string | null): Promise<BankStatusDifficultyCount[]>;
}
