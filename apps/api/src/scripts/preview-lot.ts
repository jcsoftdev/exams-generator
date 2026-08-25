import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LotEntry } from "../db/plan-lot-seed";
import { renderExamTypst } from "../modules/exams/adapters/pdf/typst-template";

const LOTS_DIR = join(__dirname, "..", "db", "data", "lots");

/**
 * Renders a harvested lot through the REAL exam template and compiles it, so a
 * batch can be looked at before it ever reaches a database.
 *
 * Unit tests assert what the template emits; they cannot see what it prints.
 * Every layout defect found while restructuring lot 14 was invisible until a
 * page existed — a complement scan given `width: 100%` grew to nine
 * centimetres and pushed its own alternatives to the next page, five drawing
 * alternatives at `width: 35%` could not share a column, `$2/11$` stacked on
 * `$3/11$` overlapped, and an alternative image wrapped below its own `A)`.
 * None of those fail a compile.
 *
 * `--root /` because the template writes ABSOLUTE image paths and Typst
 * resolves them against the project root, not the filesystem root.
 */
export function previewLot(lot: string, filters: readonly string[]): { rendered: number; pdf: string } {
  const entries = readLot(lot);
  const questions = entries
    .filter((entry) => entry.bodyTypst)
    .filter((entry) => filters.length === 0 || filters.some((needle) => entry.sourceName.includes(needle)))
    .map((entry, index) => ({
      id: `q-${index}`,
      type: "structured" as const,
      bodyTypst: entry.bodyTypst,
      alternatives: entry.alternatives ?? [],
      figureCode: entry.figureCode,
      imageAbsolutePath: entry.imagePath ? join(LOTS_DIR, entry.imagePath) : undefined,
      alternativeImagePaths: entry.alternativeImagePaths?.map((path) =>
        path ? join(LOTS_DIR, path) : undefined,
      ),
    }));

  const directory = mkdtempSync(join(tmpdir(), "preview-lot-"));
  const source = join(directory, "preview.typ");
  const pdf = join(directory, "preview.pdf");
  writeFileSync(
    source,
    renderExamTypst({ title: `Vista previa — ${lot}`, versionLabel: "Forma A", questions } as never),
    "utf8",
  );
  execFileSync("typst", ["compile", "--root", "/", source, pdf], { stdio: "pipe" });

  return { rendered: questions.length, pdf };
}

function readLot(lot: string): LotEntry[] {
  return (JSON.parse(readFileSync(join(LOTS_DIR, `${lot}.json`), "utf8")) as { entries: LotEntry[] })
    .entries;
}

if (require.main === module) {
  const [lot, ...filters] = process.argv.slice(2);
  if (!lot) {
    console.error('usage: preview-lot <lot-slug> ["substring of sourceName" ...]');
    process.exitCode = 1;
  } else {
    const { rendered, pdf } = previewLot(lot, filters);
    console.log(`[preview-lot] ${rendered} questions -> ${pdf}`);
  }
}
