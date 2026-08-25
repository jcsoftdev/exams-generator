import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TextRegionDetectorPort, TextWord } from "../../domain/ports/text-region-detector.port";

export interface OcrRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Abstraction over "run the tesseract binary with these CLI args" — injectable
 * so the TSV parsing can be unit-tested with deterministic output and no
 * binary installed. Mirrors `CompileRunner` in `typst-cli.adapter.ts`.
 */
export type OcrRunner = (args: readonly string[]) => Promise<OcrRunResult>;

/** Reads an image's pixel dimensions; injected so the parser is testable without sharp. */
export type ImageSizeReader = (image: Buffer) => Promise<{ width: number; height: number }>;

const TESSERACT_TIMEOUT_MS = 30_000;

/**
 * Below this, the box is more likely noise than a word — and a phantom box is
 * the dangerous direction: erasing it from the raster mutilates the figure
 * underneath. A real word left unerased only widens the crop, which the
 * teacher then adjusts.
 */
const MIN_WORD_CONFIDENCE = 30;

/** `level` 5 is a word; 1..4 are page, block, paragraph and line. */
const WORD_LEVEL = "5";

export const spawnTesseractRunner: OcrRunner = (args) =>
  new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TESSERACT_TIMEOUT_MS);
    const child = spawn("tesseract", args, { signal: controller.signal });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (err) => {
      clearTimeout(timeout);
      reject(
        err.name === "AbortError" ? new Error(`tesseract timed out after ${TESSERACT_TIMEOUT_MS}ms`) : err,
      );
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });

/**
 * `TextRegionDetectorPort` over the `tesseract` CLI (installed in
 * `infra/Dockerfile.api` alongside typst). Runs with `tsv` output, which emits
 * one row per word with its pixel box and confidence.
 */
export class TesseractCliAdapter implements TextRegionDetectorPort {
  constructor(
    private readonly runner: OcrRunner = spawnTesseractRunner,
    private readonly readSize: ImageSizeReader = defaultReadSize,
  ) {}

  async detect(image: Buffer, _mimeType: string): Promise<readonly TextWord[]> {
    const { width, height } = await this.readSize(image);
    if (width === 0 || height === 0) {
      return [];
    }

    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-"));
    const input = path.join(dir, "page.png");
    try {
      await fs.writeFile(input, image);
      // `stdout` as the output base makes tesseract write the TSV to stdout
      // instead of a file, so there is nothing else to clean up.
      const result = await this.runner([input, "stdout", "-l", "spa", "--psm", "3", "tsv"]);
      if (result.exitCode !== 0) {
        throw new Error(`tesseract exited ${result.exitCode}: ${result.stderr.trim()}`);
      }
      return parseTsv(result.stdout, width, height);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
}

const defaultReadSize: ImageSizeReader = async (image) => {
  // Required lazily so the unit tests never load sharp's native binding.
  const sharp = (await import("sharp")).default;
  const meta = await sharp(image).metadata();
  return { width: meta.width ?? 0, height: meta.height ?? 0 };
};

/**
 * Turns tesseract's TSV into normalized words. Tolerant by design: a truncated
 * or empty document yields no words rather than throwing, because a failure to
 * find text must never cost the caller its transcription.
 */
function parseTsv(stdout: string, width: number, height: number): TextWord[] {
  const [header, ...rows] = stdout.split("\n");
  if (!header || !header.startsWith("level")) {
    return [];
  }

  const words: TextWord[] = [];
  for (const row of rows) {
    const cells = row.split("\t");
    if (cells.length < 12 || cells[0] !== WORD_LEVEL) {
      continue;
    }
    const text = cells[11]!.trim();
    const confidence = Number(cells[10]);
    if (text.length === 0 || !Number.isFinite(confidence) || confidence < MIN_WORD_CONFIDENCE) {
      continue;
    }
    const [left, top, boxWidth, boxHeight] = [cells[6], cells[7], cells[8], cells[9]].map(Number);
    if (![left, top, boxWidth, boxHeight].every((n) => Number.isFinite(n))) {
      continue;
    }
    words.push({
      text,
      box: { x: left! / width, y: top! / height, w: boxWidth! / width, h: boxHeight! / height },
      confidence,
    });
  }
  return words;
}
