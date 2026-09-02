# Detección de figuras por OCR — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que la figura de una pregunta fotografiada la ubique la geometría —OCR marca dónde hay texto, lo que queda con tinta es la figura— en vez de pedírsela a un modelo de visión que la reporta mal.

**Architecture:** Tesseract corre sobre la misma foto que va al modelo y devuelve la caja de cada palabra. Esas cajas se borran del raster en gris que `sharp` ya produce; los componentes conexos que sobreviven, por encima de un umbral de tamaño, son las figuras. Las letras `A)`–`E)` que el propio OCR ubica parten la imagen en bandas y atribuyen cada figura a su alternativa. El modelo de visión deja de reportar coordenadas y vuelve a tener un solo trabajo: transcribir.

**Tech Stack:** NestJS 10 + `sharp` (ya presente) + `tesseract-ocr` como binario de sistema, igual que `typst`. Tests: Jest, proyectos `non-e2e` y `e2e`.

**Spec:** `docs/superpowers/specs/2026-08-25-ocr-figure-detection-design.md`

## Global Constraints

- **Strict TDD.** El test que falla se escribe y se corre ANTES de la implementación, y se confirma que falla por la razón correcta.
- **Comando de test acotado** — pasar la ruta como argumento posicional NO filtra nada, corre las 120 suites igual. Usar siempre `--testPathPattern`:
  - `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern '<patrón>'`
  - e2e igual, con `--selectProjects e2e`.
- **El e2e completo se corre con `--runInBand`.** En paralelo produce fallos rotativos falsos por contención sobre el Postgres local; medido tres veces sobre el mismo commit.
- **`bank.e2e.spec.ts` falla y NO es de este trabajo** — verificado contra el commit base. No perseguirlo.
- **`typecheck` es un gate separado de los tests.** `tsconfig.build.json` excluye `**/*.spec.ts` y ts-jest corre con `isolatedModules`, así que **los tests pueden pasar con tipos de producción rotos**. Correr siempre `pnpm --filter @exams-generator/api typecheck`.
- **`pnpm format` antes de cada commit.** CI tiene un job `typecheck + format` que falla con cualquier diferencia de Prettier.
- **Nunca `pnpm build`.** `pnpm --filter @exams-generator/shared build` sí está permitido y es necesario en un worktree nuevo, donde `packages/shared/dist` no existe.
- Conventional Commits, en inglés. **Sin `Co-Authored-By` ni atribución de IA.**
- Comentarios y documentación en inglés; textos visibles al usuario en español.
- Coordenadas SIEMPRE normalizadas `0..1`, nunca píxeles, en cualquier contrato que cruce un límite.
- Constantes fijadas por el spec: `TEXT_ERASE_PADDING_PX = 3`, `MIN_FIGURE_WIDTH = 0.03`, `MIN_FIGURE_HEIGHT = 0.02`, `MIN_WORD_CONFIDENCE = 30`.
- Shell: `bat`/`rg`/`fd`/`eza`, no `cat`/`grep`/`find`/`ls`.

---

## File Structure

**Nuevo, dominio puro (`apps/api/src/modules/ai/domain/`)**
- `find-figure-regions.ts` — resta texto del raster y agrupa lo que queda. Sin I/O.
- `attribute-figure-to-alternative.ts` — reparte figuras entre complemento y alternativas, por bandas. Sin I/O.
- `ports/text-region-detector.port.ts` — el contrato del OCR.

**Nuevo, adaptador (`apps/api/src/modules/ai/adapters/ocr/`)**
- `tesseract-cli.adapter.ts` — invoca el binario, parsea TSV. Mismo patrón que `TypstCliAdapter`.

**Modificados**
- `extract-question.service.ts` — cambia de fuente de cajas.
- `domain/ports/question-generator.port.ts` — pierde `figureBox` y `alternativeBoxes`.
- `adapters/openrouter/openrouter-response-validator.ts` — pierde su validación.
- `adapters/openrouter/openrouter-request-builder.ts` — pierde `CROP_BOX_RULES`.
- `ai.module.ts`, `ai.constants.ts` — provider y token.
- `infra/Dockerfile.api` — el binario y su gate de build.

---

### Task 1: Tesseract — binario, puerto y adaptador

Primera tarea con riesgo de infraestructura, igual que `sharp` en el plan anterior. Va temprano a propósito: si la imagen no puede instalarlo, se descubre ahora.

**Files:**
- Modify: `infra/Dockerfile.api`
- Create: `apps/api/src/modules/ai/domain/ports/text-region-detector.port.ts`
- Create: `apps/api/src/modules/ai/adapters/ocr/tesseract-cli.adapter.ts`
- Test: `apps/api/src/modules/ai/adapters/ocr/tesseract-cli.adapter.spec.ts`
- Modify: `apps/api/src/modules/ai/ai.constants.ts`

**Interfaces:**
- Consumes: `NormalizedBox` de `../normalized-box` (ya existe).
- Produces:
  ```ts
  export interface TextWord { readonly text: string; readonly box: NormalizedBox; readonly confidence: number }
  export interface TextRegionDetectorPort { detect(image: Buffer, mimeType: string): Promise<readonly TextWord[]> }
  export interface OcrRunResult { readonly stdout: string; readonly stderr: string; readonly exitCode: number }
  export type OcrRunner = (args: readonly string[]) => Promise<OcrRunResult>
  export class TesseractCliAdapter implements TextRegionDetectorPort
  export const TEXT_REGION_DETECTOR_PORT: symbol
  ```

- [ ] **Step 1: Instalar el binario y verificar que la imagen lo lleva**

En `infra/Dockerfile.api`, en el `RUN apt-get` del stage `base` que ya instala las dependencias de typst, agregar `tesseract-ocr tesseract-ocr-spa` a la lista de paquetes que NO se purgan (`curl` y `xz-utils` sí se purgan; estos se quedan).

En el stage `runtime`, junto al `RUN node -e "require('sharp')"` que ya está, agregar:

```dockerfile
RUN tesseract --version
```

Verificar localmente que el binario existe antes de seguir:

```bash
tesseract --version
tesseract --list-langs
```

Expected: la versión, y `spa` en la lista de idiomas.

**Si `spa` no está**, instalarlo (`brew install tesseract-lang` en macOS) — sin el idioma español la segmentación de palabras es peor con tildes.

**Si el binario no está y no se puede instalar**, parar y reportar BLOCKED: todo el resto del plan depende de él.

- [ ] **Step 2: Escribir el test que falla**

```ts
// apps/api/src/modules/ai/adapters/ocr/tesseract-cli.adapter.spec.ts
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

    expect(words).toEqual([
      { text: "Hola", box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, confidence: 96 },
    ]);
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
        tsv([
          "5\t1\t1\t1\t1\t1\t20\t10\t40\t20\t96\tHola",
          "5\t1\t1\t1\t1\t2\t80\t10\t40\t20\t12\t~~",
        ]),
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
```

- [ ] **Step 3: Correr el test para verlo fallar**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern 'tesseract-cli'`
Expected: FAIL — `Cannot find module './tesseract-cli.adapter'`.

- [ ] **Step 4: Escribir el puerto**

```ts
// apps/api/src/modules/ai/domain/ports/text-region-detector.port.ts
import { NormalizedBox } from "../normalized-box";

/**
 * One word the OCR located, with its box in normalized 0..1 coordinates.
 *
 * `text` is deliberately NOT trusted as a transcription. The statement and its
 * formulas come from the vision model; what this port contributes is GEOMETRY.
 * OCR mangling `1/2` into `1 2` costs nothing here, because only the box is
 * used — except for one case: the alternative markers `A)`, `B)`, `C)` are
 * isolated glyphs that even a poor OCR reads correctly, and their positions are
 * what attributes a figure to its alternative.
 */
export interface TextWord {
  readonly text: string;
  readonly box: NormalizedBox;
  /** 0..100 as tesseract reports it. */
  readonly confidence: number;
}

/**
 * Locates the text in a photographed question, so whatever ink is left over
 * can be treated as its figure (design doc §3). Never reads the question.
 */
export interface TextRegionDetectorPort {
  detect(image: Buffer, mimeType: string): Promise<readonly TextWord[]>;
}
```

- [ ] **Step 5: Escribir el adaptador**

```ts
// apps/api/src/modules/ai/adapters/ocr/tesseract-cli.adapter.ts
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
        err.name === "AbortError"
          ? new Error(`tesseract timed out after ${TESSERACT_TIMEOUT_MS}ms`)
          : err,
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
```

- [ ] **Step 6: Agregar el token de DI**

```ts
// apps/api/src/modules/ai/ai.constants.ts — append
/** DI token for the `TextRegionDetectorPort` implementation the ai module uses. */
export const TEXT_REGION_DETECTOR_PORT = Symbol("TextRegionDetectorPort");
```

- [ ] **Step 7: Correr el test para verlo pasar**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern 'tesseract-cli'`
Expected: PASS — 6 tests.

- [ ] **Step 8: Typecheck, formato y commit**

```bash
pnpm --filter @exams-generator/api typecheck
pnpm format
git add infra/Dockerfile.api apps/api/src/modules/ai/domain/ports/text-region-detector.port.ts apps/api/src/modules/ai/adapters/ocr/ apps/api/src/modules/ai/ai.constants.ts
git commit -m "feat(api): add the text region detector port and its tesseract adapter"
```

---

### Task 2: `findFigureRegions` — la figura por resta

Función pura sobre el raster. Sin OCR, sin sharp, sin I/O: se testea con matrices escritas a mano, igual que `snapBoxToInk`.

**Files:**
- Create: `apps/api/src/modules/ai/domain/find-figure-regions.ts`
- Test: `apps/api/src/modules/ai/domain/find-figure-regions.spec.ts`

**Interfaces:**
- Consumes: `ImageRaster` de `./snap-box-to-ink`; `NormalizedBox`, `toPixelRect`, `toNormalizedBox` de `./normalized-box`; `TextWord` de `./ports/text-region-detector.port`.
- Produces: `findFigureRegions(raster: ImageRaster, words: readonly TextWord[]): readonly NormalizedBox[]`.

- [ ] **Step 1: Escribir el test que falla**

```ts
// apps/api/src/modules/ai/domain/find-figure-regions.spec.ts
import { findFigureRegions } from "./find-figure-regions";
import { ImageRaster } from "./snap-box-to-ink";
import { TextWord } from "./ports/text-region-detector.port";

const WHITE = 255;
const BLACK = 0;
const SIZE = 20;

/** A 20x20 white raster with black rectangles painted into it, in pixel terms. */
function raster(rects: readonly { left: number; top: number; width: number; height: number }[]): ImageRaster {
  const gray = new Uint8Array(SIZE * SIZE).fill(WHITE);
  for (const rect of rects) {
    for (let y = rect.top; y < rect.top + rect.height; y++) {
      for (let x = rect.left; x < rect.left + rect.width; x++) {
        gray[y * SIZE + x] = BLACK;
      }
    }
  }
  return { gray, width: SIZE, height: SIZE };
}

function word(left: number, top: number, width: number, height: number): TextWord {
  return {
    text: "x",
    box: { x: left / SIZE, y: top / SIZE, w: width / SIZE, h: height / SIZE },
    confidence: 90,
  };
}

describe("findFigureRegions", () => {
  it("finds the single block of ink when there is no text at all", () => {
    const regions = findFigureRegions(raster([{ left: 4, top: 4, width: 8, height: 8 }]), []);

    expect(regions).toHaveLength(1);
    expect(regions[0]!.x).toBeCloseTo(4 / SIZE, 5);
    expect(regions[0]!.w).toBeCloseTo(8 / SIZE, 5);
  });

  it("MUST: erases the text and keeps only the figure", () => {
    // Text band across the top, figure below it.
    const ink = raster([
      { left: 1, top: 1, width: 18, height: 3 },
      { left: 5, top: 10, width: 8, height: 8 },
    ]);

    const regions = findFigureRegions(ink, [word(1, 1, 18, 3)]);

    expect(regions).toHaveLength(1);
    // The surviving region is the lower block, not the erased text band.
    expect(regions[0]!.y).toBeGreaterThan(0.4);
  });

  it("returns nothing when every bit of ink was text", () => {
    const ink = raster([{ left: 1, top: 1, width: 18, height: 3 }]);

    expect(findFigureRegions(ink, [word(1, 1, 18, 3)])).toEqual([]);
  });

  it("discards a speck below the size floor", () => {
    const regions = findFigureRegions(raster([{ left: 9, top: 9, width: 1, height: 1 }]), []);

    expect(regions).toEqual([]);
  });

  it("MUST: discards a wide hairline — a rule or a page edge has area but no height", () => {
    // 18 wide, 1 tall: plenty of area, nothing like a figure.
    const regions = findFigureRegions(raster([{ left: 1, top: 10, width: 18, height: 1 }]), []);

    expect(regions).toEqual([]);
  });

  it("separates two figures that do not touch", () => {
    const regions = findFigureRegions(
      raster([
        { left: 1, top: 1, width: 6, height: 6 },
        { left: 12, top: 12, width: 6, height: 6 },
      ]),
      [],
    );

    expect(regions).toHaveLength(2);
  });

  it("ignores a word box that lies outside the canvas instead of throwing", () => {
    const wild: TextWord = { text: "x", box: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 }, confidence: 90 };

    expect(() =>
      findFigureRegions(raster([{ left: 4, top: 4, width: 8, height: 8 }]), [wild]),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern 'find-figure-regions'`
Expected: FAIL — `Cannot find module './find-figure-regions'`.

- [ ] **Step 3: Escribir la implementación**

```ts
// apps/api/src/modules/ai/domain/find-figure-regions.ts
import { NormalizedBox, toNormalizedBox, toPixelRect } from "./normalized-box";
import { TextWord } from "./ports/text-region-detector.port";
import { ImageRaster, snapBoxToInk } from "./snap-box-to-ink";

/** Tesseract's word box clips accents and descenders; erase a little wider than it reports. */
const TEXT_ERASE_PADDING_PX = 3;

/**
 * A surviving component has to clear BOTH floors, not an area threshold: a
 * long hairline — an underline, the edge of the sheet, a table rule — has area
 * to spare and is not a figure.
 */
const MIN_FIGURE_WIDTH = 0.03;
const MIN_FIGURE_HEIGHT = 0.02;

/** Same relative-contrast idea as `snapBoxToInk`: grey paper is not ink. */
const INK_THRESHOLD = 160;

/**
 * The figures in a photographed question, found by subtraction: erase every
 * word the OCR located, and whatever ink survives in a big enough blob is a
 * drawing (design doc §5).
 *
 * Pure: no OCR call, no image library. The raster comes from
 * `ImageCropperPort.raster` and the words from `TextRegionDetectorPort`.
 */
export function findFigureRegions(
  raster: ImageRaster,
  words: readonly TextWord[],
): readonly NormalizedBox[] {
  const ink = eraseText(raster, words);
  const components = connectedComponents(ink, raster.width, raster.height);

  return components
    .map((rect) => toNormalizedBox(rect, raster.width, raster.height))
    .filter((box) => box.w >= MIN_FIGURE_WIDTH && box.h >= MIN_FIGURE_HEIGHT)
    .map((box) => snapBoxToInk({ ...raster, gray: ink }, box, 0));
}

/** A copy of the raster with every word's box (plus padding) painted white. */
function eraseText(raster: ImageRaster, words: readonly TextWord[]): Uint8Array {
  const ink = new Uint8Array(raster.gray);

  for (const word of words) {
    const clamped: NormalizedBox = {
      x: Math.max(word.box.x, 0),
      y: Math.max(word.box.y, 0),
      w: Math.min(word.box.w, 1 - Math.max(word.box.x, 0)),
      h: Math.min(word.box.h, 1 - Math.max(word.box.y, 0)),
    };
    if (clamped.w <= 0 || clamped.h <= 0) {
      continue;
    }

    const rect = toPixelRect(clamped, raster.width, raster.height);
    const left = Math.max(rect.left - TEXT_ERASE_PADDING_PX, 0);
    const top = Math.max(rect.top - TEXT_ERASE_PADDING_PX, 0);
    const right = Math.min(rect.left + rect.width + TEXT_ERASE_PADDING_PX, raster.width);
    const bottom = Math.min(rect.top + rect.height + TEXT_ERASE_PADDING_PX, raster.height);

    for (let y = top; y < bottom; y++) {
      ink.fill(255, y * raster.width + left, y * raster.width + right);
    }
  }

  return ink;
}

/** Bounding box of every 4-connected blob of ink, found with an iterative flood fill. */
function connectedComponents(
  ink: Uint8Array,
  width: number,
  height: number,
): { left: number; top: number; width: number; height: number }[] {
  const seen = new Uint8Array(ink.length);
  const rects: { left: number; top: number; width: number; height: number }[] = [];

  for (let start = 0; start < ink.length; start++) {
    if (seen[start] || ink[start]! > INK_THRESHOLD) {
      continue;
    }

    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    // An explicit stack, not recursion: a full-page figure would blow the call
    // stack on a large photo.
    const stack = [start];
    seen[start] = 1;

    while (stack.length > 0) {
      const index = stack.pop()!;
      const x = index % width;
      const y = (index - x) / width;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const next of neighbours) {
        if (next >= 0 && !seen[next] && ink[next]! <= INK_THRESHOLD) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }

    rects.push({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 });
  }

  return rects;
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern 'find-figure-regions'`
Expected: PASS — 7 tests.

- [ ] **Step 5: Verificar por sabotage que el test del hairline discrimina**

Cambiar el filtro a `box.w >= MIN_FIGURE_WIDTH || box.h >= MIN_FIGURE_HEIGHT` (OR en vez de AND), correr, confirmar que "discards a wide hairline" falla, revertir.

- [ ] **Step 6: Typecheck, formato y commit**

```bash
pnpm --filter @exams-generator/api typecheck
pnpm format
git add apps/api/src/modules/ai/domain/find-figure-regions.ts apps/api/src/modules/ai/domain/find-figure-regions.spec.ts
git commit -m "feat(api): find a question's figures by erasing its text from the raster"
```

---

### Task 3: `attributeFigureToAlternative` — de qué alternativa es cada figura

La otra función pura. Acá SÍ se usa lo que el OCR transcribió, pero solo para las letras `A)`–`E)`: glifos aislados y grandes, el caso más fácil que existe para un OCR, y lo único de su transcripción en lo que este diseño confía.

**Files:**
- Create: `apps/api/src/modules/ai/domain/attribute-figure-to-alternative.ts`
- Test: `apps/api/src/modules/ai/domain/attribute-figure-to-alternative.spec.ts`

**Interfaces:**
- Consumes: `NormalizedBox` (Task 1 lo usa, ya existe); `TextWord` (Task 1).
- Produces:
  ```ts
  export interface AttributedFigures {
    readonly complement?: NormalizedBox;
    readonly byAlternative: readonly { readonly alternativeIndex: number; readonly box: NormalizedBox }[];
  }
  export function attributeFigureToAlternative(
    figures: readonly NormalizedBox[],
    words: readonly TextWord[],
  ): AttributedFigures;
  ```

- [ ] **Step 1: Escribir el test que falla**

```ts
// apps/api/src/modules/ai/domain/attribute-figure-to-alternative.spec.ts
import { attributeFigureToAlternative } from "./attribute-figure-to-alternative";
import { TextWord } from "./ports/text-region-detector.port";

function marker(text: string, y: number): TextWord {
  return { text, box: { x: 0.05, y, w: 0.04, h: 0.03 }, confidence: 95 };
}

function figure(y: number): { x: number; y: number; w: number; h: number } {
  return { x: 0.3, y, w: 0.2, h: 0.08 };
}

/** Markers at 0.50, 0.60, 0.70, 0.80, 0.90 — the alternatives block of a page. */
const MARKERS = [marker("A)", 0.5), marker("B)", 0.6), marker("C)", 0.7), marker("D)", 0.8), marker("E)", 0.9)];

describe("attributeFigureToAlternative", () => {
  it("MUST: a figure inside C)'s band belongs to alternative index 2", () => {
    const result = attributeFigureToAlternative([figure(0.72)], MARKERS);

    expect(result.byAlternative).toEqual([{ alternativeIndex: 2, box: figure(0.72) }]);
    expect(result.complement).toBeUndefined();
  });

  it("MUST: a figure above the first marker is the statement's complement", () => {
    const result = attributeFigureToAlternative([figure(0.2)], MARKERS);

    expect(result.complement).toEqual(figure(0.2));
    expect(result.byAlternative).toEqual([]);
  });

  it("splits several figures across their own alternatives", () => {
    const result = attributeFigureToAlternative([figure(0.52), figure(0.82)], MARKERS);

    expect(result.byAlternative.map((entry) => entry.alternativeIndex)).toEqual([0, 3]);
  });

  it("accepts the other marker punctuations a printed exam uses", () => {
    const dotted = [marker("a.", 0.5), marker("b.", 0.6), marker("c.", 0.7)];

    const result = attributeFigureToAlternative([figure(0.72)], dotted);

    expect(result.byAlternative).toEqual([{ alternativeIndex: 2, box: figure(0.72) }]);
  });

  it("with no marker recognised, every figure is complement — the common case degrading safely", () => {
    const result = attributeFigureToAlternative([figure(0.72)], [marker("Hola", 0.5)]);

    expect(result.complement).toEqual(figure(0.72));
    expect(result.byAlternative).toEqual([]);
  });

  it("keeps only the FIRST occurrence of a letter — the letter also appears inside the answers' text", () => {
    const noisy = [...MARKERS, marker("A)", 0.95)];

    const result = attributeFigureToAlternative([figure(0.96)], noisy);

    // 0.96 is below E)'s marker at 0.90, so it belongs to E (index 4), not to
    // the stray "A)" the OCR also found down there.
    expect(result.byAlternative).toEqual([{ alternativeIndex: 4, box: figure(0.96) }]);
  });

  it("takes at most one complement — a second figure above the markers is dropped, not stacked", () => {
    const result = attributeFigureToAlternative([figure(0.1), figure(0.2)], MARKERS);

    expect(result.complement).toEqual(figure(0.1));
    expect(result.byAlternative).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern 'attribute-figure'`
Expected: FAIL — `Cannot find module './attribute-figure-to-alternative'`.

- [ ] **Step 3: Escribir la implementación**

```ts
// apps/api/src/modules/ai/domain/attribute-figure-to-alternative.ts
import { NormalizedBox } from "./normalized-box";
import { TextWord } from "./ports/text-region-detector.port";

export interface AttributedFigure {
  readonly alternativeIndex: number;
  readonly box: NormalizedBox;
}

export interface AttributedFigures {
  /** The statement's own figure: the one above the first alternative marker. */
  readonly complement?: NormalizedBox;
  readonly byAlternative: readonly AttributedFigure[];
}

/** `a)`, `B.`, `c:` — a single letter a..e followed by one separator, alone in its box. */
const ALTERNATIVE_MARKER = /^([a-e])\s*[).:]$/i;

/**
 * Decides which alternative each figure belongs to, from geometry alone.
 *
 * The alternative markers split the page into bands: C)'s band runs from its
 * own top down to D)'s top. A figure whose vertical centre falls in that band
 * is C's drawing; a figure above the first marker is the statement's
 * complement.
 *
 * This replaces the `alternativeIndex` the vision model used to report. The
 * model was guessing; the page's own layout is not.
 *
 * With no marker recognised — a crooked photo, an OCR that missed them — every
 * figure is treated as complement. That is the safe degradation: the
 * complement is the common case, and the teacher reviews the crop before it is
 * ever saved.
 */
export function attributeFigureToAlternative(
  figures: readonly NormalizedBox[],
  words: readonly TextWord[],
): AttributedFigures {
  const markers = findMarkers(words);

  if (markers.length === 0) {
    return { ...(figures.length > 0 ? { complement: figures[0] } : {}), byAlternative: [] };
  }

  const firstMarkerTop = markers[0]!.top;
  const byAlternative: AttributedFigure[] = [];
  let complement: NormalizedBox | undefined;

  for (const box of figures) {
    const centre = box.y + box.h / 2;

    if (centre < firstMarkerTop) {
      // Only the topmost one: a question has a single complement figure, and a
      // second blob up there is noise rather than a second drawing.
      complement ??= box;
      continue;
    }

    const owner = [...markers].reverse().find((marker) => centre >= marker.top);
    if (owner) {
      byAlternative.push({ alternativeIndex: owner.index, box });
    }
  }

  return { ...(complement ? { complement } : {}), byAlternative };
}

/**
 * The first vertical occurrence of each letter a..e, in reading order.
 *
 * First occurrence only: the same letter shows up again inside the answers'
 * own text ("A) el conjunto A"), and a later match would carve a band where
 * there is none.
 */
function findMarkers(words: readonly TextWord[]): { index: number; top: number }[] {
  const topByLetter = new Map<string, number>();

  for (const word of [...words].sort((a, b) => a.box.y - b.box.y)) {
    const match = word.text.trim().match(ALTERNATIVE_MARKER);
    if (!match) {
      continue;
    }
    const letter = match[1]!.toLowerCase();
    if (!topByLetter.has(letter)) {
      topByLetter.set(letter, word.box.y);
    }
  }

  return [...topByLetter.entries()]
    .map(([letter, top]) => ({ index: letter.charCodeAt(0) - "a".charCodeAt(0), top }))
    .sort((a, b) => a.top - b.top);
}
```

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern 'attribute-figure'`
Expected: PASS — 7 tests.

- [ ] **Step 5: Verificar por sabotage que el test de la letra repetida discrimina**

Quitar el `if (!topByLetter.has(letter))` para que la ÚLTIMA ocurrencia gane, correr, confirmar que "keeps only the FIRST occurrence" falla, revertir.

- [ ] **Step 6: Typecheck, formato y commit**

```bash
pnpm --filter @exams-generator/api typecheck
pnpm format
git add apps/api/src/modules/ai/domain/attribute-figure-to-alternative.ts apps/api/src/modules/ai/domain/attribute-figure-to-alternative.spec.ts
git commit -m "feat(api): attribute each figure to its alternative by page geometry"
```

---

### Task 4: La extracción cambia de fuente de cajas

El servicio deja de leer las cajas del modelo y las calcula. Es la tarea de integración: junta el detector, la resta y la atribución.

**Files:**
- Modify: `apps/api/src/modules/ai/extract-question.service.ts`
- Modify: `apps/api/src/modules/ai/extract-question.service.spec.ts`
- Modify: `apps/api/src/modules/ai/ai.module.ts`

**Interfaces:**
- Consumes: `TextRegionDetectorPort` + `TEXT_REGION_DETECTOR_PORT` (Task 1), `findFigureRegions` (Task 2), `attributeFigureToAlternative` (Task 3), `ImageCropperPort` y `snapBoxToInk` (ya existen).
- Produces: nada nuevo — `AiExtractedQuestion` no cambia de forma. Lo que cambia es de dónde salen `figureCrop` y `alternativeCrops`.

- [ ] **Step 1: Escribir los tests que fallan**

En `extract-question.service.spec.ts`, extender `buildDeps()` con el detector y agregar el bloque:

```ts
import { TextRegionDetectorPort } from "./domain/ports/text-region-detector.port";

// dentro de buildDeps(), junto a los otros mocks:
  const detector: jest.Mocked<TextRegionDetectorPort> = {
    detect: jest.fn().mockResolvedValue([]),
  };
// ...y el servicio pasa a construirse con él:
//   new ExtractQuestionService(generator, cropper, cache, detector)

describe("ExtractQuestionService.extract — figures from OCR", () => {
  /** A raster with a black block in its lower half and nothing else. */
  const RASTER_WITH_FIGURE = {
    gray: (() => {
      const gray = new Uint8Array(20 * 20).fill(255);
      for (let y = 10; y < 18; y++) {
        gray.fill(0, y * 20 + 4, y * 20 + 16);
      }
      return gray;
    })(),
    width: 20,
    height: 20,
  };

  it("crops the ink the OCR did not mark as text", async () => {
    const { service, cropper, detector } = buildDeps();
    cropper.raster.mockResolvedValue(RASTER_WITH_FIGURE);
    detector.detect.mockResolvedValue([]);

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(result.figureCrop).toBeDefined();
    expect(cropper.crop).toHaveBeenCalledTimes(1);
  });

  it("MUST: finds nothing when the OCR covered every bit of ink", async () => {
    const { service, cropper, detector } = buildDeps();
    cropper.raster.mockResolvedValue(RASTER_WITH_FIGURE);
    // One word box over the whole black block.
    detector.detect.mockResolvedValue([
      { text: "texto", box: { x: 0.2, y: 0.5, w: 0.6, h: 0.4 }, confidence: 90 },
    ]);

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(result.figureCrop).toBeUndefined();
    expect(cropper.crop).not.toHaveBeenCalled();
  });

  it("MUST: still returns the transcription when the OCR blows up", async () => {
    const { service, detector } = buildDeps();
    detector.detect.mockRejectedValue(new Error("tesseract not found"));

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    expect(result.bodyTypst).toBe(EXTRACTED_QUESTION.bodyTypst);
    expect(result.figureCrop).toBeUndefined();
  });

  it("no longer reads figureBox from the model, even when it sends one", async () => {
    const { service, generator, cropper, detector } = buildDeps();
    // A model that still reports a box must not influence anything.
    generator.extractFromImage.mockResolvedValue({
      ...EXTRACTED_QUESTION,
      figureBox: { x: 0, y: 0, w: 1, h: 1 },
    } as never);
    cropper.raster.mockResolvedValue({ gray: new Uint8Array(400).fill(255), width: 20, height: 20 });
    detector.detect.mockResolvedValue([]);

    const result = await service.extract(USER, { buffer: fakePng(), mimetype: "image/png" });

    // Blank raster -> no ink -> no figure, regardless of what the model claimed.
    expect(result.figureCrop).toBeUndefined();
    expect(cropper.crop).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern 'extract-question.service'`
Expected: FAIL — `Expected 3 arguments, but got 4` en el constructor, y las aserciones de figura sin cumplirse.

- [ ] **Step 3: Reescribir `buildCrops`**

En `extract-question.service.ts`, el constructor gana el detector:

```ts
    @Inject(TEXT_REGION_DETECTOR_PORT) private readonly detector: TextRegionDetectorPort,
```

Y `buildCrops` cambia de firma y de cuerpo — ya no recibe cajas, las calcula:

```ts
  /**
   * Turns the photo into finished crops, with no help from the model: the OCR
   * marks the text, `findFigureRegions` keeps the ink that is left, and the
   * page's own alternative markers say which drawing belongs to which option.
   *
   * Deliberately total, exactly as before: any failure here — a missing
   * tesseract, an image sharp cannot decode, a crop that throws — is logged
   * and swallowed, and the caller still gets the transcription. The text is
   * the valuable half of this endpoint.
   */
  private async buildCrops(
    image: Buffer,
    mimeType: string,
  ): Promise<{ figureCrop?: AiQuestionCrop; alternativeCrops?: readonly AiAlternativeCrop[] }> {
    try {
      const [raster, words] = await Promise.all([
        this.cropper.raster(image, mimeType),
        this.detector.detect(image, mimeType),
      ]);

      const figures = findFigureRegions(raster, words);
      if (figures.length === 0) {
        return {};
      }

      const attributed = attributeFigureToAlternative(figures, words);

      const cropAt = async (box: NormalizedBox): Promise<AiQuestionCrop> => {
        const bytes = await this.cropper.crop(image, mimeType, box, CROP_MAX_WIDTH_PX);
        return { dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, box };
      };

      const figureCrop = attributed.complement ? await cropAt(attributed.complement) : undefined;

      const alternativeCrops: AiAlternativeCrop[] = [];
      for (const entry of attributed.byAlternative) {
        alternativeCrops.push({ alternativeIndex: entry.alternativeIndex, ...(await cropAt(entry.box)) });
      }

      return {
        ...(figureCrop ? { figureCrop } : {}),
        ...(alternativeCrops.length > 0 ? { alternativeCrops } : {}),
      };
    } catch (error) {
      this.logger.warn(
        `Figure detection failed, returning the transcription without figures: ${(error as Error).message}`,
      );
      return {};
    }
  }
```

En `extract()`, la llamada pierde los argumentos de caja y el destructuring de `figureBox`/`alternativeBoxes` desaparece:

```ts
    const crops = await this.buildCrops(file.buffer, mimeType);
```

`snapBoxToInk` ya no se llama desde acá — `findFigureRegions` lo aplica internamente a cada componente. Quitar su import si queda sin uso, y también `CROP_INK_PADDING_PX` si nadie más lo usa.

- [ ] **Step 4: Registrar el provider**

```ts
// apps/api/src/modules/ai/ai.module.ts — en `providers`
    { provide: TEXT_REGION_DETECTOR_PORT, useClass: TesseractCliAdapter },
```

- [ ] **Step 5: Correr los tests para verlos pasar**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern 'extract-question.service'`
Expected: PASS — los preexistentes más los 4 nuevos.

- [ ] **Step 6: Typecheck, formato y commit**

```bash
pnpm --filter @exams-generator/api typecheck
pnpm format
git add apps/api/src/modules/ai/extract-question.service.ts apps/api/src/modules/ai/extract-question.service.spec.ts apps/api/src/modules/ai/ai.module.ts
git commit -m "feat(api): source the crop boxes from OCR geometry instead of the model"
```

---

### Task 5: Sacarle las cajas al modelo

Ahora que nadie las lee, se van del contrato, de la validación y del prompt. Revierte la Task 4 y parte de la 5 del plan anterior, a propósito.

**Files:**
- Modify: `apps/api/src/modules/ai/domain/ports/question-generator.port.ts`
- Modify: `apps/api/src/modules/ai/adapters/openrouter/openrouter-response-validator.ts`
- Modify: `apps/api/src/modules/ai/adapters/openrouter/openrouter-request-builder.ts`
- Modify: sus dos spec files

**Interfaces:**
- Consumes: nada.
- Produces: `GeneratedQuestion` sin `figureBox` ni `alternativeBoxes`.

- [ ] **Step 1: Escribir el test que falla**

En `openrouter-request-builder.spec.ts`, reemplazar los tests que afirman las reglas de recuadro por su inverso:

```ts
  it("no longer asks the model for crop boxes — the figure is found by OCR, not reported", () => {
    const promptText = promptTextOf(buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT));

    // Asking a vision model for pixel coordinates is what this design replaced.
    // Re-adding these rules is the regression to catch.
    expect(promptText).not.toMatch(/figureBox/);
    expect(promptText).not.toMatch(/alternativeBoxes/);
    expect(promptText).not.toMatch(/recuadro/i);
  });

  it("the extract schema no longer declares the box fields", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT);

    const schema = body.response_format!.json_schema!.schema;
    expect(schema.properties).not.toHaveProperty("figureBox");
    expect(schema.properties).not.toHaveProperty("alternativeBoxes");
    expect(schema.required).not.toContain("figureBox");
  });
```

Y en `openrouter-response-validator.spec.ts`, borrar el `describe("validateGeneratedQuestionShape — crop boxes", ...)` entero y poner en su lugar:

```ts
describe("validateGeneratedQuestionShape — the model's boxes are ignored", () => {
  it("a model that still sends figureBox does not leak it into the question", () => {
    const { question } = validateGeneratedQuestionShape({
      bodyTypst: "¿Cuánto es $2 + 2$?",
      alternatives: ["3", "4", "5", "6", "7"],
      correctAnswer: "b",
      conceptsUsed: ["suma"],
      solutionSteps: 1,
      figureBox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
      alternativeBoxes: [null, null, null, null, null],
    });

    expect(question).not.toHaveProperty("figureBox");
    expect(question).not.toHaveProperty("alternativeBoxes");
    // The transcription still comes through untouched.
    expect(question.bodyTypst).toBe("¿Cuánto es $2 + 2$?");
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern 'openrouter'`
Expected: FAIL — el prompt todavía nombra `figureBox`, y el validador todavía lo copia a la salida.

- [ ] **Step 3: Sacar los campos del puerto**

En `question-generator.port.ts`, borrar de `GeneratedQuestion` el bloque `figureBox` / `alternativeBoxes` con su docstring, y el `import { NormalizedBox }` si queda sin uso.

- [ ] **Step 4: Sacar la validación**

En `openrouter-response-validator.ts`, borrar `readFigureBox`, `readAlternativeBoxes`, sus dos líneas en el objeto devuelto, y el import de `isValidNormalizedBox` si queda sin uso.

- [ ] **Step 5: Sacar las reglas del prompt**

En `openrouter-request-builder.ts`, borrar la constante `CROP_BOX_RULES` entera, su entrada en el array de `EXTRACT_SYSTEM_PROMPT`, la constante `NORMALIZED_BOX_SCHEMA`, y las dos propiedades `figureBox`/`alternativeBoxes` de `EXTRACT_RESPONSE_JSON_SCHEMA` junto con sus nombres en `required`.

- [ ] **Step 6: Correr los tests para verlos pasar**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e --testPathPattern 'openrouter'`
Expected: PASS.

- [ ] **Step 7: Regenerar el prompt volcado y medir**

```bash
pnpm --filter @exams-generator/api exec ts-node src/scripts/dump-extract-prompt.ts > .claude/extract-prompt.txt
```

Reportar el tamaño nuevo del system prompt en caracteres. Antes de esta tarea eran ~5.264.

- [ ] **Step 8: Typecheck, formato y commit**

```bash
pnpm --filter @exams-generator/api typecheck
pnpm format
git add apps/api/src/modules/ai/domain/ports/question-generator.port.ts apps/api/src/modules/ai/adapters/openrouter/
git commit -m "refactor(api): stop asking the vision model for crop coordinates"
```

---

### Task 6: Golden e2e contra el binario real

**Files:**
- Create: `apps/api/src/modules/ai/ai-extract-ocr.e2e.spec.ts`
- Create: `apps/api/src/modules/ai/__fixtures__/question-with-circuit.png`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Construir la imagen de prueba**

No hace falta una foto real: una imagen sintética con texto y un recuadro separado prueba exactamente lo mismo y es determinista. Generarla con `sharp` dentro del propio spec, componiendo texto renderizado por Typst o, más simple, un PNG con bandas de texto simuladas.

**La forma preferida** es un PNG real de una pregunta con circuito, guardado en `__fixtures__/`. Si no hay uno a mano, generarlo con `typst` (que ya está instalado) compilando un `.typ` con una línea de texto y un `#rect`, y exportando a PNG:

```bash
typst compile --format png fixture.typ question-with-circuit.png
```

- [ ] **Step 2: Escribir el e2e**

```ts
// apps/api/src/modules/ai/ai-extract-ocr.e2e.spec.ts
// Copiar el arranque de app y auth de `ai-extract.e2e.spec.ts`, sustituir
// QUESTION_GENERATOR_PORT por un stub que devuelve una transcripción fija, y
// dejar el detector y el cropper REALES.

  it("detects exactly one figure in a page whose text and drawing are separate", async () => {
    const png = await fs.readFile(path.join(__dirname, "__fixtures__", "question-with-circuit.png"));

    const response = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "question.png")
      .expect(200);

    expect(response.body.figureCrop).toBeDefined();
    expect(response.body.figureCrop.dataUrl).toMatch(/^data:image\/png;base64,/);
    // The crop is the drawing, not the whole page: a box that swallowed the
    // text would be nearly full height.
    expect(response.body.figureCrop.box.h).toBeLessThan(0.8);
    expect(response.body.alternativeCrops).toBeUndefined();
  });

  it("finds no figure in a page that is only text", async () => {
    const png = await fs.readFile(path.join(__dirname, "__fixtures__", "question-text-only.png"));

    const response = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "question.png")
      .expect(200);

    expect(response.body.figureCrop).toBeUndefined();
    expect(response.body.extractionId).toBeUndefined();
  });
```

- [ ] **Step 3: Correr el e2e**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects e2e --testPathPattern 'ai-extract-ocr'`
Expected: PASS — 2 tests.

**Si el binario no está instalado en la máquina**, el spec debe SALTARSE, no fallar — seguir el patrón de `isTypstAvailableSync()` en `typst-cli.adapter.golden.spec.ts` y escribir el equivalente `isTesseractAvailableSync()`.

- [ ] **Step 4: Verificación final y commit**

```bash
pnpm --filter @exams-generator/api typecheck
pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e
pnpm --filter @exams-generator/api exec jest --selectProjects e2e --runInBand
pnpm --filter @exams-generator/web test
pnpm format
git add apps/api/src/modules/ai/ai-extract-ocr.e2e.spec.ts apps/api/src/modules/ai/__fixtures__/
git commit -m "test(api): pin figure detection against the real tesseract binary"
```

`bank.e2e.spec.ts` sigue fallando y no es de este trabajo.

---

## Self-Review

**Cobertura del spec:**

| Sección del spec | Tarea |
|---|---|
| §4 Puerto nuevo y adaptador Tesseract | Task 1 |
| §5 El algoritmo por resta, con sus constantes | Task 2 |
| §6 Atribución a la alternativa | Task 3 |
| §7 Lo que se elimina | Task 5 |
| §8 Lo que no cambia | ninguna tarea lo toca, por diseño |
| §9 Errores | Task 4, Step 3 (el try/catch total) |
| §10 Pruebas | distribuidas |
| §11 Orden de implementación | el orden de las tareas lo respeta |

**Puntos de atención para quien ejecute:**

- **Task 1, Step 1 es un gate**: sin el binario y sin el idioma `spa`, nada de lo demás corre. Parar ahí si falla.
- `MIN_WORD_CONFIDENCE` vive en el ADAPTADOR (Task 1), no en el dominio: es propiedad de lo que tesseract reporta, no del algoritmo de resta. `find-figure-regions.ts` recibe palabras ya filtradas.
- `findFigureRegions` aplica `snapBoxToInk` internamente, así que Task 4 deja de llamarlo. Si después de esa tarea `CROP_INK_PADDING_PX` queda sin uso, se borra.
- Los dos sabotages (Task 2 Step 5, Task 3 Step 5) no son opcionales: son los dos tests cuyo valor es más fácil de perder al refactorizar.
