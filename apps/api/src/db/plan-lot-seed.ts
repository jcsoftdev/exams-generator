import { hashBodyTypst } from "../modules/bank/domain/hash-body-typst";
import { stripSolutionTail } from "../modules/bank/domain/strip-solution-tail";

/**
 * One question as the harvest pipeline writes it into `db/data/lots/*.json`
 * (see `docs/question-collection-pipeline.md`). A `structured` entry carries its
 * statement and alternatives, optionally with a complement figure; an `image`
 * entry is a whole question baked into one PNG, which is what a source gives us
 * when its math cannot be transcribed faithfully.
 */
export interface LotEntry {
  readonly courseName: string;
  readonly topicName: string;
  readonly gradeLevel: string;
  readonly difficulty: string;
  readonly bodyTypst?: string;
  readonly alternatives?: readonly string[];
  readonly correctAnswer: string;
  readonly imagePath?: string;
  readonly sourceUrl?: string;
  readonly sourceName: string;
}

export interface PlannedQuestion extends LotEntry {
  readonly type: "structured" | "image";
  /** Absent for image questions — they have no statement to hash. */
  readonly bodyHash?: string;
}

export interface PlanLotSeedInput {
  readonly entries: readonly LotEntry[];
  /** Statement hashes already in the central bank. */
  readonly existingBodyHashes: ReadonlySet<string>;
  /** `source_name` values already in the central bank — how image questions dedupe. */
  readonly existingSourceNames: ReadonlySet<string>;
  /** imagePath -> sha256 of that file's bytes, for the figure-aware hash. */
  readonly figureFingerprints: ReadonlyMap<string, string>;
}

export interface LotSeedPlan {
  readonly toInsert: readonly PlannedQuestion[];
  readonly skipped: number;
  readonly invalid: readonly { entry: LotEntry; reason: string }[];
}

/**
 * Decides which entries of a harvested lot are new, without touching the
 * database or the object store, so the decision is testable on its own.
 *
 * Two different dedup keys, because the two question types have different
 * identities: a structured question is its statement (plus its figure — one
 * circuits wording covers a dozen drawings, each with its own answer), and an
 * image question is only a PNG, so it dedupes on the provenance string the
 * harvest wrote for it.
 */
export function planLotSeed(input: PlanLotSeedInput): LotSeedPlan {
  const toInsert: PlannedQuestion[] = [];
  const invalid: { entry: LotEntry; reason: string }[] = [];
  const seenHashes = new Set(input.existingBodyHashes);
  const seenSourceNames = new Set(input.existingSourceNames);
  let skipped = 0;

  for (const entry of input.entries) {
    if (!entry.sourceName.trim()) {
      invalid.push({ entry, reason: "sourceName is empty, so the entry could never be deduped" });
      continue;
    }

    const isStructured = typeof entry.bodyTypst === "string" && entry.bodyTypst.trim().length > 0;
    if (!isStructured) {
      if (!entry.imagePath) {
        invalid.push({ entry, reason: "neither a statement nor an image" });
        continue;
      }
      if (seenSourceNames.has(entry.sourceName)) {
        skipped++;
        continue;
      }
      seenSourceNames.add(entry.sourceName);
      toInsert.push({ ...entry, type: "image" });
      continue;
    }

    const fingerprint = entry.imagePath ? input.figureFingerprints.get(entry.imagePath) : undefined;
    const bodyHash = hashBodyTypst(entry.bodyTypst as string, fingerprint);
    if (seenHashes.has(bodyHash)) {
      skipped++;
      continue;
    }
    // Added before the write, not after: two entries of the same batch sharing a
    // statement would otherwise both pass and collide on the unique index.
    seenHashes.add(bodyHash);
    // The crop-and-OCR pass sometimes carries the booklet's footer into the
    // last alternative — "15 2da. Prueba Examen de Admisión 2020-1" — which
    // then prints on the student's paper (audit 2026-08-20, H2). Stripped
    // AFTER hashing so the dedup key stays keyed to the harvested statement.
    toInsert.push({
      ...entry,
      type: "structured",
      bodyHash,
      ...(entry.alternatives
        ? { alternatives: entry.alternatives.map((alternative) => stripSolutionTail(alternative)) }
        : {}),
    });
  }

  return { toInsert, skipped, invalid };
}
