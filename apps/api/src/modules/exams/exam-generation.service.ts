import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { Logger } from "nestjs-pino";
import { AuthTokenPayload } from "../auth/token.service";
import {
  SelectedQuestion,
  SelectionSection,
  Version,
  buildVersions,
} from "./domain/version-shuffler";
import { pickReplacementQuestion } from "./domain/pick-replacement-question";
import { Rng, createSeededRng } from "./domain/ports/random.port";
import {
  AnswerKeyDocumentInput,
  AnswerKeySection,
  ExamPdfDocumentInput,
  ExamPdfQuestion,
  ExamPdfSection,
  PdfCompilerPort,
  TypstCompilationError,
} from "./domain/ports/pdf-compiler.port";
import { StorageObjectNotFoundError, StoragePort } from "./domain/ports/storage.port";
import { STORAGE_PORT } from "../bank/bank.constants";
import { PDF_COMPILER_PORT } from "../bank/bank.constants";
import { ExamForGenerationRecord, ExamsRepository, SelectedQuestionForGeneration } from "./exams.repository";
import type { Archiver, ArchiverOptions } from "archiver";

// `archiver`'s CommonJS entry IS the vending factory `archiver(format, opts)`,
// but @types/archiver@8 only ships the class/interface types (no callable),
// so type the `require` result against them directly.
const createArchive = require("archiver") as (format: "zip", options?: ArchiverOptions) => Archiver;

export interface GeneratedVersionResult {
  readonly code: string;
  readonly pdfUrl: string;
  readonly answerSheetUrl: string;
}

/**
 * Wraps a `TypstCompilationError` with exam context. The adapter already
 * traces a failing compile back to the offending question id (see
 * `pdf-compiler.port.ts`); this just carries that same information across
 * the application-service boundary so the HTTP layer can surface a
 * row-specific error instead of an opaque 500.
 */
export class ExamPdfGenerationError extends Error {
  constructor(
    readonly examId: string,
    readonly questionId: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "ExamPdfGenerationError";
  }
}

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
};
const DEFAULT_EXTENSION = "png";
// Matches the frontend's own cap (exam-versions-panel) — server-side floor
// against a request that would otherwise synchronously compile N PDFs in
// the request/response cycle with no queue behind it (audit P0).
const MAX_VERSION_COUNT = 5;

/**
 * How many uncompilable questions one generation run will swap out before
 * giving up. Bounded because each swap costs a full re-compile of every
 * form: a bank section that is broken wholesale should surface as a loud
 * failure a human looks at, not as an unbounded grind through it.
 */
const MAX_BROKEN_QUESTION_SWAPS = 3;

function extensionForMime(mime: string | null): string {
  return (mime && MIME_EXTENSIONS[mime]) || DEFAULT_EXTENSION;
}

/**
 * The orchestration piece connecting exam -> shuffle -> compile -> upload ->
 * URLs (design doc §5.4). Composes the already-built `VersionShuffler`
 * (question order + answer key), `PdfCompilerPort` (Typst compilation), and
 * `StoragePort` (MinIO upload) — no shuffling or PDF-compilation logic is
 * reimplemented here, only wiring plus the image-materialization step the
 * PDF compiler needs (it consumes absolute file paths, not storage keys).
 */
@Injectable()
export class ExamVersionGenerationService {
  private readonly rngFactory: () => Rng;

  /** See `ExamsService`'s constructor docstring for why this is `@Optional()` + body fallback, not a default parameter value. */
  constructor(
    private readonly repository: ExamsRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
    @Inject(PDF_COMPILER_PORT) private readonly pdfCompiler: PdfCompilerPort,
    @Optional() rngFactory?: () => Rng,
    // Audit 2026-08-20 (L1): the swap-recovery error used bare console.error,
    // outside the structured pino stream. @Optional because a handful of unit
    // specs construct this service manually; under Nest DI the global
    // LoggerModule always provides it.
    @Optional() private readonly logger?: Logger,
  ) {
    this.rngFactory = rngFactory ?? (() => createSeededRng(Date.now() ^ (Math.random() * 2 ** 31)));
  }

  /**
   * Every precondition that must be answered SYNCHRONOUSLY, before the
   * caller commits to generating anything: `versionCount` range, tenant
   * scope, exam existence, and the B3 auto-confirm/status rules. Split out
   * of `generateVersions()` so `ExamVersionJobsService.create()` can run it
   * on the HTTP request path — bad input still gets an immediate 400/404/409
   * and nothing is ever enqueued, exactly like `GenerationJobsService.create()`.
   *
   * Returns the loaded exam so the caller doesn't have to re-query it.
   */
  async prepareGeneration(
    user: AuthTokenPayload,
    examId: string,
    versionCount: number,
  ): Promise<ExamForGenerationRecord> {
    if (!Number.isInteger(versionCount) || versionCount < 1 || versionCount > MAX_VERSION_COUNT) {
      throw new BadRequestException(`versionCount must be an integer between 1 and ${MAX_VERSION_COUNT}`);
    }

    const tenantId = user.tenantId;
    if (!tenantId) {
      throw new BadRequestException("Only tenant users can generate exam versions");
    }

    const exam = await this.repository.getExamForGeneration(examId, tenantId);
    if (!exam) {
      throw new NotFoundException(`Exam not found: ${examId}`);
    }

    // B3 auto-confirm: a `draft` exam with a non-empty selection is
    // confirmed (draft->ready) as part of this same call, instead of
    // requiring a separate `POST /confirm` (B3-R1/R5). A `draft` exam with
    // NO selected questions is still rejected (B3-R2 — auto-confirm never
    // bypasses that invariant). Any other non-`ready` status is unchanged
    // (B3-R4).
    if (exam.status === "draft") {
      if (exam.selectedQuestions.length === 0) {
        throw new ConflictException("Exam has no selected questions");
      }
      await this.repository.confirmExam(examId);
    } else if (exam.status !== "ready") {
      throw new ConflictException("Exam must be confirmed (status=ready) before generating versions");
    } else if (exam.selectedQuestions.length === 0) {
      throw new ConflictException("Exam has no selected questions");
    }

    return exam;
  }

  /**
   * The expensive half: shuffle -> compile -> upload -> persist, one form at
   * a time. Runs inside `ExamVersionJobsProcessor` (BullMQ), never on the
   * request path — compiling N PDFs synchronously is exactly what the audit
   * flagged (P0).
   *
   * `onVersionCompleted` fires after each form is fully persisted (DB row +
   * both storage objects), which is what drives the job row's
   * `completed_count` and therefore the live progress the UI shows. It is
   * deliberately called AFTER the write, so a partial failure leaves a count
   * that matches what actually exists.
   *
   * Re-runs `prepareGeneration()` rather than trusting the enqueue-time
   * check: the worker may pick the job up much later, and re-validating is
   * cheap and idempotent (the exam is already `ready` by then, so the
   * auto-confirm branch is a no-op).
   */
  async generateVersions(
    user: AuthTokenPayload,
    examId: string,
    versionCount: number,
    onVersionCompleted?: (result: GeneratedVersionResult) => Promise<void>,
  ): Promise<GeneratedVersionResult[]> {
    // Questions this run has already proven uncompilable. Carried across
    // attempts so a swap can never pick one back up, and so the same broken
    // question is only ever archived/counted once.
    const brokenQuestionIds = new Set<string>();
    // Form codes already reported through `onVersionCompleted`. A retry
    // regenerates every form from scratch (`clearVersions` wipes the partial
    // run first), so without this the job's `completed_count` would keep
    // counting forms it had already counted and overshoot `versionCount`.
    const reportedCodes = new Set<string>();

    for (let attempt = 0; ; attempt++) {
      const exam = await this.prepareGeneration(user, examId, versionCount);
      try {
        return await this.runGeneration(exam, versionCount, async (result) => {
          if (reportedCodes.has(result.code)) {
            return;
          }
          reportedCodes.add(result.code);
          await onVersionCompleted?.(result);
        });
      } catch (error) {
        if (
          !(error instanceof ExamPdfGenerationError) ||
          !error.questionId ||
          attempt >= MAX_BROKEN_QUESTION_SWAPS ||
          !(await this.swapBrokenQuestion(exam, error.questionId, brokenQuestionIds))
        ) {
          throw error;
        }
      }
    }
  }

  /**
   * Quarantines one uncompilable question and refills its slot from the same
   * blueprint row, returning whether the exam is now worth retrying.
   *
   * The question is archived bank-wide BEFORE looking for a replacement, and
   * regardless of whether one is found: a question that cannot be compiled is
   * broken for every exam, not just this one, and leaving it `approved` is
   * what turned a single bad row into a permanently unusable exam — the
   * frozen `exam_questions` selection meant "Reintentar" re-picked it every
   * single time.
   */
  private async swapBrokenQuestion(
    exam: ExamForGenerationRecord,
    brokenQuestionId: string,
    brokenQuestionIds: Set<string>,
  ): Promise<boolean> {
    try {
      return await this.trySwapBrokenQuestion(exam, brokenQuestionId, brokenQuestionIds);
    } catch (error) {
      // Recovery is best-effort by definition. If quarantining or refilling
      // trips over anything, the caller must still surface the ORIGINAL
      // "question X does not compile" — that names the actual problem, and
      // is what the UI shows the teacher. Swallowing it in favour of a
      // failure from the recovery attempt would lose that.
      const err = error instanceof Error ? error.message : String(error);
      if (this.logger) {
        this.logger.error(
          { examId: exam.id, questionId: brokenQuestionId, err },
          "could not swap uncompilable question — surfacing the original compile error",
        );
      } else {
        console.error(
          `[exam-generation] could not swap uncompilable question ${brokenQuestionId} on exam ${exam.id}: ${err}`,
        );
      }
      return false;
    }
  }

  private async trySwapBrokenQuestion(
    exam: ExamForGenerationRecord,
    brokenQuestionId: string,
    brokenQuestionIds: Set<string>,
  ): Promise<boolean> {
    if (!brokenQuestionIds.has(brokenQuestionId)) {
      brokenQuestionIds.add(brokenQuestionId);
      await this.repository.archiveQuestion(brokenQuestionId);
    }

    const examQuestion = await this.repository.findExamQuestion(exam.id, brokenQuestionId);
    if (!examQuestion?.blueprintRowId) {
      return false;
    }

    const rows = await this.repository.getBlueprintRows(exam.id);
    const row = rows.find((candidate) => candidate.id === examQuestion.blueprintRowId);
    if (!row) {
      return false;
    }

    const examRecord = await this.repository.getExamById(exam.id, exam.tenantId);
    if (!examRecord) {
      return false;
    }

    const pool = await this.repository.getQuestionPool({
      tenantId: exam.tenantId,
      gradeLevel: examRecord.gradeLevel,
    });
    const usedIds = await this.repository.getSelectedQuestionIds(exam.id);
    const replacement = pickReplacementQuestion({
      pool,
      row,
      excludedIds: new Set([...usedIds, ...brokenQuestionIds]),
      rng: this.rngFactory(),
    });
    if (!replacement) {
      return false;
    }

    await this.repository.replaceQuestion(exam.id, brokenQuestionId, replacement);
    return true;
  }

  private async runGeneration(
    exam: ExamForGenerationRecord,
    versionCount: number,
    onVersionCompleted: (result: GeneratedVersionResult) => Promise<void>,
  ): Promise<GeneratedVersionResult[]> {
    // B4-B idempotent regeneration: wipe any prior versions (DB rows first,
    // then best-effort delete their storage objects) BEFORE building new
    // ones, so a second `POST /versions` call never collides on the
    // `(examId, code)` unique index (B4-R5/R6). No-op on first-time
    // generation (B4-R7).
    const deletedStorageKeys = await this.repository.clearVersions(exam.id);
    for (const key of deletedStorageKeys) {
      try {
        await this.storage.delete(key);
      } catch {
        // best-effort — the DB rows are already gone regardless (DECISION B4-B).
      }
    }

    // Discriminated by `type` (design doc §5.4, Lane D4): `structured`
    // questions carry `alternatives` so `buildVersions()`/`VersionShuffler`
    // actually shuffles them and recomputes the answer key; `image`
    // questions pass `correctAnswer` straight through, unchanged.
    const selected: SelectedQuestion[] = exam.selectedQuestions.map((q): SelectedQuestion =>
      q.type === "structured"
        ? {
            type: "structured",
            questionId: q.questionId,
            alternatives: q.alternatives ?? [],
            correctAnswer: q.correctAnswer,
            alternativeImages: q.alternativeImages,
          }
        : {
            questionId: q.questionId,
            correctAnswer: q.correctAnswer,
          },
    );
    // The repository still hands back a FLAT selection, so the booklet is one
    // unlabeled section holding one unlabeled block — the shape the port calls
    // "no heading". `buildVersions` then shuffles inside that single block,
    // which is exactly what it did before sections existed. Once the
    // repository starts exposing the blueprint's real sections, only this
    // wrapper changes; everything downstream already reads `sectionLayout`.
    const sections: SelectionSection[] = [
      { code: null, label: null, blocks: [{ label: "", questions: selected }] },
    ];
    const versions = buildVersions(sections, versionCount, this.rngFactory());

    const questionById = new Map(exam.selectedQuestions.map((q) => [q.questionId, q]));

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "exam-gen-"));
    try {
      // `type='image'` questions ALWAYS have a backing image. `type='structured'`
      // questions render from `bodyTypst`/`alternatives`/`figureCode` text, but
      // MAY also carry an optional complement image (a chart/diagram/passage
      // scan attached via `POST :id/image` — see `bank.service.ts`
      // `replaceImage`) — materialize for any question that has one, regardless
      // of type.
      const imageQuestions = exam.selectedQuestions.filter((q) => q.imageStorageKey != null);
      const imagePathByQuestionId = await this.materializeQuestionImages(workDir, imageQuestions);
      const logoPath = await this.materializeLogo(workDir, exam);
      // Shared across every version's materialization below so the SAME
      // physical asset (an alternative's image never changes across
      // versions, only its printed position does) is only downloaded once,
      // not once per version.
      const alternativeImageBytesCache = new Map<string, Buffer>();

      const results: GeneratedVersionResult[] = [];
      for (const version of versions) {
        const altImagePathsByQuestionId = await this.materializeAlternativeImages(
          workDir,
          version,
          alternativeImageBytesCache,
        );
        const result = await this.generateOneVersion(
          exam,
          version,
          questionById,
          imagePathByQuestionId,
          altImagePathsByQuestionId,
          logoPath,
        );
        results.push(result);
        await onVersionCompleted(result);
      }
      return results;
    } finally {
      await fs.rm(workDir, { recursive: true, force: true });
    }
  }

  /**
   * `GET /exams/:examId/versions/zip` (N1) — bundles every generated form
   * (exam PDF + answer sheet) into a single ZIP, returned as an in-memory
   * `Buffer`. Tenant-scoped 404-on-mismatch, same pattern as `listVersions`
   * (B4): `getVersionAssetRecords()` returns `undefined` for a
   * missing/cross-tenant exam. A `ready` exam with zero generated versions
   * is a 409 (nothing to download) — distinct from the 200 `[]` the history
   * endpoint returns, because a download of nothing is not a useful success.
   *
   * `zlib.level: 0` (store, no compression) — the PDFs are already
   * compressed, so deflating them again only burns CPU for no size win. An
   * exam has at most a handful of versions, so buffering the whole archive
   * in memory is fine (no streaming needed).
   */
  async buildVersionsZip(user: AuthTokenPayload, examId: string): Promise<Buffer> {
    const tenantId = user.tenantId;
    if (!tenantId) {
      throw new BadRequestException("Only tenant users can download exam versions");
    }

    const records = await this.repository.getVersionAssetRecords(examId, tenantId);
    if (records === undefined) {
      throw new NotFoundException(`Exam not found: ${examId}`);
    }
    if (records.length === 0) {
      throw new ConflictException("Exam has no generated versions to download");
    }

    const archive = createArchive("zip", { zlib: { level: 0 } });
    const chunks: Buffer[] = [];
    const zipped = new Promise<Buffer>((resolve, reject) => {
      archive.on("data", (chunk: Buffer) => chunks.push(chunk));
      archive.on("warning", reject);
      archive.on("error", reject);
      archive.on("end", () => resolve(Buffer.concat(chunks)));
    });

    for (const record of records) {
      const examPdf = await this.fetchVersionAsset(record.pdfStorageKey, examId);
      const answerSheet = await this.fetchVersionAsset(record.answerSheetStorageKey, examId);
      archive.append(examPdf, { name: `Examen-${record.code}.pdf` });
      archive.append(answerSheet, { name: `Claves-${record.code}.pdf` });
    }

    await archive.finalize();
    return zipped;
  }

  /** Pulls one version asset's bytes; a missing storage object is an integrity fault surfaced as 404 (same mapping as `AssetsService`). */
  private async fetchVersionAsset(storageKey: string, examId: string): Promise<Buffer> {
    try {
      return await this.storage.get(storageKey);
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        throw new NotFoundException(`Exam not found: ${examId}`);
      }
      throw error;
    }
  }

  private async generateOneVersion(
    exam: ExamForGenerationRecord,
    version: Version,
    questionById: ReadonlyMap<string, SelectedQuestionForGeneration>,
    imagePathByQuestionId: ReadonlyMap<string, string>,
    altImagePathsByQuestionId: ReadonlyMap<string, readonly (string | undefined)[]>,
    logoPath: string | undefined,
  ): Promise<GeneratedVersionResult> {
    const versionLabel = `Forma ${version.code}`;

    const examInput: ExamPdfDocumentInput = {
      title: exam.title,
      versionLabel,
      tenantLogoAbsolutePath: logoPath,
      // Cut `questionOrder` by the layout the shuffler froze for THIS version.
      // The layout stores counts and never ids — `questionOrder` is the single
      // source of truth for order, and the counts only say where to cut
      // (design doc §3.6), so walking them in step is the whole mapping.
      sections: this.sliceByLayout(version, (questionId) =>
        this.buildPdfQuestion(
          questionId,
          questionById,
          imagePathByQuestionId,
          altImagePathsByQuestionId,
          version,
        ),
      ),
    };

    const answerKeyInput: AnswerKeyDocumentInput = {
      title: exam.title,
      versionLabel,
      // Cut by the SAME layout as the booklet, so the key's local numbering
      // and the booklet's printed numbering are the same run: if the booklet
      // says "14", the key says "14" (design doc §6.3).
      sections: this.sliceAnswerKeyByLayout(version),
    };

    let examPdf: Buffer;
    let answerKeyPdf: Buffer;
    try {
      examPdf = await this.pdfCompiler.compileExam(examInput);
      answerKeyPdf = await this.pdfCompiler.compileAnswerKey(answerKeyInput);
    } catch (error) {
      if (error instanceof TypstCompilationError) {
        throw new ExamPdfGenerationError(exam.id, error.questionId, error.message);
      }
      throw error;
    }

    const pdfKey = `exams/${exam.id}/versions/${version.code}/exam.pdf`;
    const answerKeyKey = `exams/${exam.id}/versions/${version.code}/answer-key.pdf`;

    await this.storage.put(pdfKey, examPdf, "application/pdf");
    await this.storage.put(answerKeyKey, answerKeyPdf, "application/pdf");

    const pdfAsset = await this.repository.createAsset(exam.tenantId, pdfKey, "application/pdf");
    const answerKeyAsset = await this.repository.createAsset(exam.tenantId, answerKeyKey, "application/pdf");

    // `/assets/:id` (tenant/JWT-protected), NOT storage.put()'s raw presigned
    // MinIO url — that url is valid for 7 days with no auth check at all,
    // bypassing the tenant boundary every other version-asset link already
    // respects (`getVersionAssetRecords` below builds the same shape).
    const pdfUrl = `/assets/${pdfAsset.id}`;
    const answerSheetUrl = `/assets/${answerKeyAsset.id}`;

    await this.repository.saveVersion(exam.id, {
      code: version.code,
      questionOrder: version.questionOrder,
      answerKey: version.answerKey,
      pdfAssetId: pdfAsset.id,
      answerSheetAssetId: answerKeyAsset.id,
    });

    return { code: version.code, pdfUrl, answerSheetUrl };
  }

  /**
   * Maps one shuffled `questionOrder` entry to the discriminated
   * `ExamPdfQuestion` the compiler/template expect (`pdf-compiler.port.ts`,
   * `typst-template.ts`). `type='structured'` questions render from
   * `bodyTypst`/`figureCode` plus `version.shuffledAlternatives[questionId]`
   * — the ALREADY-PERMUTED alternative texts for this specific version, so
   * the printed lettering (A/B/C…) matches `version.answerKey[position]`
   * (see `VersionShuffler`'s invariant docstring), plus an optional
   * `imageAbsolutePath` if this structured question has a complement image
   * materialized in `imagePathByQuestionId`. `type='image'` questions keep
   * rendering from the materialized on-disk path, unchanged.
   */
  /**
   * Rebuilds the booklet's sections/blocks by walking `version.sectionLayout`
   * and consuming `version.questionOrder` in step. The layout deliberately
   * stores counts and never ids, so this cursor walk is the ONLY thing that
   * pairs the two — which is why both PDFs must slice with the same helper,
   * or the key would stop lining up with the booklet.
   */
  private sliceByLayout(
    version: Version,
    toPdfQuestion: (questionId: string) => ExamPdfQuestion,
  ): ExamPdfSection[] {
    let cursor = 0;
    return version.sectionLayout.map((section) => ({
      code: section.code,
      label: section.label,
      blocks: section.blocks.map((block) => {
        const ids = version.questionOrder.slice(cursor, cursor + block.count);
        cursor += block.count;
        return { label: block.label, questions: ids.map(toPdfQuestion) };
      }),
    }));
  }

  /**
   * The answer key's sections mirror the booklet's, but flattened one level:
   * the key prints a table per SECTION, not per block, because its numbering
   * restarts per section and not per block (design doc §6.3).
   */
  private sliceAnswerKeyByLayout(version: Version): AnswerKeySection[] {
    let cursor = 0;
    return version.sectionLayout.map((section) => {
      const count = section.blocks.reduce((sum, block) => sum + block.count, 0);
      const entries = version.questionOrder.slice(cursor, cursor + count).map((questionId, i) => ({
        questionId,
        correctOption: version.answerKey[cursor + i]!,
      }));
      cursor += count;
      return { label: section.label, entries };
    });
  }

  private buildPdfQuestion(
    questionId: string,
    questionById: ReadonlyMap<string, SelectedQuestionForGeneration>,
    imagePathByQuestionId: ReadonlyMap<string, string>,
    altImagePathsByQuestionId: ReadonlyMap<string, readonly (string | undefined)[]>,
    version: Version,
  ): ExamPdfQuestion {
    const question = questionById.get(questionId);
    if (!question) {
      throw new ConflictException(`Question ${questionId} is not part of this exam's selection`);
    }

    if (question.type === "structured") {
      return {
        id: questionId,
        type: "structured",
        bodyTypst: question.bodyTypst ?? "",
        alternatives: version.shuffledAlternatives[questionId] ?? question.alternatives ?? [],
        figureCode: question.figureCode ?? undefined,
        imageAbsolutePath: imagePathByQuestionId.get(questionId),
        alternativeImagePaths: altImagePathsByQuestionId.get(questionId),
      };
    }

    return {
      id: questionId,
      imageAbsolutePath: imagePathByQuestionId.get(questionId)!,
    };
  }

  private async materializeQuestionImages(
    workDir: string,
    selectedQuestions: readonly SelectedQuestionForGeneration[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    for (const question of selectedQuestions) {
      if (!question.imageStorageKey) {
        throw new ConflictException(`Question ${question.questionId} has no image asset to render`);
      }
      const bytes = await this.storage.get(question.imageStorageKey);
      const filePath = path.join(workDir, `q-${question.questionId}.${extensionForMime(question.imageMime)}`);
      await fs.writeFile(filePath, bytes);
      map.set(question.questionId, filePath);
    }
    return map;
  }

  /**
   * Sibling to `materializeQuestionImages`, but keyed off THIS version's
   * already-shuffled `shuffledAlternativeImages` (see `version-shuffler.ts`)
   * instead of the original selection order — the resulting array is
   * therefore already index-aligned with `version.shuffledAlternatives[id]`,
   * so `buildPdfQuestion` can thread it straight through as
   * `alternativeImagePaths` with no further reordering. `byteCache` is
   * shared across every version in the same `generateVersions()` call (the
   * same physical asset can appear in every version, just at a different
   * printed position) so it's only ever downloaded once.
   */
  private async materializeAlternativeImages(
    workDir: string,
    version: Version,
    byteCache: Map<string, Buffer>,
  ): Promise<Map<string, readonly (string | undefined)[]>> {
    const map = new Map<string, readonly (string | undefined)[]>();
    for (const [questionId, images] of Object.entries(version.shuffledAlternativeImages)) {
      const paths: (string | undefined)[] = [];
      for (let index = 0; index < images.length; index++) {
        const image = images[index];
        if (!image) {
          paths.push(undefined);
          continue;
        }
        let bytes = byteCache.get(image.storageKey);
        if (!bytes) {
          bytes = await this.storage.get(image.storageKey);
          byteCache.set(image.storageKey, bytes);
        }
        const filePath = path.join(workDir, `q-${questionId}-alt-${index}.${extensionForMime(image.mime)}`);
        await fs.writeFile(filePath, bytes);
        paths.push(filePath);
      }
      map.set(questionId, paths);
    }
    return map;
  }

  private async materializeLogo(workDir: string, exam: ExamForGenerationRecord): Promise<string | undefined> {
    if (!exam.logoStorageKey) {
      return undefined;
    }
    const bytes = await this.storage.get(exam.logoStorageKey);
    const filePath = path.join(workDir, `logo.${DEFAULT_EXTENSION}`);
    await fs.writeFile(filePath, bytes);
    return filePath;
  }
}
