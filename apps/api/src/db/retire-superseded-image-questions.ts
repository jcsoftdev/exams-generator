import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { hashBodyTypst } from "../modules/bank/domain/hash-body-typst";
import { db } from "./client";
import { planImageQuestionRetirement } from "./plan-image-question-retirement";
import type { RetirementCandidate } from "./plan-image-question-retirement";
import { planImageTwinLookup } from "./plan-image-twin-lookup";
import { LotEntry } from "./plan-lot-seed";
import { examQuestions, questions } from "./schema";

const LOTS_DIR = join(__dirname, "data", "lots");

/**
 * `source_name` -> `bodyHash` for every lot entry that now carries a statement,
 * hashed exactly the way `seedLotQuestions` hashes it — figure bytes included,
 * so one wording over two drawings stays two questions.
 *
 * Read off the lots rather than the bank because the lot is what says a question
 * is text now; the bank is the thing being reconciled to it.
 */
function readPromotedHashes(): Map<string, string> {
  let names: string[];
  try {
    names = readdirSync(LOTS_DIR).filter((name) => name.endsWith(".json"));
  } catch {
    return new Map(); // no lots shipped in this build
  }

  const hashBySourceName = new Map<string, string>();
  const fingerprints = new Map<string, string>();
  for (const name of names.sort()) {
    const path = join(LOTS_DIR, name);
    const dir = dirname(path);
    const data = JSON.parse(readFileSync(path, "utf8")) as { entries?: LotEntry[] };
    for (const entry of data.entries ?? []) {
      const body = entry.bodyTypst;
      if (!entry.sourceName || typeof body !== "string" || body.trim().length === 0) continue;
      let fingerprint: string | undefined;
      if (entry.imagePath) {
        fingerprint = fingerprints.get(entry.imagePath);
        if (fingerprint === undefined) {
          try {
            fingerprint = createHash("sha256").update(readFileSync(resolve(dir, entry.imagePath))).digest("hex");
            fingerprints.set(entry.imagePath, fingerprint);
          } catch {
            // A figure that cannot be read makes the hash unreproducible, so
            // this entry simply offers no twin rather than a wrong one.
            continue;
          }
        }
      }
      hashBySourceName.set(entry.sourceName, hashBodyTypst(body, fingerprint));
    }
  }
  return hashBySourceName;
}

/**
 * Resolves the twin of every screenshot whose lot promoted it but whose text row
 * the seeder deduped away, as one `IN` query over the statements involved.
 *
 * Returns an empty map without touching the database when there is nothing to
 * look up, which is the steady state after the first deploy that clears them.
 */
async function resolveTwins(
  imageRows: readonly RetirementCandidate[],
  textRows: readonly RetirementCandidate[],
): Promise<Map<string, string>> {
  const lookups = planImageTwinLookup({
    promotedHashBySourceName: readPromotedHashes(),
    imageRows,
    textRows,
  });
  if (lookups.length === 0) return new Map();

  const idsByHash = new Map<string, string[]>();
  const hashes = [...new Set(lookups.map((lookup) => lookup.bodyHash))];
  for (let i = 0; i < hashes.length; i += 200) {
    const rows = await db
      .select({ id: questions.id, bodyHash: questions.bodyHash })
      .from(questions)
      .where(and(isNull(questions.tenantId), inArray(questions.bodyHash, hashes.slice(i, i + 200))));
    for (const row of rows) {
      if (!row.bodyHash) continue;
      const ids = idsByHash.get(row.bodyHash);
      if (ids) ids.push(row.id);
      else idsByHash.set(row.bodyHash, [row.id]);
    }
  }

  const twins = new Map<string, string>();
  for (const { sourceName, bodyHash } of lookups) {
    const ids = idsByHash.get(bodyHash);
    // Exactly one row, or nothing: two rows sharing a statement hash means the
    // bank holds a duplicate this pass did not create, and handing the exam
    // references to either would bake a coin flip into somebody's exam.
    if (ids?.length === 1) twins.set(sourceName, ids[0]!);
  }
  return twins;
}

/**
 * Drops the whole-question screenshots that a restructured lot has replaced
 * with text, and hands their exam references to the text row.
 *
 * Runs on every boot, like the other backfills around it, and is idempotent:
 * once a lot is retired there is no image row left to pair, so the steady-state
 * cost is two selects and no write. That is what makes shipping a restructured
 * lot to production a plain deploy — the seeder inserts the new text rows and
 * this clears the ones they superseded, with no manual step on the server.
 *
 * The repoint happens BEFORE the delete on purpose: `exam_questions.question_id`
 * is `ON DELETE NO ACTION`, so a referenced screenshot cannot simply be removed,
 * and an exam a teacher already built keeps working — it now prints the readable
 * version of the same question instead of a picture of somebody's answer sheet.
 */
export async function retireSupersededImageQuestions(): Promise<{
  retired: number;
  repointed: number;
  /** Slots dropped because that exam already held the text version too. */
  deduped: number;
  skipped: readonly { sourceName: string; reason: string }[];
}> {
  const central = and(isNull(questions.tenantId), isNotNull(questions.sourceName));
  const [imageRows, textRows] = await Promise.all([
    db
      .select({ id: questions.id, sourceName: questions.sourceName })
      .from(questions)
      .where(and(central, isNull(questions.bodyTypst))),
    db
      .select({ id: questions.id, sourceName: questions.sourceName })
      .from(questions)
      .where(and(central, isNotNull(questions.bodyTypst))),
  ]);

  const plan = planImageQuestionRetirement({
    imageRows,
    textRows,
    twinTextIdBySourceName: await resolveTwins(imageRows, textRows),
  });
  if (plan.retire.length === 0) {
    return { retired: 0, repointed: 0, deduped: 0, skipped: plan.skipped };
  }

  let repointed = 0;
  let deduped = 0;
  await db.transaction(async (tx) => {
    for (const { imageId, textId } of plan.retire) {
      const references = await tx
        .select({ id: examQuestions.id, examId: examQuestions.examId })
        .from(examQuestions)
        .where(eq(examQuestions.questionId, imageId));
      for (const reference of references) {
        // `exam_questions` is unique on (exam_id, question_id). An exam that
        // somehow holds BOTH shapes of one question cannot take the repoint —
        // it would collide — and it does not want two copies printed either,
        // so the screenshot's slot goes away and the text one stays.
        const [alreadyHasText] = await tx
          .select({ id: examQuestions.id })
          .from(examQuestions)
          .where(and(eq(examQuestions.examId, reference.examId), eq(examQuestions.questionId, textId)));
        if (alreadyHasText) {
          await tx.delete(examQuestions).where(eq(examQuestions.id, reference.id));
          deduped += 1;
          continue;
        }
        await tx.update(examQuestions).set({ questionId: textId }).where(eq(examQuestions.id, reference.id));
        repointed += 1;
      }
    }
    // Chunked: `IN (...)` with a few thousand parameters trips the driver, the
    // same reason `verify-lot-seeding.ts` pages its lookups.
    const ids = plan.retire.map((pair) => pair.imageId);
    for (let i = 0; i < ids.length; i += 200) {
      await tx.delete(questions).where(inArray(questions.id, ids.slice(i, i + 200)));
    }
  });

  return { retired: plan.retire.length, repointed, deduped, skipped: plan.skipped };
}
