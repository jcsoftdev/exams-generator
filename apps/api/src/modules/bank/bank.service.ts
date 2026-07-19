import { randomUUID } from "node:crypto";
import { Difficulty } from "@exams-generator/shared";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { PdfCompilerPort, TypstCompilationError } from "../exams/domain/ports/pdf-compiler.port";
import { StoragePort } from "../exams/domain/ports/storage.port";
import { QuestionStatus } from "../../db/schema/enums";
import { PDF_COMPILER_PORT, STORAGE_PORT } from "./bank.constants";
import { BankRepository, QuestionListItem, QuestionListPagination } from "./bank.repository";
import { canManageQuestionTenant } from "./domain/can-manage-question-tenant";
import { compilePreviewFromContent } from "./domain/compile-preview-from-content";
import { validateCreateImageQuestionInput } from "./domain/validate-create-image-question";
import { validateCreateStructuredQuestionInput } from "./domain/validate-create-structured-question";
import { validateQuestionTaxonomy } from "./domain/validate-question-taxonomy";
import { validateUpdateStructuredQuestionInput } from "./domain/validate-update-structured-question";

/**
 * Central-vs-tenant authorization gate (design doc §2), shared by every
 * write path in this service. Throws `ForbiddenException` naming which
 * side of the split was violated. See `domain/can-manage-question-tenant.ts`
 * for the underlying (pure, unit-tested) rule.
 */
function assertCanManageTenant(role: AuthTokenPayload["role"], targetTenantId: string | null): void {
  if (canManageQuestionTenant(role, targetTenantId)) {
    return;
  }
  throw new ForbiddenException(
    targetTenantId === null
      ? "Only platform staff (platform_admin, content_editor) can manage the central question bank"
      : "Only school staff (school_admin, teacher) can manage a tenant's private questions",
  );
}

export interface CreateImageQuestionDto {
  readonly courseId: string | undefined;
  readonly topicId: string | undefined;
  readonly difficulty: string | undefined;
  readonly gradeLevel: string | undefined;
  readonly correctAnswer: string | undefined;
  readonly file: Express.Multer.File | undefined;
}

export interface CreateStructuredQuestionDto {
  readonly courseId: string | undefined;
  readonly topicId: string | undefined;
  readonly difficulty: string | undefined;
  readonly gradeLevel: string | undefined;
  readonly bodyTypst: string | undefined;
  readonly alternatives: readonly string[] | undefined;
  readonly correctAnswer: string | undefined;
  readonly figureCode: string | undefined;
}

/**
 * `courseId` is intentionally NOT editable here — `questions` has no
 * `course_id` column; course is always derived by joining `topics.course_id`
 * through `topicId`. To move a question to a different course, change its
 * `topicId` to a topic that belongs to that course.
 */
export interface EditQuestionDto {
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
  readonly correctAnswer?: string;
  readonly figureCode?: string;
  readonly topicId?: string;
  readonly difficulty?: string;
  readonly gradeLevel?: string;
}

export interface ListQuestionsQuery {
  readonly courseId?: string;
  readonly topicId?: string;
  readonly difficulty?: Difficulty;
  readonly gradeLevel?: string;
  readonly status?: QuestionStatus;
}

/**
 * Hard cap on `BankService.previewCache` entries. Each entry holds a
 * compiled PDF `Buffer`, so an unbounded cache is an unbounded memory leak
 * as distinct questions get previewed over the process lifetime. 50 is
 * generous for a single-question preview cache (bounded working set of
 * "questions someone is actively iterating on") while capping worst-case
 * memory.
 */
const MAX_PREVIEW_CACHE = 50;

/**
 * Orchestrates the manual image-question upload flow (design doc 5.1),
 * tenant-scoped listing, and the human-review side of the AI draft workflow
 * (Lane D3, design doc §5.2: approve/reject/edit a `status='draft'`
 * question). Validation happens BEFORE the storage upload so a rejected
 * request never leaves an orphaned object in MinIO.
 */
@Injectable()
export class BankService {
  /**
   * S7: in-memory Typst-compile cache for single-question previews, keyed by
   * question id. Deliberately NOT persisted/shared across instances — a
   * cold cache just means one extra Typst compile, never a correctness
   * issue. Invalidated in `editQuestion` on every successful edit so a
   * re-fetched preview never serves a stale compile. Bounded to
   * `MAX_PREVIEW_CACHE` entries with FIFO eviction (see `previewQuestion`) —
   * a `Map` preserves insertion order, so `.keys().next().value` is always
   * the oldest entry.
   */
  private readonly previewCache = new Map<string, Buffer>();

  constructor(
    private readonly repository: BankRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(PDF_COMPILER_PORT) private readonly pdfCompiler: PdfCompilerPort,
  ) {}

  async createImageQuestion(
    user: AuthTokenPayload,
    dto: CreateImageQuestionDto,
  ): Promise<{ id: string }> {
    assertCanManageTenant(user.role, user.tenantId);

    const validation = validateCreateImageQuestionInput({
      courseId: dto.courseId,
      topicId: dto.topicId,
      difficulty: dto.difficulty,
      gradeLevel: dto.gradeLevel,
      correctAnswer: dto.correctAnswer,
      hasImage: Boolean(dto.file),
    });

    if (!validation.ok) {
      throw new BadRequestException(validation.errors);
    }

    const file = dto.file as Express.Multer.File;
    const storageKey = `bank/questions/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    return this.repository.createImageQuestion({
      tenantId: user.tenantId,
      topicId: dto.topicId as string,
      difficulty: dto.difficulty as Difficulty,
      gradeLevel: dto.gradeLevel as string,
      correctAnswer: dto.correctAnswer as string,
      createdBy: user.sub,
      image: { storageKey, mime: file.mimetype },
    });
  }

  /**
   * Manual structured-question creation (Lane D2). No storage upload — the
   * statement/alternatives/figure are stored directly on the question row.
   * `status = 'approved'` for the same reason as `createImageQuestion`: a
   * manually-created structured question is curated by definition. The
   * AI-generated draft flow (`status = 'draft'`) is a separate lane, out of
   * scope here.
   */
  async createStructuredQuestion(
    user: AuthTokenPayload,
    dto: CreateStructuredQuestionDto,
  ): Promise<{ id: string }> {
    assertCanManageTenant(user.role, user.tenantId);

    const validation = validateCreateStructuredQuestionInput({
      courseId: dto.courseId,
      topicId: dto.topicId,
      difficulty: dto.difficulty,
      gradeLevel: dto.gradeLevel,
      bodyTypst: dto.bodyTypst,
      alternatives: dto.alternatives,
      correctAnswer: dto.correctAnswer,
      figureCode: dto.figureCode,
    });

    if (!validation.ok) {
      throw new BadRequestException(validation.errors);
    }

    return this.repository.createStructuredQuestion({
      tenantId: user.tenantId,
      topicId: dto.topicId as string,
      difficulty: dto.difficulty as Difficulty,
      gradeLevel: dto.gradeLevel as string,
      bodyTypst: dto.bodyTypst as string,
      alternatives: dto.alternatives as readonly string[],
      correctAnswer: dto.correctAnswer as string,
      figureCode: dto.figureCode,
      createdBy: user.sub,
    });
  }

  /**
   * S6: `pagination` is opt-in — retro-compat with existing web consumers
   * (`bank.service.ts`, `ai.service.ts`'s `listDrafts`) means omitting it
   * MUST keep returning the flat `QuestionListItem[]` this always returned.
   * Only passing `pagination` switches to the `{ items, total }` envelope.
   */
  async listQuestions(user: AuthTokenPayload, query: ListQuestionsQuery): Promise<QuestionListItem[]>;
  async listQuestions(
    user: AuthTokenPayload,
    query: ListQuestionsQuery,
    pagination: QuestionListPagination,
  ): Promise<{ items: QuestionListItem[]; total: number }>;
  async listQuestions(
    user: AuthTokenPayload,
    query: ListQuestionsQuery,
    pagination?: QuestionListPagination,
  ): Promise<QuestionListItem[] | { items: QuestionListItem[]; total: number }> {
    const filters = {
      currentTenantId: user.tenantId,
      courseId: query.courseId,
      topicId: query.topicId,
      difficulty: query.difficulty,
      gradeLevel: query.gradeLevel,
      status: query.status,
    };

    if (!pagination) {
      return this.repository.listQuestions(filters);
    }
    return this.repository.listQuestions(filters, pagination);
  }

  /**
   * Direct-by-id fetch (release gate: id enumeration guard). Scoped to the
   * requester's own tenant via the SAME visibility rule `listQuestions`
   * uses. A question that exists but belongs to another tenant is
   * indistinguishable from a non-existent one — both throw 404 — so IDs
   * can't be used to probe for another tenant's private questions.
   */
  async getQuestionById(user: AuthTokenPayload, id: string): Promise<QuestionListItem> {
    const question = await this.repository.findQuestionById(id, user.tenantId);
    if (!question) {
      throw new NotFoundException(`Question not found: ${id}`);
    }
    return question;
  }

  /**
   * Fetches the question (404 if not found/not visible), asserts the
   * requester's role is allowed to MANAGE it (403 — central bank drafts are
   * staff-only even though tenants can VIEW them, design doc §2), and
   * asserts it's still `status='draft'` (409 otherwise) — shared
   * precondition for approve/reject, both of which only ever act on drafts.
   */
  private async requireVisibleDraft(
    user: AuthTokenPayload,
    id: string,
  ): Promise<QuestionListItem> {
    const question = await this.repository.findQuestionById(id, user.tenantId);
    if (!question) {
      throw new NotFoundException(`Question not found: ${id}`);
    }
    assertCanManageTenant(user.role, question.tenantId);
    if (question.status !== "draft") {
      throw new ConflictException(`Question ${id} is not a draft (status=${question.status})`);
    }
    return question;
  }

  /**
   * Edit precondition (broader than requireVisibleDraft): a question the caller
   * can MANAGE and that is still editable content-wise — `draft` OR `approved`
   * (never `archived`; never central-bank, which is read-only for tenants).
   */
  private async requireManageableQuestion(
    user: AuthTokenPayload,
    id: string,
  ): Promise<QuestionListItem> {
    const question = await this.repository.findQuestionById(id, user.tenantId);
    if (!question) {
      throw new NotFoundException(`Question not found: ${id}`);
    }
    assertCanManageTenant(user.role, question.tenantId);
    if (question.status === "archived") {
      throw new ConflictException(`Question ${id} is archived and cannot be edited`);
    }
    return question;
  }

  /**
   * Human curation step (Lane D3, design doc §5.2): draft -> approved. The
   * AI never publishes directly to the bank — this is the ONLY path a
   * question can take from `draft` to `approved`.
   */
  async approveQuestion(user: AuthTokenPayload, id: string): Promise<{ id: string }> {
    await this.requireVisibleDraft(user, id);

    const result = await this.repository.approveQuestion(id, user.tenantId);
    if (!result) {
      throw new NotFoundException(`Question not found: ${id}`);
    }
    return { id: result.id };
  }

  /**
   * Human curation step (Lane D3): rejects a draft by deleting it outright
   * (design doc §5.2 — rejected AI drafts are discarded, not archived).
   */
  async rejectQuestion(user: AuthTokenPayload, id: string): Promise<{ id: string }> {
    await this.requireVisibleDraft(user, id);

    const deleted = await this.repository.rejectQuestion(id, user.tenantId);
    if (!deleted) {
      throw new NotFoundException(`Question not found: ${id}`);
    }
    return { id };
  }

  /**
   * S7: single-question Typst PDF preview (versionLabel: "preview"),
   * in-memory cached by question id. Uses the SAME tenant-visibility rule as
   * `getQuestionById` (not `requireVisibleDraft`) — a preview is a read, not
   * a management action, and is available regardless of `status`
   * (draft/approved/archived). Only `type='structured'` questions compile a
   * Typst preview; an image question's "preview" IS the uploaded image, so
   * that's a 400 here — the front end renders the image directly instead.
   */
  async previewQuestion(user: AuthTokenPayload, id: string): Promise<Buffer> {
    const question = await this.repository.findQuestionById(id, user.tenantId);
    if (!question) {
      throw new NotFoundException(`Question not found: ${id}`);
    }
    if (question.type !== "structured" || !question.bodyTypst) {
      throw new BadRequestException("Preview is only available for structured questions");
    }

    const cached = this.previewCache.get(id);
    if (cached) {
      return cached;
    }

    try {
      const pdf = await compilePreviewFromContent(
        this.pdfCompiler,
        question.id,
        question.bodyTypst,
        (question.alternatives ?? []) as string[],
        question.figureCode ?? undefined,
      );
      if (this.previewCache.size >= MAX_PREVIEW_CACHE) {
        const oldestKey = this.previewCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.previewCache.delete(oldestKey);
        }
      }
      this.previewCache.set(id, pdf);
      return pdf;
    } catch (error) {
      if (error instanceof TypstCompilationError) {
        throw new BadRequestException(`Typst compile failed: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Human edit of a question's structured content AND/OR taxonomy — draft
   * (Lane D3: "un humano pueda editar el draft antes de aprobar") OR already
   * `approved` (post-approval correction, e.g. fixing a typo or reclassifying
   * a published question). Uses `requireManageableQuestion` (draft/approved,
   * never archived/central-read-only) rather than `requireVisibleDraft`.
   * Re-validates the merged content, then recompiles a Typst PREVIEW via
   * `PdfCompilerPort` — exactly like AI generation itself — so an edit can
   * never leave the question in an uncompilable state either. On a compile
   * failure, nothing is persisted. Taxonomy fields (`topicId`/`difficulty`/
   * `gradeLevel`; NOT `courseId` — see `EditQuestionDto`) are validated
   * separately (400 on failure). `topicId` and `gradeLevel` are FK columns,
   * so BEFORE any write this also checks `topicId` exists (DB) and
   * `gradeLevel` is a valid catalog value (`validateQuestionTaxonomy`,
   * in-memory) — a syntactically-valid-but-nonexistent value would otherwise
   * surface as an unmapped 500 from a raw Postgres FK error. The content
   * update and the taxonomy update are then persisted together via
   * `repository.updateStructuredQuestionAndTaxonomy`, in a single DB
   * transaction, so a taxonomy failure can never leave a partial (content
   * committed, taxonomy not) edit behind.
   */
  async editQuestion(
    user: AuthTokenPayload,
    id: string,
    dto: EditQuestionDto,
  ): Promise<QuestionListItem> {
    const question = await this.requireManageableQuestion(user, id);
    if (question.type !== "structured") {
      throw new BadRequestException("Only structured questions can be edited");
    }

    const validation = validateUpdateStructuredQuestionInput(dto, {
      bodyTypst: question.bodyTypst as string,
      alternatives: question.alternatives as readonly string[],
      correctAnswer: question.correctAnswer,
      figureCode: question.figureCode ?? undefined,
    });

    if (!validation.ok) {
      throw new BadRequestException(validation.errors);
    }

    const taxonomyValidation = validateQuestionTaxonomy({
      topicId: dto.topicId,
      difficulty: dto.difficulty,
      gradeLevel: dto.gradeLevel,
    });

    if (!taxonomyValidation.ok) {
      throw new BadRequestException(taxonomyValidation.errors);
    }

    if (dto.topicId !== undefined) {
      const topicExists = await this.repository.topicExists(dto.topicId);
      if (!topicExists) {
        throw new BadRequestException(`topicId does not exist: ${dto.topicId}`);
      }
    }

    const { merged } = validation;

    try {
      await this.pdfCompiler.compileExam({
        title: "Draft preview",
        versionLabel: "preview",
        questions: [
          {
            id,
            type: "structured",
            bodyTypst: merged.bodyTypst,
            alternatives: merged.alternatives,
            figureCode: merged.figureCode,
          },
        ],
      });
    } catch (error) {
      if (error instanceof TypstCompilationError) {
        throw new BadRequestException(`Typst compile failed: ${error.message}`);
      }
      throw error;
    }

    const updated = await this.repository.updateStructuredQuestionAndTaxonomy(id, user.tenantId, merged, {
      topicId: dto.topicId,
      difficulty: dto.difficulty,
      gradeLevel: dto.gradeLevel,
    });
    if (!updated) {
      throw new NotFoundException(`Question not found: ${id}`);
    }

    this.previewCache.delete(id);
    return updated;
  }

  /**
   * Task 2 (question editing): swaps an image question's backing image
   * asset. Reuses `requireManageableQuestion` — the SAME 404/403/409 gate
   * `editQuestion` uses — so only a draft/approved question the caller can
   * manage (never archived/central-read-only) is eligible. Only
   * `type='image'` questions have an image to replace (400 otherwise, mirror
   * of `previewQuestion`'s `type='structured'`-only check). Uploads the new
   * object to storage BEFORE writing to the DB, same ordering as
   * `createImageQuestion` (a rejected/failed DB write never leaves a
   * question referencing a missing DB row, though — unlike creation — an
   * orphaned MinIO object on a later DB failure is accepted here, same as
   * `createImageQuestion`'s tradeoff).
   */
  async replaceImage(
    user: AuthTokenPayload,
    id: string,
    file: Express.Multer.File,
  ): Promise<{ id: string }> {
    const question = await this.requireManageableQuestion(user, id);
    if (question.type !== "image") {
      throw new BadRequestException("Only image questions have an image to replace");
    }

    const storageKey = `bank/questions/${randomUUID()}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    const updatedId = await this.repository.replaceImageAsset(id, user.tenantId, {
      storageKey,
      mime: file.mimetype,
    });
    if (!updatedId) {
      throw new NotFoundException(`Question not found: ${id}`);
    }

    return { id: updatedId };
  }

  /**
   * Lane D4 (S4): soft-removes an `approved` question from the bank —
   * `archived` questions are excluded from `getQuestionPool`
   * (`ExamsRepository`, `status = 'approved'` filter) but never deleted, so
   * exams that already reference them keep working. Only an `approved`
   * question can be archived (409 otherwise) — archiving a draft makes no
   * sense (reject/delete is the discard path for drafts).
   */
  async archiveQuestion(
    user: AuthTokenPayload,
    id: string,
  ): Promise<{ id: string; status: "archived" }> {
    const question = await this.repository.findQuestionById(id, user.tenantId);
    if (!question) {
      throw new NotFoundException(`Question not found: ${id}`);
    }
    assertCanManageTenant(user.role, question.tenantId);
    if (question.status !== "approved") {
      throw new ConflictException(
        `Only approved questions can be archived (status=${question.status})`,
      );
    }
    await this.repository.updateStatus(id, "archived");
    return { id, status: "archived" };
  }

  /**
   * Lane D4 (S5): permanently deletes a `draft` question. Reuses
   * `requireVisibleDraft` — the SAME 404/403/409 gate `approveQuestion`/
   * `rejectQuestion` already share — so a draft can only
   * be deleted by whoever is allowed to manage it, and only while it's still
   * a draft (an `approved`/`archived` question is never deletable this way;
   * use `archiveQuestion` instead).
   */
  async deleteDraftQuestion(user: AuthTokenPayload, id: string): Promise<void> {
    const draft = await this.requireVisibleDraft(user, id);
    await this.repository.deleteQuestion(draft.id);
  }
}
