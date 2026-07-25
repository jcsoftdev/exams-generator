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
import { AuthTokenPayload } from "../auth/token.service";
import { SelectedQuestion, Version, buildVersions } from "./domain/version-shuffler";
import { Rng, createSeededRng } from "./domain/ports/random.port";
import {
  AnswerKeyDocumentInput,
  ExamPdfDocumentInput,
  ExamPdfQuestion,
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
  constructor(readonly examId: string, readonly questionId: string | undefined, message: string) {
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
  ) {
    this.rngFactory = rngFactory ?? (() => createSeededRng(Date.now() ^ (Math.random() * 2 ** 31)));
  }

  async generateVersions(
    user: AuthTokenPayload,
    examId: string,
    versionCount: number,
  ): Promise<GeneratedVersionResult[]> {
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

    // B4-B idempotent regeneration: wipe any prior versions (DB rows first,
    // then best-effort delete their storage objects) BEFORE building new
    // ones, so a second `POST /versions` call never collides on the
    // `(examId, code)` unique index (B4-R5/R6). No-op on first-time
    // generation (B4-R7).
    const deletedStorageKeys = await this.repository.clearVersions(examId);
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
          }
        : {
            questionId: q.questionId,
            correctAnswer: q.correctAnswer,
          },
    );
    const versions = buildVersions(selected, versionCount, this.rngFactory());

    const questionById = new Map(exam.selectedQuestions.map((q) => [q.questionId, q]));

    const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "exam-gen-"));
    try {
      // Image materialization only ever applies to `type='image'` questions
      // — `type='structured'` questions render from `bodyTypst`/
      // `alternatives`/`figureCode` text, no on-disk image involved.
      const imageQuestions = exam.selectedQuestions.filter((q) => q.type !== "structured");
      const imagePathByQuestionId = await this.materializeQuestionImages(workDir, imageQuestions);
      const logoPath = await this.materializeLogo(workDir, exam);

      const results: GeneratedVersionResult[] = [];
      for (const version of versions) {
        results.push(
          await this.generateOneVersion(exam, version, questionById, imagePathByQuestionId, logoPath),
        );
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
    logoPath: string | undefined,
  ): Promise<GeneratedVersionResult> {
    const versionLabel = `Forma ${version.code}`;

    const examInput: ExamPdfDocumentInput = {
      title: exam.title,
      versionLabel,
      tenantLogoAbsolutePath: logoPath,
      questions: version.questionOrder.map((questionId) =>
        this.buildPdfQuestion(questionId, questionById, imagePathByQuestionId, version),
      ),
    };

    const answerKeyInput: AnswerKeyDocumentInput = {
      title: exam.title,
      versionLabel,
      entries: version.questionOrder.map((questionId, position) => ({
        questionId,
        correctOption: version.answerKey[position]!,
      })),
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
   * (see `VersionShuffler`'s invariant docstring). `type='image'` questions
   * keep rendering from the materialized on-disk path, unchanged.
   */
  private buildPdfQuestion(
    questionId: string,
    questionById: ReadonlyMap<string, SelectedQuestionForGeneration>,
    imagePathByQuestionId: ReadonlyMap<string, string>,
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
