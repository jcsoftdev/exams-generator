import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Difficulty } from "@exams-generator/shared";
import { and, isNotNull, isNull } from "drizzle-orm";
import { resolveStorageAdapter } from "../modules/bank/storage-provider";
import { isGradeLevel } from "../modules/exams/domain/value-objects/grade-level";
import type { GradeLevel } from "../modules/exams/domain/value-objects/grade-level";
import { StoragePort } from "../modules/exams/domain/ports/storage.port";
import { db } from "./client";
import { LotEntry, PlannedQuestion, planLotSeed } from "./plan-lot-seed";
import { assets, courses, questionAlternativeImages, questions, topicGrades, topics } from "./schema";

const LOTS_DIR = join(__dirname, "data", "lots");
const VALID_DIFFICULTIES = new Set<string>(Object.values(Difficulty));

interface LotFile {
  readonly entries: readonly LotEntry[];
}

/**
 * Turns `discoveredGrades`' `topicId|gradeLevel` keys into `topic_grades`
 * insert rows, dropping any key whose grade level is not a real
 * `GradeLevel`. Pure and side-effect free on purpose: the caller only ever
 * adds validated grades (see `isGradeLevel` in the insert loop below), so
 * this filter is defense-in-depth against a future caller skipping that
 * check — not the primary guard — but it is what keeps the batched
 * `db.insert(topicGrades)` (which runs outside any try/catch) from ever
 * throwing a `grade_levels` FK violation and aborting the rest of `seed()`.
 */
export function buildTopicGradeInserts(
  discoveredGrades: ReadonlySet<string>,
): Array<{ topicId: string; gradeLevel: GradeLevel }> {
  const rows: Array<{ topicId: string; gradeLevel: GradeLevel }> = [];
  for (const key of discoveredGrades) {
    const [topicId, gradeLevel] = key.split("|");
    if (topicId && gradeLevel && isGradeLevel(gradeLevel)) {
      rows.push({ topicId, gradeLevel });
    }
  }
  return rows;
}

/** An entry plus the directory its `imagePath` is relative to. */
interface LocatedEntry {
  readonly entry: LotEntry;
  readonly dir: string;
}

/**
 * Teaches the path-to-directory map about a sequence question's per-alternative
 * drawings.
 *
 * They live in `alternativeImagePaths`, never in `imagePath`, but `uploadAsset`
 * resolves EVERY path through this one map. Registering only the figure made
 * each such question fail to seed with "image not readable" while its PNGs sat
 * right there on disk — four questions across three lots, silently missing from
 * the bank since the crop pass first wrote them.
 *
 * Only fills gaps: a path a figure already claimed keeps that directory, which
 * is what makes it safe to run after the fingerprint pass rather than inside it.
 */
export function registerAlternativeImageDirs(
  located: readonly LocatedEntry[],
  dirByImagePath: Map<string, string>,
): Map<string, string> {
  for (const { entry, dir } of located) {
    for (const alternativeImagePath of entry.alternativeImagePaths ?? []) {
      if (alternativeImagePath && !dirByImagePath.has(alternativeImagePath)) {
        dirByImagePath.set(alternativeImagePath, dir);
      }
    }
  }
  return dirByImagePath;
}

function readLots(): LocatedEntry[] {
  let names: string[];
  try {
    names = readdirSync(LOTS_DIR).filter((name) => name.endsWith(".json"));
  } catch {
    return []; // no lots shipped in this build
  }

  const located: LocatedEntry[] = [];
  for (const name of names.sort()) {
    const path = join(LOTS_DIR, name);
    const data = JSON.parse(readFileSync(path, "utf8")) as LotFile;
    for (const entry of data.entries ?? []) {
      located.push({ entry, dir: dirname(path) });
    }
  }
  return located;
}

/**
 * Seeds the harvested exam lots under `db/data/lots/` at deploy boot — the
 * questions taken from officially published exams whose answer key the source
 * itself prints (see `docs/question-collection-pipeline.md`).
 *
 * Unlike `seed-collected-questions.ts`, this one has to talk to the object
 * store: most of these questions ARE an image (a whole question baked into a
 * PNG, used when a source's math cannot be transcribed faithfully), and the
 * structured ones often carry a cropped figure — a circuit, a geometry drawing,
 * a table. Every image is uploaded before its question row is written, so a
 * question never points at an asset that is not there.
 *
 * Re-runnable: statements dedupe on `body_hash` (figure included, so one wording
 * over several drawings stays several questions) and image questions dedupe on
 * `source_name`, which the harvest fills with exam, subject and question number.
 */
export async function seedLotQuestions(createdBy: string): Promise<void> {
  const located = readLots();
  if (located.length === 0) {
    return;
  }

  const courseRows = await db.select({ id: courses.id, name: courses.name }).from(courses);
  const topicRows = await db
    .select({ id: topics.id, name: topics.name, courseId: topics.courseId })
    .from(topics);
  const topicByCourseAndName = new Map<string, string>();
  for (const topic of topicRows) {
    const course = courseRows.find((row) => row.id === topic.courseId);
    if (course) {
      topicByCourseAndName.set(`${course.name}|${topic.name}`, topic.id);
    }
  }

  const existingBodyHashes = new Set(
    (
      await db
        .select({ hash: questions.bodyHash })
        .from(questions)
        .where(and(isNull(questions.tenantId), isNotNull(questions.bodyHash)))
    ).map((row) => row.hash as string),
  );
  const existingSourceNames = new Set(
    (
      await db
        .select({ name: questions.sourceName })
        .from(questions)
        .where(and(isNull(questions.tenantId), isNotNull(questions.sourceName)))
    ).map((row) => row.name as string),
  );

  // Fingerprint every referenced image once: the hash of a structured question
  // includes its figure, so the bytes have to be read before planning.
  const dirByImagePath = new Map<string, string>();
  const figureFingerprints = new Map<string, string>();
  for (const { entry, dir } of located) {
    if (!entry.imagePath || figureFingerprints.has(entry.imagePath)) continue;
    try {
      const bytes = readFileSync(resolve(dir, entry.imagePath));
      figureFingerprints.set(entry.imagePath, createHash("sha256").update(bytes).digest("hex"));
      dirByImagePath.set(entry.imagePath, dir);
    } catch {
      // Left unfingerprinted; the insert loop reports it as a failure per entry
      // rather than aborting a whole deploy's seeding for one missing PNG.
    }
  }
  registerAlternativeImageDirs(located, dirByImagePath);

  const plan = planLotSeed({
    entries: located.map((item) => item.entry),
    existingBodyHashes,
    existingSourceNames,
    figureFingerprints,
  });
  for (const { entry, reason } of plan.invalid) {
    console.error(`[seed-lot-questions] INVALID ${entry.sourceName || "(sin fuente)"}: ${reason}`);
  }

  const storage = resolveStorageAdapter();
  let inserted = 0;
  let failed = 0;
  const discoveredGrades = new Set<string>();

  for (const question of plan.toInsert) {
    const label = question.sourceName;
    try {
      const topicId = topicByCourseAndName.get(`${question.courseName}|${question.topicName}`);
      if (topicId === undefined) {
        throw new Error(`topic '${question.topicName}' not found in course '${question.courseName}'`);
      }
      if (!VALID_DIFFICULTIES.has(question.difficulty)) {
        throw new Error(`unknown difficulty '${question.difficulty}'`);
      }
      if (!isGradeLevel(question.gradeLevel)) {
        throw new Error(`invalid gradeLevel: ${question.gradeLevel}`);
      }
      await insertQuestion(question, topicId, createdBy, storage, dirByImagePath);
      inserted++;
      // Added only after the insert succeeds: adding on a lookup/validation
      // failure would still add a bad or unreached (topicId, gradeLevel) pair
      // to the batched insert below, which runs outside this try/catch.
      discoveredGrades.add(`${topicId}|${question.gradeLevel}`);
    } catch (error) {
      failed++;
      console.error(
        `[seed-lot-questions] FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const topicGradeRows = buildTopicGradeInserts(discoveredGrades);
  if (topicGradeRows.length > 0) {
    await db
      .insert(topicGrades)
      .values(topicGradeRows)
      .onConflictDoNothing({ target: [topicGrades.topicId, topicGrades.gradeLevel] });
  }

  console.log(`[seed-lot-questions] ${inserted} inserted, ${plan.skipped} already present, ${failed} failed`);
}

async function insertQuestion(
  question: PlannedQuestion,
  topicId: string,
  createdBy: string,
  storage: StoragePort,
  dirByImagePath: ReadonlyMap<string, string>,
): Promise<void> {
  const uploadAsset = async (imagePath: string): Promise<string> => {
    const dir = dirByImagePath.get(imagePath);
    if (dir === undefined) {
      throw new Error(`image not readable: ${imagePath}`);
    }
    const bytes = readFileSync(resolve(dir, imagePath));
    const storageKey = `bank/questions/${randomUUID()}`;
    // Uploaded before the row is written: a question pointing at an asset that
    // does not exist renders as a broken exam, which is worse than a miss.
    await storage.put(storageKey, bytes, "image/png");
    const [asset] = await db
      .insert(assets)
      .values({ tenantId: null, storageKey, mime: "image/png" })
      .returning({ id: assets.id });
    if (!asset) {
      throw new Error("insert invariant violated: asset row missing after insert");
    }

    return asset.id;
  };

  const imageAssetId = question.imagePath ? await uploadAsset(question.imagePath) : undefined;

  // Every alternative picture is uploaded BEFORE the question row exists, for
  // the same reason as the complement above: a slot pointing at a missing
  // asset prints as a blank option, and a blank option is an unanswerable
  // question nobody notices until a student does.
  const alternativeAssetIds: Array<{ index: number; assetId: string }> = [];
  const alternativeImagePaths = question.type === "structured" ? question.alternativeImagePaths : undefined;
  if (alternativeImagePaths) {
    for (const [index, imagePath] of alternativeImagePaths.entries()) {
      if (imagePath) {
        alternativeAssetIds.push({ index, assetId: await uploadAsset(imagePath) });
      }
    }
  }

  const [inserted] = await db
    .insert(questions)
    .values({
      tenantId: null,
      type: question.type,
      topicId,
      difficulty: question.difficulty as Difficulty,
      gradeLevel: question.gradeLevel,
      status: "approved",
      imageAssetId,
      bodyTypst: question.type === "structured" ? question.bodyTypst : undefined,
      bodyHash: question.bodyHash,
      alternatives: question.type === "structured" ? question.alternatives : undefined,
      // A restructured lot entry can carry a CeTZ drawing in place of the crop
      // it replaced (`plan-image-lot-restructure.ts`); dropping it here would
      // silently print the question with no figure at all.
      figureCode: question.type === "structured" ? question.figureCode : undefined,
      correctAnswer: question.correctAnswer,
      sourceUrl: question.sourceUrl,
      sourceName: question.sourceName,
      aiGenerated: false,
      createdBy,
    })
    .returning({ id: questions.id });

  if (alternativeAssetIds.length > 0) {
    if (!inserted) {
      throw new Error("insert invariant violated: question row missing after insert");
    }
    await db.insert(questionAlternativeImages).values(
      alternativeAssetIds.map(({ index, assetId }) => ({
        questionId: inserted.id,
        alternativeIndex: index,
        assetId,
      })),
    );
  }
}
