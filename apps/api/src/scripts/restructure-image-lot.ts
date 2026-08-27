import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FigureCropJob, LotTranscription, applyLotTranscriptions } from "../db/apply-lot-transcriptions";
import { LotEntry } from "../db/plan-lot-seed";

const LOTS_DIR = join(__dirname, "..", "db", "data", "lots");
const CROP_FIGURE_BOX = join(__dirname, "..", "..", "..", "..", "tools", "harvest", "crop_figure_box.py");

interface LotFile {
  readonly entries: readonly LotEntry[];
}

/**
 * Promotes a harvested lot's whole-question PNGs back into text questions,
 * WITHOUT a vision provider.
 *
 * `tools/harvest/build_lot.py --all-images` bakes every question of a source
 * exam into a screenshot when `pdftotext` mangles that PDF's symbol font. It
 * was used on 30 lots, so 1542 of the bank's questions are pictures of someone
 * else's exam sheet — its numbering, its lowercase `a)`-`e)` lettering, its
 * watermarks and slivers of the neighbouring question — and they print that
 * way (12 of 70 questions in the 2026-08-23 exam).
 *
 * The reader here is the agent session working in this repository: it can open
 * a PNG directly, so paying an external endpoint to describe one would be
 * spending money on a capability already present. That splits the job in two,
 * which is also why it is resumable:
 *
 *   --export   list the crops still pending, with the path to open
 *   --apply    fold a batch of hand-written transcriptions back into the lot
 *
 * Everything that decides anything lives in `apply-lot-transcriptions.ts` and
 * `plan-image-lot-restructure.ts`, under unit test. This file is the I/O shell.
 */

export interface WorklistItem {
  readonly imagePath: string;
  /** Absolute path, so the reader can open it without resolving anything. */
  readonly absolutePath: string;
  readonly courseName: string;
  readonly topicName: string;
  readonly sourceName: string;
}

/**
 * Compiles one transcription with the real Typst binary before it is allowed
 * near the bank.
 *
 * The reader here is an agent session, not a provider, so there is no schema
 * validation and no retry loop standing between a typo and the exam — a
 * mismatched delimiter in one statement fails the WHOLE document, taking 69
 * correct questions down with it. Typst is already installed and pinned to the
 * version `infra/Dockerfile.api` ships (0.15.1), so checking costs nothing but
 * milliseconds and is the only check that cannot be fooled.
 *
 * Body and alternatives are compiled TOGETHER, in the same shape
 * `typst-template.ts` renders them, because that is where an unbalanced `$`
 * actually bites: it swallows the text after it rather than erroring in place.
 */
export function verifyTranscriptionCompiles(transcription: LotTranscription): string | undefined {
  if (transcription.unreadable) {
    return undefined;
  }

  const directory = mkdtempSync(join(tmpdir(), "lot-typst-"));
  try {
    const source = join(directory, "check.typ");
    const document = [
      transcription.bodyTypst ?? "",
      transcription.figureCode ?? "",
      ...(transcription.alternatives ?? []),
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");
    writeFileSync(source, `${document}\n`, "utf8");
    execFileSync("typst", ["compile", source, join(directory, "check.pdf")], { stdio: "pipe" });

    return undefined;
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim();

    return stderr && stderr.length > 0 ? stderr : String(error);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function verifyAll(
  transcriptions: readonly LotTranscription[],
): Array<{ imagePath: string; error: string }> {
  return transcriptions.flatMap((transcription) => {
    const error = verifyTranscriptionCompiles(transcription);

    return error ? [{ imagePath: transcription.imagePath, error }] : [];
  });
}

export function exportWorklist(lot: string, limit?: number): WorklistItem[] {
  const imageLot = readLot(`${lot}-image`);

  return imageLot.entries
    .filter((entry): entry is LotEntry & { imagePath: string } => Boolean(entry.imagePath))
    .slice(0, limit ?? undefined)
    .map((entry) => ({
      imagePath: entry.imagePath,
      absolutePath: join(LOTS_DIR, entry.imagePath),
      courseName: entry.courseName,
      topicName: entry.topicName,
      sourceName: entry.sourceName,
    }));
}

export function applyTranscriptionFile(
  lot: string,
  transcriptions: readonly LotTranscription[],
  options: { readonly prune?: boolean } = {},
): {
  promoted: number;
  pending: number;
  reasons: readonly string[];
  unmatched: readonly string[];
  figuresCut: number;
  /** Whole-question crops no entry references any more. */
  orphans: readonly string[];
} {
  // Refuse the batch rather than downgrading the offenders back to images: a
  // compile error means the transcription is wrong, and the fix is to correct
  // it, not to quietly leave the question as the screenshot it already was.
  const broken = verifyAll(transcriptions);
  if (broken.length > 0) {
    throw new Error(
      `${broken.length} transcription(s) do not compile:\n${broken
        .map(({ imagePath, error }) => `  ${imagePath}\n    ${error.split("\n").join("\n    ")}`)
        .join("\n")}`,
    );
  }

  const imageLot = readLot(`${lot}-image`);
  const structuredLot = readStructuredLot(lot);

  const result = applyLotTranscriptions({
    imageEntries: imageLot.entries,
    structuredEntries: structuredLot.entries,
    transcriptions,
  });

  // Cut the figures BEFORE rewriting the lots: an entry that points at a
  // complement file which does not exist fails `validate_lots.py` and, worse,
  // the seeder.
  result.figureCrops.forEach(cutFigure);

  writeJson(lotPath(lot), { entries: result.structuredEntries });
  writeJson(lotPath(`${lot}-image`), { entries: result.imageEntries });

  // The whole-question crop of a promoted entry is now dead weight that
  // `validate_lots.py` reports as an orphan on every run. Deleting is opt-in:
  // the file is regenerable from the lot's own `sourceUrl` via `build_lot.py`,
  // but it is still the only copy of what the reader actually looked at.
  const stillReferenced = new Set(
    [...result.structuredEntries, ...result.imageEntries]
      .map((entry) => entry.imagePath)
      .filter((imagePath): imagePath is string => Boolean(imagePath)),
  );
  const orphans = transcriptions
    .map((transcription) => transcription.imagePath)
    .filter((imagePath) => !stillReferenced.has(imagePath));
  if (options.prune) {
    orphans
      .filter((imagePath) => existsSync(join(LOTS_DIR, imagePath)))
      .forEach((imagePath) => {
        unlinkSync(join(LOTS_DIR, imagePath));
      });
  }

  return {
    promoted: result.structuredEntries.length - structuredLot.entries.length,
    pending: result.imageEntries.length,
    reasons: result.reasons,
    unmatched: result.unmatched,
    figuresCut: result.figureCrops.length,
    orphans,
  };
}

/** How much of the baked-image backlog is left, lot by lot. */
export function status(): Array<{ lot: string; pending: number }> {
  return readdirSync(LOTS_DIR)
    .filter((name) => name.endsWith("-image.json"))
    .map((name) => {
      const lot = name.replace(/-image\.json$/, "");

      return { lot, pending: readLot(`${lot}-image`).entries.length };
    })
    .filter((row) => row.pending > 0)
    .sort((a, b) => a.pending - b.pending);
}

/**
 * Shells out to Pillow rather than adding an image library to the API's
 * dependencies for a one-off repair pass — the harvest tools already crop this
 * way (`crop_pdf_figures.py`), so the capability is where the rest of it lives.
 */
function cutFigure(job: FigureCropJob): void {
  execFileSync("python3", [
    CROP_FIGURE_BOX,
    "--source",
    join(LOTS_DIR, job.source),
    "--target",
    join(LOTS_DIR, job.target),
    "--left",
    String(job.box.left),
    "--top",
    String(job.box.top),
    "--right",
    String(job.box.right),
    "--bottom",
    String(job.box.bottom),
  ]);
}

function lotPath(name: string): string {
  return join(LOTS_DIR, `${name}.json`);
}

function readLot(name: string): LotFile {
  return JSON.parse(readFileSync(lotPath(name), "utf8")) as LotFile;
}

/**
 * The text side of a lot, which does not exist yet when `build_lot.py` ran with
 * `--all-images`: every question of that exam was baked, so it wrote only
 * `<lot>-image.json`. Eight lots (`lot-25`, the seven `scan-*`) are in that
 * state, and reading the missing file was refusing 460 crops the pass is
 * supposed to promote. Starting from no entries is the same thing the file
 * would have said.
 */
function readStructuredLot(name: string): LotFile {
  return existsSync(lotPath(name)) ? readLot(name) : { entries: [] };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function valueOf(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);

  return index === -1 ? undefined : argv[index + 1];
}

const USAGE = [
  "usage:",
  "  restructure-image-lot --status",
  "  restructure-image-lot --lot <slug> --export [--limit N] [--out <file>]",
  "  restructure-image-lot --verify <file>",
  "  restructure-image-lot --lot <slug> --apply <file> [--prune]",
].join("\n");

if (require.main === module) {
  const argv = process.argv.slice(2);

  const verifyFile = valueOf(argv, "--verify");

  if (verifyFile) {
    const parsed = JSON.parse(readFileSync(verifyFile, "utf8")) as {
      transcriptions?: readonly LotTranscription[];
    };
    const broken = verifyAll(parsed.transcriptions ?? []);
    broken.forEach(({ imagePath, error }) => console.error(`FAIL ${imagePath}\n  ${error}`));
    console.log(
      `[restructure-image-lot] ${(parsed.transcriptions ?? []).length - broken.length} compile, ${broken.length} fail.`,
    );
    process.exitCode = broken.length > 0 ? 1 : 0;
  } else if (argv.includes("--status")) {
    const rows = status();
    rows.forEach((row) => console.log(`${String(row.pending).padStart(4)}  ${row.lot}`));
    console.log(`total pending: ${rows.reduce((sum, row) => sum + row.pending, 0)} in ${rows.length} lots`);
  } else {
    const lot = valueOf(argv, "--lot");
    const applyFile = valueOf(argv, "--apply");

    if (!lot) {
      console.error(USAGE);
      process.exitCode = 1;
    } else if (applyFile) {
      const parsed = JSON.parse(readFileSync(applyFile, "utf8")) as {
        transcriptions?: readonly LotTranscription[];
      };
      const { promoted, pending, reasons, unmatched, figuresCut, orphans } = applyTranscriptionFile(
        lot,
        parsed.transcriptions ?? [],
        { prune: argv.includes("--prune") },
      );
      console.log(
        `[restructure-image-lot] ${lot}: ${promoted} promoted to text, ${figuresCut} figures cut, ${pending} still images.`,
      );
      reasons.forEach((reason) => console.log(`  kept: ${reason}`));
      unmatched.forEach((imagePath) => console.log(`  unmatched: ${imagePath}`));
      if (orphans.length > 0) {
        console.log(
          argv.includes("--prune")
            ? `  pruned ${orphans.length} whole-question crops nothing references any more`
            : `  ${orphans.length} whole-question crops are now orphaned — re-run with --prune to delete them`,
        );
      }
    } else if (argv.includes("--export")) {
      const limit = valueOf(argv, "--limit");
      const items = exportWorklist(lot, limit ? Number(limit) : undefined);
      const out = valueOf(argv, "--out");
      const payload = { lot, pending: items };
      if (out) {
        writeJson(out, payload);
        console.log(`[restructure-image-lot] ${lot}: wrote ${items.length} pending crops to ${out}`);
      } else {
        console.log(JSON.stringify(payload, null, 2));
      }
    } else {
      console.error(USAGE);
      process.exitCode = 1;
    }
  }
}
