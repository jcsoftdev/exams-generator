import { OcrRunner, TesseractCliAdapter } from "./tesseract-cli.adapter";

/** Cabecera + filas reales del formato `tsv` de tesseract, recortadas a lo que el adaptador usa. */
const TSV_HEADER =
  "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext";

function tsv(rows: readonly string[]): string {
  return [TSV_HEADER, ...rows].join("\n");
}

/** El adaptador normaliza contra estas dimensiones, que le pasa el llamador. */
const SIZE = { width: 200, height: 100 };

function runnerReturning(stdout: string): OcrRunner {
  return async () => ({ stdout, stderr: "", exitCode: 0 });
}

describe("TesseractCliAdapter", () => {
  it("parses a word row into a normalized box", async () => {
    const adapter = new TesseractCliAdapter(
      runnerReturning(tsv(["5\t1\t1\t1\t1\t1\t20\t10\t40\t20\t96\tHola"])),
      async () => SIZE,
    );

    const words = await adapter.detect(Buffer.from("png"), "image/png");

    expect(words).toEqual([{ text: "Hola", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, confidence: 96 }]);
  });

  it("drops rows that are not words — tesseract emits page/block/line levels too", async () => {
    const adapter = new TesseractCliAdapter(
      runnerReturning(
        tsv([
          "1\t1\t0\t0\t0\t0\t0\t0\t200\t100\t-1\t",
          "4\t1\t1\t1\t1\t0\t20\t10\t40\t20\t-1\t",
          "5\t1\t1\t1\t1\t1\t20\t10\t40\t20\t96\tHola",
        ]),
      ),
      async () => SIZE,
    );

    const words = await adapter.detect(Buffer.from("png"), "image/png");

    expect(words.map((w) => w.text)).toEqual(["Hola"]);
  });

  it("drops a word below MIN_WORD_CONFIDENCE — a phantom box would erase real figure", async () => {
    const adapter = new TesseractCliAdapter(
      runnerReturning(
        tsv(["5\t1\t1\t1\t1\t1\t20\t10\t40\t20\t96\tHola", "5\t1\t1\t1\t1\t2\t80\t10\t40\t20\t12\t~~"]),
      ),
      async () => SIZE,
    );

    const words = await adapter.detect(Buffer.from("png"), "image/png");

    expect(words.map((w) => w.text)).toEqual(["Hola"]);
  });

  it("drops a word whose text is blank, whatever its confidence", async () => {
    const adapter = new TesseractCliAdapter(
      runnerReturning(tsv(["5\t1\t1\t1\t1\t1\t20\t10\t40\t20\t99\t   "])),
      async () => SIZE,
    );

    expect(await adapter.detect(Buffer.from("png"), "image/png")).toEqual([]);
  });

  it("returns empty for an empty or truncated TSV instead of throwing", async () => {
    const empty = new TesseractCliAdapter(runnerReturning(""), async () => SIZE);
    const truncated = new TesseractCliAdapter(runnerReturning("level\tpage"), async () => SIZE);

    expect(await empty.detect(Buffer.from("png"), "image/png")).toEqual([]);
    expect(await truncated.detect(Buffer.from("png"), "image/png")).toEqual([]);
  });

  it("throws when tesseract exits non-zero, so the caller can log and continue without a figure", async () => {
    const adapter = new TesseractCliAdapter(
      async () => ({ stdout: "", stderr: "Error opening data file", exitCode: 1 }),
      async () => SIZE,
    );

    await expect(adapter.detect(Buffer.from("png"), "image/png")).rejects.toThrow(/tesseract/i);
  });
});
