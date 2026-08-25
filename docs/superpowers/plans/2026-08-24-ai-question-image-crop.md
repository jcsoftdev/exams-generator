# Recorte con IA de gráficos de pregunta — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que al extraer una pregunta desde una foto, la IA localice el gráfico de complemento y las alternativas gráficas, el API los recorte, y el profesor pueda ajustar cada recorte antes de guardar.

**Architecture:** La IA devuelve bounding boxes normalizados (0..1) junto al texto. El API los ajusta a los límites reales de tinta y los recorta con `sharp`, devolviendo los recortes como `data:` URL dentro del borrador no persistido. La foto original queda cacheada en Redis bajo un `extractionId` para que el profesor pueda re-recortar sin volver a subirla. Al guardar, los recortes se persisten con los endpoints de banco que ya existen.

**Tech Stack:** NestJS 10 + Drizzle + Postgres + Redis (ioredis, ya presente vía BullMQ) + `sharp` (dependencia nueva) en el API; Angular con signals standalone en el web. Tests: Jest en el API (proyectos `non-e2e` y `e2e`), Vitest en el web.

**Spec:** `docs/superpowers/specs/2026-08-24-ai-question-image-crop-design.md`

## Global Constraints

- El proyecto corre en **Strict TDD**: cada tarea escribe el test que falla ANTES de la implementación, y se verifica que falle por la razón correcta.
- Comandos de test: API unitarios `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e <ruta>`; API e2e `pnpm --filter @exams-generator/api exec jest --selectProjects e2e <ruta>`; web `pnpm --filter @exams-generator/web test`.
- **Nunca correr build** (`pnpm build`) como parte de una tarea. Para verificar tipos: `pnpm --filter @exams-generator/api typecheck`.
- Commits en Conventional Commits, en inglés, **sin** `Co-Authored-By` ni atribución a IA.
- Comentarios y documentación de código en inglés; textos visibles al usuario en español peruano.
- Coordenadas de recorte SIEMPRE normalizadas `0..1`, nunca píxeles, en todo contrato que cruce un límite de proceso (puerto de IA, HTTP, DTO compartido).
- `sharp` es la ÚNICA dependencia nueva permitida por este plan.
- `packages/shared` no puede importar nada del API.
- Constantes fijadas por el spec: recorte reescalado a un ancho máximo de **1200 px**; TTL del cache de extracción **30 minutos**; padding del ajuste a tinta **8 px**.

---

## File Structure

**API — dominio nuevo (`apps/api/src/modules/ai/domain/`)**
- `normalized-box.ts` — el tipo `NormalizedBox`, su validación y la conversión a píxeles. Cero dependencias.
- `snap-box-to-ink.ts` — ajuste de un box a los límites reales de tinta. Función pura sobre un raster en gris.
- `ports/image-cropper.port.ts` — contrato de rasterizado y recorte.

**API — adaptador nuevo (`apps/api/src/modules/ai/adapters/image/`)**
- `sharp-image-cropper.adapter.ts` — única implementación de `ImageCropperPort`.

**API — cache de extracción (`apps/api/src/modules/ai/`)**
- `ports/extraction-cache.port.ts` + `adapters/cache/redis-extraction-cache.adapter.ts` — guarda la foto original entre la extracción y los re-recortes.

**API — modificados**
- `domain/ports/question-generator.port.ts` — suma `figureBox` y `alternativeBoxes` a `GeneratedQuestion`.
- `adapters/openrouter/openrouter-request-builder.ts` — schema JSON y reglas de prompt para los boxes.
- `adapters/openrouter/openrouter-response-validator.ts` — validación y normalización de los boxes.
- `extract-question.service.ts` — orquesta snap + recorte + cache.
- `recrop-question.service.ts` (nuevo) — el caso de uso del re-recorte manual.
- `ai.controller.ts`, `ai.module.ts`, `ai.constants.ts` — endpoint, providers y tokens.
- `common/redis.provider.ts` (nuevo) — cliente ioredis compartido.
- `modules/bank/*` — `setAlternativeImages` con slots esparsos.

**Web**
- `features/ai/ai.service.ts` — tipos de la respuesta de extracción y llamada de re-recorte.
- `features/bank/bank.service.ts` — subida de imágenes por alternativa.
- `features/bank/crop-review/crop-review.component.{ts,html}` — componente presentacional de ajuste.
- `features/bank/bank-new/bank-new.component.{ts,html}` — cableado.

---

### Task 1: `NormalizedBox` — tipo, validación y conversión a píxeles

Es la unidad más chica del sistema y todo lo demás la consume. Sin dependencias: ni Nest, ni `sharp`, ni red.

**Files:**
- Create: `apps/api/src/modules/ai/domain/normalized-box.ts`
- Test: `apps/api/src/modules/ai/domain/normalized-box.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: `interface NormalizedBox { readonly x: number; readonly y: number; readonly w: number; readonly h: number }`; `isValidNormalizedBox(value: unknown): value is NormalizedBox`; `toPixelRect(box: NormalizedBox, width: number, height: number): PixelRect` donde `interface PixelRect { readonly left: number; readonly top: number; readonly width: number; readonly height: number }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/ai/domain/normalized-box.spec.ts
import { isValidNormalizedBox, toPixelRect } from "./normalized-box";

describe("isValidNormalizedBox", () => {
  it("accepts a box fully inside the 0..1 canvas", () => {
    expect(isValidNormalizedBox({ x: 0.1, y: 0.2, w: 0.5, h: 0.4 })).toBe(true);
  });

  it("accepts a box that exactly fills the canvas", () => {
    expect(isValidNormalizedBox({ x: 0, y: 0, w: 1, h: 1 })).toBe(true);
  });

  it("rejects a box with a negative origin", () => {
    expect(isValidNormalizedBox({ x: -0.01, y: 0.2, w: 0.5, h: 0.4 })).toBe(false);
  });

  it("rejects a box with zero or negative extent", () => {
    expect(isValidNormalizedBox({ x: 0.1, y: 0.2, w: 0, h: 0.4 })).toBe(false);
    expect(isValidNormalizedBox({ x: 0.1, y: 0.2, w: 0.5, h: -0.1 })).toBe(false);
  });

  it("rejects a box that spills past the right or bottom edge", () => {
    expect(isValidNormalizedBox({ x: 0.8, y: 0.2, w: 0.3, h: 0.4 })).toBe(false);
    expect(isValidNormalizedBox({ x: 0.1, y: 0.9, w: 0.2, h: 0.2 })).toBe(false);
  });

  it("rejects non-finite numbers and non-objects", () => {
    expect(isValidNormalizedBox({ x: Number.NaN, y: 0.2, w: 0.5, h: 0.4 })).toBe(false);
    expect(isValidNormalizedBox({ x: 0.1, y: 0.2, w: Number.POSITIVE_INFINITY, h: 0.4 })).toBe(false);
    expect(isValidNormalizedBox(null)).toBe(false);
    expect(isValidNormalizedBox([0.1, 0.2, 0.5, 0.4])).toBe(false);
    expect(isValidNormalizedBox("0.1,0.2,0.5,0.4")).toBe(false);
  });

  it("rejects a box missing a component", () => {
    expect(isValidNormalizedBox({ x: 0.1, y: 0.2, w: 0.5 })).toBe(false);
  });
});

describe("toPixelRect", () => {
  it("scales and rounds the box to whole pixels", () => {
    expect(toPixelRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 800, 400)).toEqual({
      left: 200,
      top: 200,
      width: 400,
      height: 100,
    });
  });

  it("never returns a zero-sized rect for a very thin box", () => {
    const rect = toPixelRect({ x: 0, y: 0, w: 0.0001, h: 0.0001 }, 100, 100);
    expect(rect.width).toBeGreaterThanOrEqual(1);
    expect(rect.height).toBeGreaterThanOrEqual(1);
  });

  it("never returns a rect that spills past the image bounds", () => {
    const rect = toPixelRect({ x: 0.999, y: 0.999, w: 0.001, h: 0.001 }, 100, 100);
    expect(rect.left + rect.width).toBeLessThanOrEqual(100);
    expect(rect.top + rect.height).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/domain/normalized-box.spec.ts`
Expected: FAIL — `Cannot find module './normalized-box'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/modules/ai/domain/normalized-box.ts

/**
 * A rectangle in coordinates normalized to 0..1, relative to the image's own
 * width and height. Normalized rather than pixels because the vision model
 * never sees the original bytes: OpenRouter rescales the image before the
 * model reads it, so a pixel box the model reports means nothing against the
 * file we hold. A normalized box survives any resize on either side.
 */
export interface NormalizedBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** A rectangle in whole pixels, ready to hand to an image library. */
export interface PixelRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/**
 * True only for a box that is fully inside the canvas and has real extent.
 * Model output goes through here before anything else touches it — a box
 * that fails this check is DISCARDED, never clamped: a model that reports
 * `w: 1.4` did not mean "the whole width", it hallucinated, and cropping a
 * clamped version of a hallucination just produces a confident-looking wrong
 * picture.
 */
export function isValidNormalizedBox(value: unknown): value is NormalizedBox {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  const components = [candidate.x, candidate.y, candidate.w, candidate.h];
  if (!components.every((n) => typeof n === "number" && Number.isFinite(n))) {
    return false;
  }
  const { x, y, w, h } = candidate as unknown as NormalizedBox;
  if (w <= 0 || h <= 0 || x < 0 || y < 0) {
    return false;
  }
  return x + w <= 1 && y + h <= 1;
}

/**
 * Projects a normalized box onto a concrete pixel grid. Guarantees a rect of
 * at least 1x1 that never spills past the image, so callers can hand the
 * result straight to an extract/crop call without re-checking bounds.
 */
export function toPixelRect(box: NormalizedBox, width: number, height: number): PixelRect {
  const left = Math.min(Math.max(Math.round(box.x * width), 0), Math.max(width - 1, 0));
  const top = Math.min(Math.max(Math.round(box.y * height), 0), Math.max(height - 1, 0));
  const rectWidth = Math.min(Math.max(Math.round(box.w * width), 1), width - left);
  const rectHeight = Math.min(Math.max(Math.round(box.h * height), 1), height - top);
  return { left, top, width: rectWidth, height: rectHeight };
}

/** Inverse of `toPixelRect` — turns a pixel rect back into a normalized box. */
export function toNormalizedBox(rect: PixelRect, width: number, height: number): NormalizedBox {
  return {
    x: rect.left / width,
    y: rect.top / height,
    w: rect.width / width,
    h: rect.height / height,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/domain/normalized-box.spec.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai/domain/normalized-box.ts apps/api/src/modules/ai/domain/normalized-box.spec.ts
git commit -m "feat(api): add the normalized crop box type and its validation"
```

---

### Task 2: `snapBoxToInk` — ajustar el box flojo del modelo a la tinta real

Función pura sobre un raster en gris. Sin `sharp`, sin I/O: se testea con matrices escritas a mano.

**Files:**
- Create: `apps/api/src/modules/ai/domain/snap-box-to-ink.ts`
- Test: `apps/api/src/modules/ai/domain/snap-box-to-ink.spec.ts`

**Interfaces:**
- Consumes: `NormalizedBox`, `toPixelRect`, `toNormalizedBox` (Task 1).
- Produces: `interface ImageRaster { readonly gray: Uint8Array; readonly width: number; readonly height: number }` y `snapBoxToInk(raster: ImageRaster, box: NormalizedBox, paddingPx: number): NormalizedBox`. `ImageRaster` se declara aquí y `image-cropper.port.ts` (Task 3) lo re-exporta.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/ai/domain/snap-box-to-ink.spec.ts
import { ImageRaster, snapBoxToInk } from "./snap-box-to-ink";

const WHITE = 255;
const BLACK = 0;

/**
 * Builds an 8x8 white raster and paints a black rectangle into it, so each
 * test can state its ink position in plain pixel terms.
 */
function rasterWithInk(rect: { left: number; top: number; width: number; height: number }): ImageRaster {
  const width = 8;
  const height = 8;
  const gray = new Uint8Array(width * height).fill(WHITE);
  for (let y = rect.top; y < rect.top + rect.height; y++) {
    for (let x = rect.left; x < rect.left + rect.width; x++) {
      gray[y * width + x] = BLACK;
    }
  }
  return { gray, width, height };
}

describe("snapBoxToInk", () => {
  it("shrinks a loose box down to the ink it contains", () => {
    // Ink occupies pixels x:2..3, y:2..3 of an 8x8 canvas.
    const raster = rasterWithInk({ left: 2, top: 2, width: 2, height: 2 });
    // The model reported the whole canvas.
    const snapped = snapBoxToInk(raster, { x: 0, y: 0, w: 1, h: 1 }, 0);

    expect(snapped).toEqual({ x: 2 / 8, y: 2 / 8, w: 2 / 8, h: 2 / 8 });
  });

  it("grows a box that cut the ink in half, up to the full ink bounds", () => {
    const raster = rasterWithInk({ left: 1, top: 1, width: 6, height: 6 });
    // The model's box covers only the top-left quarter of the ink.
    const snapped = snapBoxToInk(raster, { x: 0, y: 0, w: 0.5, h: 0.5 }, 0);

    expect(snapped).toEqual({ x: 1 / 8, y: 1 / 8, w: 6 / 8, h: 6 / 8 });
  });

  it("applies the padding around the ink bounds", () => {
    const raster = rasterWithInk({ left: 3, top: 3, width: 2, height: 2 });
    const snapped = snapBoxToInk(raster, { x: 0, y: 0, w: 1, h: 1 }, 1);

    expect(snapped).toEqual({ x: 2 / 8, y: 2 / 8, w: 4 / 8, h: 4 / 8 });
  });

  it("clamps the padding at the canvas edge instead of spilling", () => {
    const raster = rasterWithInk({ left: 0, top: 0, width: 2, height: 2 });
    const snapped = snapBoxToInk(raster, { x: 0, y: 0, w: 1, h: 1 }, 3);

    expect(snapped.x).toBe(0);
    expect(snapped.y).toBe(0);
    expect(snapped.x + snapped.w).toBeLessThanOrEqual(1);
    expect(snapped.y + snapped.h).toBeLessThanOrEqual(1);
  });

  it("returns the original box untouched when the search area has no ink", () => {
    const raster: ImageRaster = { gray: new Uint8Array(64).fill(WHITE), width: 8, height: 8 };
    const box = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

    expect(snapBoxToInk(raster, box, 2)).toEqual(box);
  });

  it("does not read a uniformly grey background as ink", () => {
    // A photo of grey paper: every pixel is 160, no darker mark anywhere.
    const raster: ImageRaster = { gray: new Uint8Array(64).fill(160), width: 8, height: 8 };
    const box = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };

    expect(snapBoxToInk(raster, box, 0)).toEqual(box);
  });

  it("never grows beyond the bounded expansion margin around the model's box", () => {
    // Ink spans the whole canvas, but the model pointed at a tiny corner.
    const raster = rasterWithInk({ left: 0, top: 0, width: 8, height: 8 });
    const snapped = snapBoxToInk(raster, { x: 0, y: 0, w: 0.25, h: 0.25 }, 0);

    // Expansion is capped at half the reported box's size on each side, so a
    // box that pointed at a paragraph can never swallow the entire page.
    expect(snapped.w).toBeLessThanOrEqual(0.25 * 2);
    expect(snapped.h).toBeLessThanOrEqual(0.25 * 2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/domain/snap-box-to-ink.spec.ts`
Expected: FAIL — `Cannot find module './snap-box-to-ink'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/api/src/modules/ai/domain/snap-box-to-ink.ts
import { NormalizedBox, PixelRect, toNormalizedBox, toPixelRect } from "./normalized-box";

/** One luminance byte per pixel, row-major. */
export interface ImageRaster {
  readonly gray: Uint8Array;
  readonly width: number;
  readonly height: number;
}

/**
 * How far past the model's own box the snap is allowed to grow, as a
 * fraction of that box's size on each axis. Without a cap, a box the model
 * mistakenly placed over a paragraph would find ink in every direction and
 * expand until it swallowed the whole page.
 */
const MAX_EXPANSION_RATIO = 0.5;

/**
 * How much darker than the search area's own brightest pixels a pixel must
 * be to count as ink. Relative, not absolute: a photo of grey paper has no
 * pixel near 255, and an absolute threshold would read the entire sheet as
 * ink.
 */
const INK_CONTRAST = 0.35;

function searchArea(box: NormalizedBox, raster: ImageRaster): PixelRect {
  const expanded: NormalizedBox = {
    x: Math.max(box.x - box.w * MAX_EXPANSION_RATIO, 0),
    y: Math.max(box.y - box.h * MAX_EXPANSION_RATIO, 0),
    w: Math.min(box.w * (1 + MAX_EXPANSION_RATIO * 2), 1),
    h: Math.min(box.h * (1 + MAX_EXPANSION_RATIO * 2), 1),
  };
  const clamped: NormalizedBox = {
    ...expanded,
    w: Math.min(expanded.w, 1 - expanded.x),
    h: Math.min(expanded.h, 1 - expanded.y),
  };
  return toPixelRect(clamped, raster.width, raster.height);
}

/**
 * Reads the brightest and darkest luminance inside the area, and returns the
 * cutoff below which a pixel counts as ink — or `null` when the area has no
 * meaningful contrast at all (blank paper, uniform grey), which is the
 * caller's signal to leave the box alone.
 */
function inkThreshold(raster: ImageRaster, area: PixelRect): number | null {
  let darkest = 255;
  let brightest = 0;
  for (let y = area.top; y < area.top + area.height; y++) {
    for (let x = area.left; x < area.left + area.width; x++) {
      const value = raster.gray[y * raster.width + x]!;
      if (value < darkest) darkest = value;
      if (value > brightest) brightest = value;
    }
  }
  const span = brightest - darkest;
  if (span < 32) {
    return null;
  }
  return darkest + span * INK_CONTRAST;
}

/**
 * Tightens (or loosens) a bounding box reported by the vision model until it
 * hugs the actual ink, then pads it.
 *
 * Vision models report loose coordinates: they clip half a stroke, or leave
 * three centimetres of white margin. This is the same algorithm the offline
 * harvest pipeline already uses (`tools/harvest/figure_bounds.py`), ported to
 * TypeScript so the live extraction path produces crops as even as the ones
 * we hand-cut for the seeded lots.
 *
 * Returns the ORIGINAL box untouched when the search area carries no ink —
 * an empty crop is the human's problem to fix by hand, not something this
 * function should guess at.
 */
export function snapBoxToInk(raster: ImageRaster, box: NormalizedBox, paddingPx: number): NormalizedBox {
  const area = searchArea(box, raster);
  const threshold = inkThreshold(raster, area);
  if (threshold === null) {
    return box;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = area.top; y < area.top + area.height; y++) {
    for (let x = area.left; x < area.left + area.width; x++) {
      if (raster.gray[y * raster.width + x]! <= threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (minX === Number.POSITIVE_INFINITY) {
    return box;
  }

  const left = Math.max(minX - paddingPx, 0);
  const top = Math.max(minY - paddingPx, 0);
  const right = Math.min(maxX + paddingPx + 1, raster.width);
  const bottom = Math.min(maxY + paddingPx + 1, raster.height);

  return toNormalizedBox(
    { left, top, width: right - left, height: bottom - top },
    raster.width,
    raster.height,
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/domain/snap-box-to-ink.spec.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai/domain/snap-box-to-ink.ts apps/api/src/modules/ai/domain/snap-box-to-ink.spec.ts
git commit -m "feat(api): snap a model-reported crop box to the real ink bounds"
```

---

### Task 3: `ImageCropperPort` y el adaptador `sharp`

Primera tarea con riesgo de infraestructura: `sharp` es nativo. Va temprano a propósito — si la imagen de Docker pelea, se descubre ahora y no después de siete tareas.

`infra/Dockerfile.api` parte de `node:22-bookworm-slim` (Debian/glibc), así que el binario precompilado `@img/sharp-linux-x64` sirve sin instalar `vips`. Lo que hay que confirmar es que ese paquete opcional sobreviva el `pnpm deploy --prod --legacy` del stage de build.

**Files:**
- Create: `apps/api/src/modules/ai/domain/ports/image-cropper.port.ts`
- Create: `apps/api/src/modules/ai/adapters/image/sharp-image-cropper.adapter.ts`
- Test: `apps/api/src/modules/ai/adapters/image/sharp-image-cropper.adapter.spec.ts`
- Modify: `apps/api/package.json` (dependencia `sharp`)
- Modify: `apps/api/src/modules/ai/ai.constants.ts` (token de DI)

**Interfaces:**
- Consumes: `NormalizedBox`, `toPixelRect` (Task 1); `ImageRaster` (Task 2).
- Produces: `interface ImageCropperPort { raster(image: Buffer, mimeType: string): Promise<ImageRaster>; crop(image: Buffer, mimeType: string, box: NormalizedBox, maxWidthPx: number): Promise<Buffer> }`; `class SharpImageCropperAdapter implements ImageCropperPort`; `const IMAGE_CROPPER_PORT: symbol`.

- [ ] **Step 1: Install `sharp` and confirm it loads**

```bash
pnpm --filter @exams-generator/api add sharp
pnpm --filter @exams-generator/api exec node -e "const sharp = require('sharp'); sharp({create:{width:4,height:4,channels:3,background:'#fff'}}).png().toBuffer().then(b => console.log('sharp ok', b.length))"
```
Expected: imprime `sharp ok <n>` con `n > 0`.

- [ ] **Step 2: Confirm the production image still builds and carries the native binary**

```bash
docker build -f infra/Dockerfile.api -t exams-api-sharp-check .
docker run --rm --entrypoint node exams-api-sharp-check -e "require('sharp'); console.log('sharp present in runtime image')"
```
Expected: imprime `sharp present in runtime image`.

Si falla con `Could not load the "sharp" module using the linux-x64 runtime`, la causa es que `pnpm deploy --prod --legacy` no arrastró el paquete opcional de plataforma. Arreglo: agregar a `apps/api/package.json` el campo

```json
"pnpm": { "onlyBuiltDependencies": ["sharp"] }
```

y, si aún falta, declarar `@img/sharp-linux-x64` como `optionalDependencies` explícita. No seguir con el resto del plan hasta que este paso pase: todas las tareas siguientes dependen de que `sharp` corra en producción.

- [ ] **Step 3: Write the failing test**

```ts
// apps/api/src/modules/ai/adapters/image/sharp-image-cropper.adapter.spec.ts
import sharp from "sharp";
import { SharpImageCropperAdapter } from "./sharp-image-cropper.adapter";

/**
 * Builds a white PNG of the given size with one black rectangle painted into
 * it, so each assertion can talk about ink in plain pixel coordinates.
 */
async function pngWithBlackRect(
  width: number,
  height: number,
  rect: { left: number; top: number; width: number; height: number },
): Promise<Buffer> {
  const block = await sharp({
    create: { width: rect.width, height: rect.height, channels: 3, background: "#000000" },
  })
    .png()
    .toBuffer();

  return sharp({ create: { width, height, channels: 3, background: "#ffffff" } })
    .composite([{ input: block, left: rect.left, top: rect.top }])
    .png()
    .toBuffer();
}

describe("SharpImageCropperAdapter", () => {
  describe("raster", () => {
    it("returns one luminance byte per pixel with the image's real dimensions", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(40, 20, { left: 0, top: 0, width: 10, height: 10 });

      const raster = await adapter.raster(image, "image/png");

      expect(raster.width).toBe(40);
      expect(raster.height).toBe(20);
      expect(raster.gray.length).toBe(40 * 20);
    });

    it("reports ink where the black rectangle is and white elsewhere", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(40, 20, { left: 10, top: 5, width: 8, height: 8 });

      const raster = await adapter.raster(image, "image/png");

      // Inside the black rect.
      expect(raster.gray[6 * 40 + 12]).toBeLessThan(40);
      // Outside it.
      expect(raster.gray[1 * 40 + 1]).toBeGreaterThan(200);
    });
  });

  describe("crop", () => {
    it("extracts exactly the pixel rect the normalized box points at", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(100, 100, { left: 0, top: 0, width: 100, height: 100 });

      const cropped = await adapter.crop(image, "image/png", { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }, 1200);
      const meta = await sharp(cropped).metadata();

      expect(meta.format).toBe("png");
      expect(meta.width).toBe(50);
      expect(meta.height).toBe(25);
    });

    it("downscales a crop wider than maxWidthPx, preserving the aspect ratio", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(2000, 1000, { left: 0, top: 0, width: 2000, height: 1000 });

      const cropped = await adapter.crop(image, "image/png", { x: 0, y: 0, w: 1, h: 1 }, 1200);
      const meta = await sharp(cropped).metadata();

      expect(meta.width).toBe(1200);
      expect(meta.height).toBe(600);
    });

    it("leaves a crop narrower than maxWidthPx at its natural size", async () => {
      const adapter = new SharpImageCropperAdapter();
      const image = await pngWithBlackRect(300, 200, { left: 0, top: 0, width: 300, height: 200 });

      const cropped = await adapter.crop(image, "image/png", { x: 0, y: 0, w: 1, h: 1 }, 1200);
      const meta = await sharp(cropped).metadata();

      expect(meta.width).toBe(300);
    });

    it("rejects bytes that are not a decodable image", async () => {
      const adapter = new SharpImageCropperAdapter();

      await expect(
        adapter.crop(Buffer.from("not-an-image"), "image/png", { x: 0, y: 0, w: 1, h: 1 }, 1200),
      ).rejects.toThrow();
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/adapters/image/sharp-image-cropper.adapter.spec.ts`
Expected: FAIL — `Cannot find module './sharp-image-cropper.adapter'`.

- [ ] **Step 5: Write the port**

```ts
// apps/api/src/modules/ai/domain/ports/image-cropper.port.ts
import { NormalizedBox } from "../normalized-box";
import { ImageRaster } from "../snap-box-to-ink";

export { ImageRaster };

/**
 * Decoding and cropping of a photo — the domain never talks to an image
 * library directly (mirrors `StoragePort` / `PdfCompilerPort`).
 *
 * There is deliberately NO in-memory fake for this port. `sharp` is pure CPU
 * with no network and no state, so unit tests use an inline
 * `jest.Mocked<ImageCropperPort>` and e2e runs the real adapter against real
 * PNGs. A second implementation existing only for tests would be code
 * nothing ships and that can silently drift from the real one.
 */
export interface ImageCropperPort {
  /** Decodes the image to greyscale for ink analysis. */
  raster(image: Buffer, mimeType: string): Promise<ImageRaster>;

  /**
   * Extracts the normalized box and returns PNG bytes, downscaled to
   * `maxWidthPx` when the crop is wider than that.
   *
   * @throws when the bytes are not a decodable image.
   */
  crop(image: Buffer, mimeType: string, box: NormalizedBox, maxWidthPx: number): Promise<Buffer>;
}
```

- [ ] **Step 6: Write the adapter**

```ts
// apps/api/src/modules/ai/adapters/image/sharp-image-cropper.adapter.ts
import sharp from "sharp";
import { NormalizedBox, toPixelRect } from "../../domain/normalized-box";
import { ImageCropperPort, ImageRaster } from "../../domain/ports/image-cropper.port";

/** The only `ImageCropperPort` implementation — see the port's docstring. */
export class SharpImageCropperAdapter implements ImageCropperPort {
  async raster(image: Buffer, _mimeType: string): Promise<ImageRaster> {
    const { data, info } = await sharp(image)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });

    return { gray: new Uint8Array(data), width: info.width, height: info.height };
  }

  async crop(
    image: Buffer,
    _mimeType: string,
    box: NormalizedBox,
    maxWidthPx: number,
  ): Promise<Buffer> {
    const metadata = await sharp(image).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;
    if (width === 0 || height === 0) {
      throw new Error("Image has no readable dimensions");
    }

    const rect = toPixelRect(box, width, height);
    let pipeline = sharp(image).extract(rect);
    if (rect.width > maxWidthPx) {
      pipeline = pipeline.resize({ width: maxWidthPx });
    }
    return pipeline.png().toBuffer();
  }
}
```

- [ ] **Step 7: Add the DI token**

```ts
// apps/api/src/modules/ai/ai.constants.ts — append
/** DI token for the `ImageCropperPort` implementation the ai module uses. */
export const IMAGE_CROPPER_PORT = Symbol("ImageCropperPort");
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/adapters/image/sharp-image-cropper.adapter.spec.ts`
Expected: PASS — 6 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/modules/ai/domain/ports/image-cropper.port.ts apps/api/src/modules/ai/adapters/image/ apps/api/src/modules/ai/ai.constants.ts
git commit -m "feat(api): add the image cropper port and its sharp adapter"
```

---

### Task 4: la IA devuelve los bounding boxes

Extiende el contrato del puerto de generación, el schema JSON que se le pide a OpenRouter, el prompt de visión, y la validación de la respuesta.

Regla central: **un box malo nunca tumba la extracción de texto**. Se descarta en silencio y la pregunta se extrae igual.

**Files:**
- Modify: `apps/api/src/modules/ai/domain/ports/question-generator.port.ts`
- Modify: `apps/api/src/modules/ai/adapters/openrouter/openrouter-request-builder.ts`
- Modify: `apps/api/src/modules/ai/adapters/openrouter/openrouter-response-validator.ts`
- Test: `apps/api/src/modules/ai/adapters/openrouter/openrouter-response-validator.spec.ts` (existente, se extiende)
- Test: `apps/api/src/modules/ai/adapters/openrouter/openrouter-request-builder.spec.ts` (existente, se extiende)

**Interfaces:**
- Consumes: `NormalizedBox`, `isValidNormalizedBox` (Task 1).
- Produces: `GeneratedQuestion.figureBox?: NormalizedBox` y `GeneratedQuestion.alternativeBoxes?: readonly (NormalizedBox | null)[]`.

No se toca `InMemoryQuestionGeneratorAdapter`: sigue devolviendo una pregunta sin boxes, así los e2e existentes de `/ai/questions/extract` no cambian de comportamiento. Los e2e que necesitan boxes (Task 6) sustituyen `QUESTION_GENERATOR_PORT` por un stub propio.

- [ ] **Step 1: Write the failing validator test**

```ts
// apps/api/src/modules/ai/adapters/openrouter/openrouter-response-validator.spec.ts — append inside the file
describe("validateGeneratedQuestionShape — crop boxes", () => {
  /** A payload that already satisfies every pre-existing rule. */
  function basePayload(): Record<string, unknown> {
    return {
      bodyTypst: "¿Cuánto es $2 + 2$?",
      alternatives: ["3", "4", "5", "6", "7"],
      correctAnswer: "b",
      conceptsUsed: ["suma"],
      solutionSteps: 1,
    };
  }

  it("keeps a valid figureBox", () => {
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      figureBox: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 },
    });

    expect(question.figureBox).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.3 });
  });

  it("drops an out-of-canvas figureBox without failing the extraction", () => {
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      figureBox: { x: 0.8, y: 0.2, w: 0.5, h: 0.3 },
    });

    expect(question.figureBox).toBeUndefined();
    expect(question.bodyTypst).toBe("¿Cuánto es $2 + 2$?");
  });

  it("normalizes a null figureBox to undefined", () => {
    const { question } = validateGeneratedQuestionShape({ ...basePayload(), figureBox: null });

    expect(question.figureBox).toBeUndefined();
  });

  it("keeps alternativeBoxes with nulls for the text-only alternatives", () => {
    const box = { x: 0.1, y: 0.6, w: 0.15, h: 0.1 };
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      alternativeBoxes: [box, null, box, null, null],
    });

    expect(question.alternativeBoxes).toEqual([box, null, box, null, null]);
  });

  it("nulls out only the invalid entries of alternativeBoxes", () => {
    const good = { x: 0.1, y: 0.6, w: 0.15, h: 0.1 };
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      alternativeBoxes: [good, { x: 0.5, y: 0.5, w: 0.9, h: 0.1 }, null, null, null],
    });

    expect(question.alternativeBoxes).toEqual([good, null, null, null, null]);
  });

  it("drops alternativeBoxes entirely when its length does not match the alternatives", () => {
    const box = { x: 0.1, y: 0.6, w: 0.15, h: 0.1 };
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      alternativeBoxes: [box, null],
    });

    expect(question.alternativeBoxes).toBeUndefined();
  });

  it("drops alternativeBoxes when every entry is null — nothing to crop", () => {
    const { question } = validateGeneratedQuestionShape({
      ...basePayload(),
      alternativeBoxes: [null, null, null, null, null],
    });

    expect(question.alternativeBoxes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/adapters/openrouter/openrouter-response-validator.spec.ts`
Expected: FAIL — `expect(received).toEqual(expected)` con `question.figureBox` `undefined`, porque el validador todavía no lee el campo.

- [ ] **Step 3: Extend the port contract**

```ts
// apps/api/src/modules/ai/domain/ports/question-generator.port.ts
// Add near the top:
import { NormalizedBox } from "../normalized-box";

// Add inside `GeneratedQuestion`, after suggestedTopicName:
  /**
   * `extractFromImage` only — where the question's complement figure sits in
   * the photo. Absent when the question is text and formulas alone, which is
   * the common case; the UI shows no crop controls at all then.
   */
  readonly figureBox?: NormalizedBox;
  /**
   * `extractFromImage` only — one slot per alternative, `null` for the ones
   * that are plain text. Absent when no alternative is a drawing. Always the
   * same length as `alternatives` when present.
   */
  readonly alternativeBoxes?: readonly (NormalizedBox | null)[];
```

- [ ] **Step 4: Extend the validator**

```ts
// apps/api/src/modules/ai/adapters/openrouter/openrouter-response-validator.ts
// Add to the imports:
import { NormalizedBox, isValidNormalizedBox } from "../../domain/normalized-box";

/**
 * Crop boxes are best-effort geometry, never a validation error: a model that
 * reports a box spilling off the canvas hallucinated the geometry, not the
 * question. Dropping the box costs the human one manual crop; failing the
 * whole response would cost them the entire transcription.
 */
function readFigureBox(value: unknown): NormalizedBox | undefined {
  return isValidNormalizedBox(value) ? value : undefined;
}

function readAlternativeBoxes(
  value: unknown,
  alternativeCount: number,
): readonly (NormalizedBox | null)[] | undefined {
  if (!Array.isArray(value) || value.length !== alternativeCount) {
    return undefined;
  }
  const boxes = value.map((entry) => (isValidNormalizedBox(entry) ? entry : null));
  return boxes.some((box) => box !== null) ? boxes : undefined;
}

// In the returned `question` object literal, after suggestedTopicName:
      figureBox: readFigureBox(payload.figureBox),
      alternativeBoxes: readAlternativeBoxes(payload.alternativeBoxes, (alternatives as string[]).length),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/adapters/openrouter/openrouter-response-validator.spec.ts`
Expected: PASS — incluidos los 7 casos nuevos y todos los preexistentes.

- [ ] **Step 6: Write the failing request-builder test**

```ts
// apps/api/src/modules/ai/adapters/openrouter/openrouter-request-builder.spec.ts — append
describe("buildOpenRouterExtractRequestBody — crop boxes", () => {
  it("asks the schema for figureBox and alternativeBoxes", () => {
    const body = buildOpenRouterExtractRequestBody("some/vision-model", {
      image: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
    });

    const schema = body.response_format!.json_schema!.schema;
    expect(schema.properties).toHaveProperty("figureBox");
    expect(schema.properties).toHaveProperty("alternativeBoxes");
    // `strict: true` schemas require every declared property to be listed.
    expect(schema.required).toEqual(expect.arrayContaining(["figureBox", "alternativeBoxes"]));
  });

  it("tells the model the coordinates are fractions of the image, not pixels", () => {
    const body = buildOpenRouterExtractRequestBody("some/vision-model", {
      image: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      mimeType: "image/png",
    });

    const systemPrompt = body.messages[0]!.content as string;
    expect(systemPrompt).toContain("fracción");
    expect(systemPrompt).toContain("figureBox");
    expect(systemPrompt).toContain("alternativeBoxes");
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/adapters/openrouter/openrouter-request-builder.spec.ts`
Expected: FAIL — `expect(received).toHaveProperty("figureBox")`.

- [ ] **Step 8: Extend the schema and the prompt**

```ts
// apps/api/src/modules/ai/adapters/openrouter/openrouter-request-builder.ts

/** JSON-schema fragment for one normalized crop box. Nullable — "no figure here". */
const NORMALIZED_BOX_SCHEMA = {
  type: ["object", "null"],
  additionalProperties: false,
  properties: {
    x: { type: "number", description: "Borde izquierdo, como fracción del ancho (0..1)." },
    y: { type: "number", description: "Borde superior, como fracción del alto (0..1)." },
    w: { type: "number", description: "Ancho, como fracción del ancho de la imagen (0..1)." },
    h: { type: "number", description: "Alto, como fracción del alto de la imagen (0..1)." },
  },
  required: ["x", "y", "w", "h"],
} as const;

/** Prompt rules for the crop geometry — appended to `EXTRACT_SYSTEM_PROMPT`. */
const CROP_BOX_RULES = [
  "Además del texto, ubica los GRÁFICOS de la pregunta y devuelve sus recuadros.",
  "Todas las coordenadas van como fracción de la imagen, entre 0 y 1: x e y son la esquina superior izquierda, w y h el ancho y alto. Nunca en píxeles.",
  'En "figureBox" devuelve el recuadro del gráfico de complemento del enunciado (un circuito, una figura geométrica, un diagrama). Si la pregunta es solo texto y fórmulas, devuelve null — no inventes un recuadro.',
  'En "alternativeBoxes" devuelve un arreglo de 5 entradas, una por alternativa en el mismo orden: el recuadro de la alternativa si ES un dibujo, o null si es texto. Si ninguna alternativa es un dibujo, devuelve null en todo el campo.',
  "Un recuadro debe encerrar el dibujo completo y nada más: sin el enunciado, sin la letra de la alternativa, sin texto vecino. Prefiere quedarte un poco corto antes que tragarte el párrafo de al lado.",
].join(" ");

// In EXTRACT_SYSTEM_PROMPT's array, add CROP_BOX_RULES before the closing `].join(" ")`.

// In EXTRACT_RESPONSE_JSON_SCHEMA:
      figureBox: NORMALIZED_BOX_SCHEMA,
      alternativeBoxes: {
        type: ["array", "null"],
        items: NORMALIZED_BOX_SCHEMA,
        description: "Un recuadro (o null) por alternativa, en el orden de las alternativas.",
      },
// ...and in `required`:
    required: [
      ...RESPONSE_JSON_SCHEMA.schema.required,
      "suggestedCourse",
      "suggestedTopic",
      "figureBox",
      "alternativeBoxes",
    ],
```

- [ ] **Step 9: Run both test files to verify they pass**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/adapters/openrouter/`
Expected: PASS — toda la carpeta, sin regresiones en `generate`/`revise`.

- [ ] **Step 10: Typecheck and commit**

```bash
pnpm --filter @exams-generator/api typecheck
git add apps/api/src/modules/ai/domain/ports/question-generator.port.ts apps/api/src/modules/ai/adapters/openrouter/
git commit -m "feat(api): ask the vision model for the question's figure crop boxes"
```

---

### Task 5: la extracción recorta y devuelve los crops

El servicio orquesta: rasteriza una vez, ajusta cada box a la tinta, recorta, y devuelve los recortes como `data:` URL. Nada se persiste.

**Files:**
- Modify: `packages/shared/src/dto/ai.dto.ts`
- Modify: `apps/api/src/modules/ai/extract-question.service.ts`
- Modify: `apps/api/src/modules/ai/ai.controller.ts` (tipo de retorno)
- Modify: `apps/api/src/modules/ai/ai.module.ts` (provider del cropper)
- Test: `apps/api/src/modules/ai/extract-question.service.spec.ts` (existente, se extiende)

**Interfaces:**
- Consumes: `ImageCropperPort` + `IMAGE_CROPPER_PORT` (Task 3); `snapBoxToInk` (Task 2); `GeneratedQuestion.figureBox`/`alternativeBoxes` (Task 4).
- Produces: en `packages/shared` — `NormalizedBoxDto`, `AiQuestionCrop`, `AiAlternativeCrop`, `AiExtractedQuestion`. En el API — `ExtractQuestionService.extract(file): Promise<AiExtractedQuestion>` y el constructor `constructor(generator: QuestionGeneratorPort, cropper: ImageCropperPort)`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/modules/ai/extract-question.service.spec.ts
// Replace `buildDeps` and append the new describe block.

import { ImageCropperPort } from "./domain/ports/image-cropper.port";

function buildDeps() {
  const generator: jest.Mocked<QuestionGeneratorPort> = {
    generate: jest.fn(),
    reviseQuestion: jest.fn(),
    extractFromImage: jest.fn().mockResolvedValue(EXTRACTED_QUESTION),
  };

  const cropper: jest.Mocked<ImageCropperPort> = {
    // 4x1 all-white raster: `snapBoxToInk` finds no contrast and leaves every
    // box exactly as the model reported it, so these tests assert the
    // service's plumbing, not the snapping algorithm (covered in its own spec).
    raster: jest.fn().mockResolvedValue({ gray: new Uint8Array(4).fill(255), width: 4, height: 1 }),
    crop: jest.fn().mockResolvedValue(Buffer.from("cropped-png-bytes")),
  };

  const service = new ExtractQuestionService(generator, cropper);
  return { service, generator, cropper };
}

describe("ExtractQuestionService.extract — crops", () => {
  const FIGURE_BOX = { x: 0.1, y: 0.2, w: 0.5, h: 0.3 };
  const ALT_BOX = { x: 0.1, y: 0.7, w: 0.2, h: 0.1 };

  it("does not touch the cropper when the model reported no boxes", async () => {
    const { service, cropper } = buildDeps();

    const result = await service.extract({ buffer: fakePng(), mimetype: "image/png" });

    expect(cropper.raster).not.toHaveBeenCalled();
    expect(cropper.crop).not.toHaveBeenCalled();
    expect(result.figureCrop).toBeUndefined();
    expect(result.alternativeCrops).toBeUndefined();
  });

  it("crops the figure box and returns it as a data URL", async () => {
    const { service, generator, cropper } = buildDeps();
    generator.extractFromImage.mockResolvedValue({ ...EXTRACTED_QUESTION, figureBox: FIGURE_BOX });

    const result = await service.extract({ buffer: fakePng(), mimetype: "image/png" });

    expect(cropper.crop).toHaveBeenCalledTimes(1);
    expect(result.figureCrop!.box).toEqual(FIGURE_BOX);
    expect(result.figureCrop!.dataUrl).toBe(
      `data:image/png;base64,${Buffer.from("cropped-png-bytes").toString("base64")}`,
    );
  });

  it("returns one crop per graphic alternative, carrying its index, and skips the text ones", async () => {
    const { service, generator } = buildDeps();
    generator.extractFromImage.mockResolvedValue({
      ...EXTRACTED_QUESTION,
      alternativeBoxes: [ALT_BOX, null, ALT_BOX, null, null],
    });

    const result = await service.extract({ buffer: fakePng(), mimetype: "image/png" });

    expect(result.alternativeCrops!.map((crop) => crop.alternativeIndex)).toEqual([0, 2]);
    expect(result.alternativeCrops![0]!.box).toEqual(ALT_BOX);
  });

  it("still returns the transcribed question when cropping blows up", async () => {
    const { service, generator, cropper } = buildDeps();
    generator.extractFromImage.mockResolvedValue({ ...EXTRACTED_QUESTION, figureBox: FIGURE_BOX });
    cropper.raster.mockRejectedValue(new Error("unsupported image format"));

    const result = await service.extract({ buffer: fakePng(), mimetype: "image/png" });

    expect(result.figureCrop).toBeUndefined();
    expect(result.bodyTypst).toBe(EXTRACTED_QUESTION.bodyTypst);
    expect(result.correctAnswer).toBe("1");
  });

  it("never leaks the raw boxes from the generator contract into the HTTP response", async () => {
    const { service, generator } = buildDeps();
    generator.extractFromImage.mockResolvedValue({ ...EXTRACTED_QUESTION, figureBox: FIGURE_BOX });

    const result = await service.extract({ buffer: fakePng(), mimetype: "image/png" });

    expect(result).not.toHaveProperty("figureBox");
    expect(result).not.toHaveProperty("alternativeBoxes");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/extract-question.service.spec.ts`
Expected: FAIL — `Expected 2 arguments, but got 1` en el `new ExtractQuestionService(...)` (error de compilación de ts-jest).

- [ ] **Step 3: Add the shared DTO types**

```ts
// packages/shared/src/dto/ai.dto.ts — append

/** A crop rectangle in coordinates normalized to 0..1 — see the API's `NormalizedBox`. */
export interface NormalizedBoxDto {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * One cropped graphic, carried inline as a `data:` URL rather than as an
 * asset id. Nothing is persisted until the teacher saves the question, so a
 * discarded draft leaves no orphan asset behind to clean up.
 */
export interface AiQuestionCrop {
  readonly dataUrl: string;
  readonly box: NormalizedBoxDto;
}

/** A crop belonging to one alternative slot. `alternativeIndex` is 0-based. */
export interface AiAlternativeCrop extends AiQuestionCrop {
  readonly alternativeIndex: number;
}

/**
 * `POST /ai/questions/extract`'s response. Extends the revise response with
 * the crop fields; all three are absent when the photo held no graphic at
 * all, which is the signal the UI uses to render no crop controls.
 */
export interface AiExtractedQuestion extends AiRevisedQuestion {
  /** Handle for `POST /ai/questions/extract/:extractionId/crop`. */
  readonly extractionId?: string;
  readonly figureCrop?: AiQuestionCrop;
  /** Sparse — only the alternatives that are drawings appear here. */
  readonly alternativeCrops?: readonly AiAlternativeCrop[];
}
```

- [ ] **Step 4: Rewrite the service**

```ts
// apps/api/src/modules/ai/extract-question.service.ts — replacing the class body
import { Inject, Injectable, Logger, UnprocessableEntityException } from "@nestjs/common";
import { AiAlternativeCrop, AiExtractedQuestion, AiQuestionCrop } from "@exams-generator/shared";
import { requireImageMime } from "../assets/image-mime";
import { validateStructuredContent } from "../bank/domain/validate-structured-content";
import { GeneratedQuestion, QuestionGeneratorPort } from "./domain/ports/question-generator.port";
import { ImageCropperPort } from "./domain/ports/image-cropper.port";
import { NormalizedBox } from "./domain/normalized-box";
import { snapBoxToInk } from "./domain/snap-box-to-ink";
import { IMAGE_CROPPER_PORT, QUESTION_GENERATOR_PORT } from "./ai.constants";
import { correctAnswerLetterToIndex } from "./domain/correct-answer-letter-to-index";

/** Wide enough to review on screen and to print; small enough to ship in JSON. */
export const CROP_MAX_WIDTH_PX = 1200;
/** Breathing room left around the ink so a stroke never touches the crop edge. */
export const CROP_INK_PADDING_PX = 8;

@Injectable()
export class ExtractQuestionService {
  private readonly logger = new Logger(ExtractQuestionService.name);

  constructor(
    @Inject(QUESTION_GENERATOR_PORT) private readonly generator: QuestionGeneratorPort,
    @Inject(IMAGE_CROPPER_PORT) private readonly cropper: ImageCropperPort,
  ) {}

  async extract(file: ExtractQuestionFile): Promise<AiExtractedQuestion> {
    const mimeType = requireImageMime(file);
    const extracted = await this.generator.extractFromImage({ image: file.buffer, mimeType });

    const extractedWithIndex: GeneratedQuestion = {
      ...extracted,
      correctAnswer: correctAnswerLetterToIndex(extracted.correctAnswer),
    };

    const errors = validateStructuredContent({
      bodyTypst: extractedWithIndex.bodyTypst,
      alternatives: extractedWithIndex.alternatives,
      correctAnswer: extractedWithIndex.correctAnswer,
    });
    if (errors.length > 0) {
      throw new UnprocessableEntityException({ message: "AI produced invalid content", errors });
    }

    // The boxes are generator-contract detail; the HTTP response carries the
    // finished crops instead, so they are destructured out here and never
    // spread into the returned object.
    const { figureBox, alternativeBoxes, ...draft } = extractedWithIndex;
    const crops = await this.buildCrops(file.buffer, mimeType, figureBox, alternativeBoxes);

    return { ...draft, ...crops };
  }

  /**
   * Turns the model's boxes into finished crops. Deliberately total: any
   * failure here (an image `sharp` cannot decode, a crop that throws) is
   * logged and swallowed, and the caller still gets the transcription. The
   * text is the valuable half of this endpoint — losing it because a crop
   * failed would be a bad trade.
   */
  private async buildCrops(
    image: Buffer,
    mimeType: string,
    figureBox: NormalizedBox | undefined,
    alternativeBoxes: readonly (NormalizedBox | null)[] | undefined,
  ): Promise<{ figureCrop?: AiQuestionCrop; alternativeCrops?: readonly AiAlternativeCrop[] }> {
    const hasAlternativeBox = (alternativeBoxes ?? []).some((box) => box !== null);
    if (!figureBox && !hasAlternativeBox) {
      return {};
    }

    try {
      const raster = await this.cropper.raster(image, mimeType);

      const cropAt = async (box: NormalizedBox): Promise<AiQuestionCrop> => {
        const snapped = snapBoxToInk(raster, box, CROP_INK_PADDING_PX);
        const bytes = await this.cropper.crop(image, mimeType, snapped, CROP_MAX_WIDTH_PX);
        return { dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, box: snapped };
      };

      const figureCrop = figureBox ? await cropAt(figureBox) : undefined;

      const alternativeCrops: AiAlternativeCrop[] = [];
      for (const [alternativeIndex, box] of (alternativeBoxes ?? []).entries()) {
        if (box) {
          alternativeCrops.push({ alternativeIndex, ...(await cropAt(box)) });
        }
      }

      return {
        ...(figureCrop ? { figureCrop } : {}),
        ...(alternativeCrops.length > 0 ? { alternativeCrops } : {}),
      };
    } catch (error) {
      this.logger.warn(
        `Crop step failed, returning the transcription without figures: ${(error as Error).message}`,
      );
      return {};
    }
  }
}
```

- [ ] **Step 5: Wire the provider and the controller return type**

```ts
// apps/api/src/modules/ai/ai.module.ts — add to `providers`
    { provide: IMAGE_CROPPER_PORT, useClass: SharpImageCropperAdapter },
// ...with the matching imports for IMAGE_CROPPER_PORT and SharpImageCropperAdapter.

// apps/api/src/modules/ai/ai.controller.ts — `extract`'s return type
  async extract(@UploadedFile() file: Express.Multer.File): Promise<AiExtractedQuestion> {
// ...importing AiExtractedQuestion from "@exams-generator/shared" alongside AiRevisedQuestion.
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/extract-question.service.spec.ts`
Expected: PASS — los casos preexistentes más los 5 nuevos.

- [ ] **Step 7: Run the extract e2e to confirm no regression**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects e2e src/modules/ai/extract-question.e2e.spec.ts`
Expected: PASS — `InMemoryQuestionGeneratorAdapter` no devuelve boxes, así que la respuesta no cambia.

- [ ] **Step 8: Typecheck and commit**

```bash
pnpm --filter @exams-generator/api typecheck
git add packages/shared/src/dto/ai.dto.ts apps/api/src/modules/ai/
git commit -m "feat(api): crop the detected figures during photo extraction"
```

---

### Task 6: cache de la foto y endpoint de re-recorte

Para ajustar un recorte, el profesor no debería re-subir 5 MB por cada arrastre. La foto original queda en Redis bajo un `extractionId` durante 30 minutos.

El re-recorte manual **no** pasa por `snapBoxToInk`: el snap arregla la puntería floja del modelo; cuando el humano marca el rectángulo, se respeta lo que marcó.

**Files:**
- Create: `apps/api/src/common/redis.provider.ts`
- Create: `apps/api/src/modules/ai/domain/ports/extraction-cache.port.ts`
- Create: `apps/api/src/modules/ai/adapters/cache/redis-extraction-cache.adapter.ts`
- Create: `apps/api/src/modules/ai/recrop-question.service.ts`
- Test: `apps/api/src/modules/ai/recrop-question.service.spec.ts`
- Test: `apps/api/src/modules/ai/extract-crop.e2e.spec.ts`
- Modify: `apps/api/src/modules/ai/extract-question.service.ts` (guardar en cache, emitir `extractionId`)
- Modify: `apps/api/src/modules/ai/ai.controller.ts`, `ai.module.ts`, `ai.constants.ts`
- Modify: `apps/api/src/common/account-throttler.guard.ts` (constante de throttle propia)

**Interfaces:**
- Consumes: `ImageCropperPort` (Task 3), `NormalizedBox`/`isValidNormalizedBox` (Task 1), `AiQuestionCrop` (Task 5).
- Produces:
  - `interface CachedExtraction { readonly userId: string; readonly image: Buffer; readonly mimeType: string }`
  - `interface ExtractionCachePort { put(extractionId: string, entry: CachedExtraction): Promise<void>; get(extractionId: string): Promise<CachedExtraction | null> }`
  - `const EXTRACTION_CACHE_PORT: symbol`
  - `class RecropQuestionService { recrop(user: AuthTokenPayload, extractionId: string, box: NormalizedBox): Promise<AiQuestionCrop> }`
  - `const AI_CROP_PER_ACCOUNT_THROTTLE = { default: { ttl: 60_000, limit: 240 } }`

- [ ] **Step 1: Write the failing service test**

```ts
// apps/api/src/modules/ai/recrop-question.service.spec.ts
import { BadRequestException, GoneException, NotFoundException } from "@nestjs/common";
import { AuthTokenPayload } from "../auth/token.service";
import { ImageCropperPort } from "./domain/ports/image-cropper.port";
import { ExtractionCachePort } from "./domain/ports/extraction-cache.port";
import { RecropQuestionService } from "./recrop-question.service";
import { fakePng } from "../../test-support/image-fixtures";

const USER = { sub: "user-1", tenantId: "tenant-1" } as unknown as AuthTokenPayload;
const OTHER_USER = { sub: "user-2", tenantId: "tenant-1" } as unknown as AuthTokenPayload;
const BOX = { x: 0.1, y: 0.2, w: 0.4, h: 0.3 };

function buildDeps() {
  const cache: jest.Mocked<ExtractionCachePort> = {
    put: jest.fn(),
    get: jest.fn().mockResolvedValue({ userId: "user-1", image: fakePng(), mimeType: "image/png" }),
  };
  const cropper: jest.Mocked<ImageCropperPort> = {
    raster: jest.fn(),
    crop: jest.fn().mockResolvedValue(Buffer.from("recropped-bytes")),
  };
  return { service: new RecropQuestionService(cache, cropper), cache, cropper };
}

describe("RecropQuestionService.recrop", () => {
  it("crops the exact box the human drew, without snapping it to ink", async () => {
    const { service, cropper } = buildDeps();

    const result = await service.recrop(USER, "extraction-1", BOX);

    // Third argument is the box: byte-for-byte what was asked for.
    expect(cropper.crop).toHaveBeenCalledWith(expect.any(Buffer), "image/png", BOX, 1200);
    expect(cropper.raster).not.toHaveBeenCalled();
    expect(result.box).toEqual(BOX);
    expect(result.dataUrl).toBe(
      `data:image/png;base64,${Buffer.from("recropped-bytes").toString("base64")}`,
    );
  });

  it("throws Gone when the cached photo has expired", async () => {
    const { service, cache } = buildDeps();
    cache.get.mockResolvedValue(null);

    await expect(service.recrop(USER, "extraction-1", BOX)).rejects.toBeInstanceOf(GoneException);
  });

  it("throws NotFound — not Forbidden — for another user's extraction", async () => {
    const { service } = buildDeps();

    // 404 rather than 403: a 403 would confirm that this extractionId exists.
    await expect(service.recrop(OTHER_USER, "extraction-1", BOX)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("rejects a box outside the 0..1 canvas", async () => {
    const { service } = buildDeps();

    await expect(
      service.recrop(USER, "extraction-1", { x: 0.9, y: 0.2, w: 0.4, h: 0.3 }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/recrop-question.service.spec.ts`
Expected: FAIL — `Cannot find module './recrop-question.service'`.

- [ ] **Step 3: Write the cache port and its Redis adapter**

```ts
// apps/api/src/modules/ai/domain/ports/extraction-cache.port.ts

/** The original photo of one extraction, held only long enough to re-crop it. */
export interface CachedExtraction {
  readonly userId: string;
  readonly image: Buffer;
  readonly mimeType: string;
}

/**
 * Short-lived storage for the photo between an extraction and the teacher's
 * manual crop adjustments. Deliberately NOT the asset store: this photo may
 * never become anything, and an asset that may never be referenced is an
 * orphan waiting to be cleaned up.
 */
export interface ExtractionCachePort {
  put(extractionId: string, entry: CachedExtraction): Promise<void>;
  get(extractionId: string): Promise<CachedExtraction | null>;
}
```

```ts
// apps/api/src/modules/ai/adapters/cache/redis-extraction-cache.adapter.ts
import { Inject, Injectable } from "@nestjs/common";
import Redis from "ioredis";
import { REDIS_CLIENT } from "../../../../common/redis.provider";
import { CachedExtraction, ExtractionCachePort } from "../../domain/ports/extraction-cache.port";

/** Long enough for a teacher to review and adjust; short enough to bound memory. */
const TTL_SECONDS = 30 * 60;

const keyFor = (extractionId: string): string => `ai:extract:${extractionId}`;

@Injectable()
export class RedisExtractionCacheAdapter implements ExtractionCachePort {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async put(extractionId: string, entry: CachedExtraction): Promise<void> {
    const key = keyFor(extractionId);
    // A hash rather than one JSON blob: the image stays raw bytes instead of
    // paying a 33% base64 tax on every 5 MB photo in Redis.
    await this.redis.hset(key, {
      userId: entry.userId,
      mimeType: entry.mimeType,
      image: entry.image,
    });
    await this.redis.expire(key, TTL_SECONDS);
  }

  async get(extractionId: string): Promise<CachedExtraction | null> {
    const entry = await this.redis.hgetallBuffer(keyFor(extractionId));
    if (!entry.image || !entry.userId || !entry.mimeType) {
      return null;
    }
    return {
      userId: entry.userId.toString("utf8"),
      mimeType: entry.mimeType.toString("utf8"),
      image: entry.image,
    };
  }
}
```

```ts
// apps/api/src/common/redis.provider.ts
import { Global, Module } from "@nestjs/common";
import Redis from "ioredis";
import { resolveRedisConnection } from "./queue.env";

/** DI token for the shared ioredis client. */
export const REDIS_CLIENT = Symbol("RedisClient");

/**
 * One ioredis client for everything that is NOT a BullMQ queue (BullMQ opens
 * and owns its own connections). Global so a feature module can inject
 * `REDIS_CLIENT` without importing this module explicitly — same reasoning as
 * `QueueModule`'s globally-registered `BullModule.forRoot`.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => new Redis(resolveRedisConnection()),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule {}
```

Registrar `RedisModule` en `apps/api/src/app.module.ts`, junto a `QueueModule`.

- [ ] **Step 4: Write the recrop service**

```ts
// apps/api/src/modules/ai/recrop-question.service.ts
import {
  BadRequestException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { AiQuestionCrop } from "@exams-generator/shared";
import { AuthTokenPayload } from "../auth/token.service";
import { NormalizedBox, isValidNormalizedBox } from "./domain/normalized-box";
import { ExtractionCachePort } from "./domain/ports/extraction-cache.port";
import { ImageCropperPort } from "./domain/ports/image-cropper.port";
import { EXTRACTION_CACHE_PORT, IMAGE_CROPPER_PORT } from "./ai.constants";
import { CROP_MAX_WIDTH_PX } from "./extract-question.service";

/**
 * `POST /ai/questions/extract/:extractionId/crop` — re-cuts one crop from the
 * photo the extraction already cached, using a box the teacher drew by hand.
 *
 * The box is used VERBATIM: `snapBoxToInk` exists to correct the vision
 * model's loose aim, and applying it to a hand-drawn rectangle would move the
 * edges the human just placed on purpose.
 */
@Injectable()
export class RecropQuestionService {
  constructor(
    @Inject(EXTRACTION_CACHE_PORT) private readonly cache: ExtractionCachePort,
    @Inject(IMAGE_CROPPER_PORT) private readonly cropper: ImageCropperPort,
  ) {}

  async recrop(
    user: AuthTokenPayload,
    extractionId: string,
    box: NormalizedBox,
  ): Promise<AiQuestionCrop> {
    if (!isValidNormalizedBox(box)) {
      throw new BadRequestException("box must be inside the 0..1 canvas and have a positive size");
    }

    const cached = await this.cache.get(extractionId);
    if (!cached) {
      throw new GoneException("This crop session expired — extract the question again");
    }
    // 404 rather than 403: a 403 would confirm the id exists to whoever guessed it.
    if (cached.userId !== user.sub) {
      throw new NotFoundException(`Extraction not found: ${extractionId}`);
    }

    const bytes = await this.cropper.crop(cached.image, cached.mimeType, box, CROP_MAX_WIDTH_PX);
    return { dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, box };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/ai/recrop-question.service.spec.ts`
Expected: PASS — 4 tests.

- [ ] **Step 6: Make the extraction populate the cache**

`ExtractQuestionService` recibe también `ExtractionCachePort` y el `AuthTokenPayload` del usuario. `AiController.extract` pasa a llevar `@CurrentUser()`.

**Esto rompe los tests de Task 5 a propósito**, y arreglarlos es parte de este paso: `buildDeps()` suma un tercer mock (`cache: { put: jest.fn(), get: jest.fn() }`) al constructor, y cada llamada `service.extract(file)` pasa a ser `service.extract(USER, file)` con `const USER = { sub: "user-1", tenantId: "tenant-1" } as unknown as AuthTokenPayload`. Es un cambio mecánico sobre tests que ya existen — no se reescribe ninguna aserción.

```ts
// extract-question.service.ts — constructor gains:
    @Inject(EXTRACTION_CACHE_PORT) private readonly cache: ExtractionCachePort,

// extract(): signature gains the user, and after `buildCrops`:
    const hasCrops = !!crops.figureCrop || (crops.alternativeCrops?.length ?? 0) > 0;
    if (!hasCrops) {
      return { ...draft, ...crops };
    }
    // Only cached when there is something to re-crop: a text-only question
    // has no crop UI, so holding its photo for 30 minutes buys nothing.
    const extractionId = randomUUID();
    await this.cache.put(extractionId, { userId: user.sub, image: file.buffer, mimeType });
    return { ...draft, ...crops, extractionId };
```

Agregar el test correspondiente a `extract-question.service.spec.ts`:

```ts
  it("caches the photo and returns an extractionId only when there is something to re-crop", async () => {
    const { service, generator, cache } = buildDeps();
    generator.extractFromImage.mockResolvedValue({ ...EXTRACTED_QUESTION, figureBox: FIGURE_BOX });
    const file = { buffer: fakePng(), mimetype: "image/png" };

    const withCrop = await service.extract(USER, file);
    expect(withCrop.extractionId).toEqual(expect.any(String));
    expect(cache.put).toHaveBeenCalledWith(withCrop.extractionId, {
      userId: USER.sub,
      image: file.buffer,
      mimeType: "image/png",
    });

    generator.extractFromImage.mockResolvedValue(EXTRACTED_QUESTION);
    cache.put.mockClear();
    const withoutCrop = await service.extract(USER, file);
    expect(withoutCrop.extractionId).toBeUndefined();
    expect(cache.put).not.toHaveBeenCalled();
  });
```

- [ ] **Step 7: Add the endpoint with its own throttle**

```ts
// apps/api/src/common/account-throttler.guard.ts — append
/**
 * Crop adjustment calls no model: they re-cut an image already in Redis.
 * Inheriting `AI_PER_ACCOUNT_THROTTLE` (30/min, sized for paid model calls)
 * would let three crop adjustments eat a teacher's whole generation quota.
 */
export const AI_CROP_PER_ACCOUNT_THROTTLE = { default: { ttl: 60_000, limit: 240 } };
```

```ts
// apps/api/src/modules/ai/ai.controller.ts — new endpoint
  /**
   * `POST /ai/questions/extract/:extractionId/crop` — re-cuts one crop with a
   * box the teacher drew. 200, never 201: nothing is created, and the photo it
   * reads was cached by the extraction call, not by this one.
   */
  @Post("extract/:extractionId/crop")
  @HttpCode(200)
  @Throttle(AI_CROP_PER_ACCOUNT_THROTTLE)
  async recrop(
    @CurrentUser() user: AuthTokenPayload,
    @Param("extractionId", ParseUUIDPipe) extractionId: string,
    @Body() body: RecropQuestionBody,
  ): Promise<AiQuestionCrop> {
    return this.recropService.recrop(user, extractionId, body.box);
  }
```

`RecropQuestionBody` va junto a los demás DTOs de request del módulo, con `box` validado por `class-validator` igual que el resto (o, si el módulo no usa `class-validator` en sus bodies, como `readonly box: NormalizedBox` — `isValidNormalizedBox` en el servicio es la validación real, y el test de "rejects a box outside the canvas" la cubre).

- [ ] **Step 8: Write the e2e**

```ts
// apps/api/src/modules/ai/extract-crop.e2e.spec.ts
// Copy the app-bootstrap/auth scaffolding from extract-question.e2e.spec.ts, then:

  /** A real PNG — the crop path runs the real sharp adapter end to end. */
  async function realPng(): Promise<Buffer> {
    return sharp({ create: { width: 200, height: 100, channels: 3, background: "#ffffff" } })
      .png()
      .toBuffer();
  }

  /** Overrides the generator so it reports a figure box the cropper can act on. */
  const generatorWithFigureBox = {
    generate: jest.fn(),
    reviseQuestion: jest.fn(),
    extractFromImage: jest.fn().mockResolvedValue({
      bodyTypst: "¿Qué muestra la figura?",
      alternatives: ["a", "b", "c", "d", "e"],
      correctAnswer: "a",
      figureBox: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
    }),
  };

  it("returns an extractionId and a figure crop, then re-crops with a hand-drawn box", async () => {
    const png = await realPng();

    const extracted = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "question.png")
      .expect(200);

    expect(extracted.body.extractionId).toEqual(expect.any(String));
    expect(extracted.body.figureCrop.dataUrl).toMatch(/^data:image\/png;base64,/);

    const recropped = await request(app.getHttpServer())
      .post(`/ai/questions/extract/${extracted.body.extractionId}/crop`)
      .set("Authorization", `Bearer ${token}`)
      .send({ box: { x: 0, y: 0, w: 0.25, h: 0.25 } })
      .expect(200);

    expect(recropped.body.box).toEqual({ x: 0, y: 0, w: 0.25, h: 0.25 });
    expect(recropped.body.dataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("returns 410 once the cached photo is gone", async () => {
    // Same flow, but the cache entry is deleted before the re-crop.
    const png = await realPng();
    const extracted = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "question.png")
      .expect(200);

    // `redis` is the shared client, pulled from the running app:
    //   const redis = app.get<Redis>(REDIS_CLIENT);
    await redis.del(`ai:extract:${extracted.body.extractionId}`);

    await request(app.getHttpServer())
      .post(`/ai/questions/extract/${extracted.body.extractionId}/crop`)
      .set("Authorization", `Bearer ${token}`)
      .send({ box: { x: 0, y: 0, w: 0.25, h: 0.25 } })
      .expect(410);
  });

  it("returns 404 for another account's extractionId", async () => {
    const png = await realPng();
    const extracted = await request(app.getHttpServer())
      .post("/ai/questions/extract")
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "question.png")
      .expect(200);

    await request(app.getHttpServer())
      .post(`/ai/questions/extract/${extracted.body.extractionId}/crop`)
      .set("Authorization", `Bearer ${otherUserToken}`)
      .send({ box: { x: 0, y: 0, w: 0.25, h: 0.25 } })
      .expect(404);
  });
```

- [ ] **Step 9: Run the e2e**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects e2e src/modules/ai/extract-crop.e2e.spec.ts`
Expected: PASS — 3 tests.

- [ ] **Step 10: Typecheck and commit**

```bash
pnpm --filter @exams-generator/api typecheck
git add apps/api/src/common/ apps/api/src/modules/ai/
git commit -m "feat(api): let the teacher re-cut a crop from the cached extraction photo"
```

---

### Task 7: imágenes por alternativa en slots esparsos

`BankService.setAlternativeImages` exige hoy una imagen por CADA alternativa. Con alternativas gráficas dinámicas eso no sirve: una pregunta puede tener dibujo solo en a) y c).

Se agrega un campo multipart opcional `indexes`. Sin él, el comportamiento actual queda intacto — ningún llamador existente se rompe.

**Files:**
- Modify: `apps/api/src/modules/bank/domain/ports/bank-repository.port.ts`
- Modify: `apps/api/src/modules/bank/bank.repository.ts`
- Modify: `apps/api/src/modules/bank/bank.service.ts`
- Modify: `apps/api/src/modules/bank/bank.controller.ts`
- Test: `apps/api/src/modules/bank/bank.service.spec.ts` (existente, se extiende)
- Test: `apps/api/src/modules/bank/bank.repository.spec.ts` (existente, se extiende)

**Interfaces:**
- Consumes: nada de las tareas anteriores.
- Produces: `BankRepositoryPort.setAlternativeImages(id, currentTenantId, images: readonly { storageKey: string; mime: string; alternativeIndex: number }[])` — el índice pasa a ser explícito por entrada en vez de la posición del arreglo. `BankService.setAlternativeImages(user, id, files, indexes?: readonly number[])`.

- [ ] **Step 1: Write the failing service test**

```ts
// apps/api/src/modules/bank/bank.service.spec.ts — append to the setAlternativeImages describe
  it("maps each file to the slot named in indexes, leaving the other alternatives without an image", async () => {
    const { service, repository, storage } = buildDeps();
    repository.findQuestionById.mockResolvedValue(structuredQuestionWith5Alternatives());

    await service.setAlternativeImages(USER, "q1", [file("a"), file("c")], [0, 2]);

    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(repository.setAlternativeImages).toHaveBeenCalledWith(
      "q1",
      USER.tenantId,
      [
        expect.objectContaining({ alternativeIndex: 0 }),
        expect.objectContaining({ alternativeIndex: 2 }),
      ],
    );
  });

  it("still requires one file per alternative when indexes is omitted", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(structuredQuestionWith5Alternatives());

    await expect(service.setAlternativeImages(USER, "q1", [file("a")])).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("rejects indexes whose length does not match the files", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(structuredQuestionWith5Alternatives());

    await expect(
      service.setAlternativeImages(USER, "q1", [file("a"), file("c")], [0]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects an index outside the alternatives range", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(structuredQuestionWith5Alternatives());

    await expect(
      service.setAlternativeImages(USER, "q1", [file("a")], [7]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a repeated index — two images cannot share one slot", async () => {
    const { service, repository } = buildDeps();
    repository.findQuestionById.mockResolvedValue(structuredQuestionWith5Alternatives());

    await expect(
      service.setAlternativeImages(USER, "q1", [file("a"), file("b")], [1, 1]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
```

`buildDeps()`, `USER`, `file()` y `structuredQuestionWith5Alternatives()` ya existen en ese spec o se derivan de los helpers que usa el describe actual de `setAlternativeImages`; reutilizarlos, no duplicarlos.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/bank/bank.service.spec.ts -t setAlternativeImages`
Expected: FAIL — `Expected 3 arguments, but got 4`.

- [ ] **Step 3: Widen the repository port and its implementation**

```ts
// bank-repository.port.ts — replace the setAlternativeImages signature and its docstring
  /**
   * All-or-nothing re-attachment of a structured question's per-alternative
   * images — each entry names the slot it belongs to. Replaces the FULL
   * existing set (delete+insert in a transaction) rather than patching
   * individual slots, since a partial patch could leave a stale image on a
   * slot the caller meant to clear. Slots not named in `images` end up with
   * no image, which is how a question with drawings on only some
   * alternatives is stored. Same tenant-visibility scoping as
   * `replaceImageAsset`.
   */
  setAlternativeImages(
    id: string,
    currentTenantId: string | null,
    images: readonly {
      readonly storageKey: string;
      readonly mime: string;
      readonly alternativeIndex: number;
    }[],
  ): Promise<string | undefined>;
```

```ts
// bank.repository.ts — inside the transaction, replace the insert loop
      for (const image of images) {
        const [asset] = await tx
          .insert(assets)
          .values({ tenantId: currentTenantId, storageKey: image.storageKey, mime: image.mime })
          .returning({ id: assets.id });

        if (!asset) {
          throw new Error("Insert invariant violated: asset row missing after insert");
        }

        await tx.insert(questionAlternativeImages).values({
          questionId: id,
          alternativeIndex: image.alternativeIndex,
          assetId: asset.id,
        });
      }
```

- [ ] **Step 4: Add the sparse path to the service**

```ts
// bank.service.ts — replace the body of setAlternativeImages
  async setAlternativeImages(
    user: AuthTokenPayload,
    id: string,
    files: readonly Express.Multer.File[],
    indexes?: readonly number[],
  ): Promise<{ id: string }> {
    const question = await this.requireManageableQuestion(user, id);
    assertStructuredQuestion(question, "Alternative images");

    const alternatives = (question.alternatives ?? []) as readonly string[];
    const slots = this.resolveAlternativeSlots(files.length, alternatives.length, indexes);

    const images: { storageKey: string; mime: string; alternativeIndex: number }[] = [];
    for (const [position, file] of files.entries()) {
      const mime = requireImageMime(file);
      const storageKey = `bank/questions/${randomUUID()}`;
      await this.storage.put(storageKey, file.buffer, mime);
      images.push({ storageKey, mime, alternativeIndex: slots[position]! });
    }

    const updatedId = await this.repository.setAlternativeImages(id, user.tenantId, images);
    if (!updatedId) {
      throw new NotFoundException(`Question not found: ${id}`);
    }

    return { id: updatedId };
  }

  /**
   * Resolves which alternative slot each uploaded file belongs to.
   *
   * Without `indexes` this keeps the original contract — one image per
   * alternative, in order — so the seed scripts that were the only callers
   * before keep working untouched. With `indexes` the caller names the slots,
   * which is what a question whose drawings sit on only some alternatives
   * needs.
   */
  private resolveAlternativeSlots(
    fileCount: number,
    alternativeCount: number,
    indexes: readonly number[] | undefined,
  ): readonly number[] {
    if (!indexes) {
      if (fileCount !== alternativeCount) {
        throw new BadRequestException(
          `Expected exactly ${alternativeCount} image(s) (one per alternative), got ${fileCount}`,
        );
      }
      return Array.from({ length: fileCount }, (_unused, index) => index);
    }

    if (indexes.length !== fileCount) {
      throw new BadRequestException(
        `indexes must name one slot per image: got ${indexes.length} index(es) for ${fileCount} image(s)`,
      );
    }
    if (indexes.some((index) => !Number.isInteger(index) || index < 0 || index >= alternativeCount)) {
      throw new BadRequestException(
        `Every index must be an integer between 0 and ${alternativeCount - 1}`,
      );
    }
    if (new Set(indexes).size !== indexes.length) {
      throw new BadRequestException("indexes must not repeat — one image per alternative slot");
    }
    return indexes;
  }
```

- [ ] **Step 5: Accept the field in the controller**

```ts
// bank.controller.ts — setAlternativeImages
  async setAlternativeImages(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
    @Body() body: SetAlternativeImagesBody,
  ): Promise<{ id: string }> {
    return this.service.setAlternativeImages(user, id, files ?? [], parseIndexes(body.indexes));
  }
```

```ts
/**
 * Multipart carries no types: `indexes` arrives as a repeated field (an array
 * of strings) or, with a single value, as one bare string. Anything
 * unparseable becomes `NaN`, which `resolveAlternativeSlots` rejects with a
 * 400 — this helper never guesses.
 */
function parseIndexes(raw: string | string[] | undefined): number[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return (Array.isArray(raw) ? raw : [raw]).map((value) => Number(value));
}
```

- [ ] **Step 6: Extend the repository test**

```ts
// bank.repository.spec.ts — append to the setAlternativeImages describe
  it("stores each image at the alternative slot it names, leaving the other slots empty", async () => {
    // ...create a structured question with 5 alternatives, then:
    await repository.setAlternativeImages(questionId, tenantId, [
      { storageKey: "k0", mime: "image/png", alternativeIndex: 0 },
      { storageKey: "k2", mime: "image/png", alternativeIndex: 2 },
    ]);

    const rows = await db
      .select()
      .from(questionAlternativeImages)
      .where(eq(questionAlternativeImages.questionId, questionId));

    expect(rows.map((row) => row.alternativeIndex).sort()).toEqual([0, 2]);
  });
```

- [ ] **Step 7: Run the bank tests to verify they pass**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects non-e2e src/modules/bank/`
Expected: PASS — nuevos y preexistentes.

- [ ] **Step 8: Run the bank e2e for regressions**

Run: `pnpm --filter @exams-generator/api exec jest --selectProjects e2e src/modules/bank/`
Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

```bash
pnpm --filter @exams-generator/api typecheck
git add apps/api/src/modules/bank/
git commit -m "feat(api): allow attaching images to only some alternative slots"
```

---

### Task 8: el web habla con los endpoints nuevos

Plomería, sin UI todavía: tipos de la respuesta de extracción, llamada de re-recorte, y subida de imágenes por alternativa.

**Files:**
- Modify: `apps/web/src/app/features/ai/ai.service.ts`
- Modify: `apps/web/src/app/features/bank/bank.service.ts`
- Test: `apps/web/src/app/features/bank/bank.service.spec.ts` (existente, se extiende)

**Interfaces:**
- Consumes: `AiExtractedQuestion`, `AiQuestionCrop`, `NormalizedBoxDto` de `@exams-generator/shared` (Task 5).
- Produces:
  - `AiService.extractQuestionFromImage(image: File): Observable<AiExtractedQuestion>` (tipo de retorno ampliado)
  - `AiService.recropExtraction(extractionId: string, box: NormalizedBoxDto): Observable<AiQuestionCrop>`
  - `BankService.setAlternativeImages(id: string, crops: readonly { alternativeIndex: number; file: File }[]): Observable<{ id: string }>`
  - `dataUrlToFile(dataUrl: string, filename: string): File` en `apps/web/src/app/features/bank/data-url-to-file.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/app/features/bank/data-url-to-file.spec.ts
import { dataUrlToFile } from './data-url-to-file';

describe('dataUrlToFile', () => {
  it('decodes a base64 data URL into a File with the declared mime type', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const base64 = btoa(String.fromCharCode(...bytes));

    const file = dataUrlToFile(`data:image/png;base64,${base64}`, 'figura.png');

    expect(file.name).toBe('figura.png');
    expect(file.type).toBe('image/png');
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });

  it('throws on a data URL that is not base64-encoded', () => {
    expect(() => dataUrlToFile('data:image/png,not-base64', 'x.png')).toThrow();
  });
});
```

```ts
// apps/web/src/app/features/bank/bank.service.spec.ts — append
  it('posts one image per named alternative slot', () => {
    service
      .setAlternativeImages('q1', [
        { alternativeIndex: 0, file: new File(['a'], 'a.png', { type: 'image/png' }) },
        { alternativeIndex: 2, file: new File(['c'], 'c.png', { type: 'image/png' }) },
      ])
      .subscribe();

    const req = httpMock.expectOne(
      `${environment.apiBaseUrl}/bank/questions/q1/alternative-images`,
    );
    const body = req.request.body as FormData;
    expect(body.getAll('images').length).toBe(2);
    expect(body.getAll('indexes')).toEqual(['0', '2']);
    req.flush({ id: 'q1' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/web test`
Expected: FAIL — `Cannot find module './data-url-to-file'` y `service.setAlternativeImages is not a function`.

- [ ] **Step 3: Write the implementations**

```ts
// apps/web/src/app/features/bank/data-url-to-file.ts

/**
 * Turns a `data:` URL from the extraction response into a `File` the upload
 * endpoints accept. The crops arrive inline precisely so nothing is persisted
 * until the teacher saves — this is where they become uploadable bytes.
 */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const [header, payload] = dataUrl.split(',');
  const mime = header?.match(/^data:([^;]+);base64$/)?.[1];
  if (!mime || payload === undefined) {
    throw new Error(`Not a base64 data URL: ${dataUrl.slice(0, 32)}…`);
  }

  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], filename, { type: mime });
}
```

```ts
// apps/web/src/app/features/bank/bank.service.ts — append
  /**
   * Attaches images to the alternative slots that have one. `indexes` names
   * the slot for each image, so a question with drawings on only a) and c)
   * uploads exactly two files (see the API's `resolveAlternativeSlots`).
   */
  setAlternativeImages(
    id: string,
    crops: readonly { alternativeIndex: number; file: File }[],
  ): Observable<{ id: string }> {
    const formData = new FormData();
    for (const crop of crops) {
      formData.append('images', crop.file);
      formData.append('indexes', String(crop.alternativeIndex));
    }

    return this.http.post<{ id: string }>(
      `${environment.apiBaseUrl}/bank/questions/${id}/alternative-images`,
      formData,
    );
  }
```

```ts
// apps/web/src/app/features/ai/ai.service.ts
// Change extractQuestionFromImage's return type to Observable<AiExtractedQuestion>, and append:

  /** `POST /ai/questions/extract/:extractionId/crop` — re-cuts one crop with a hand-drawn box. */
  recropExtraction(extractionId: string, box: NormalizedBoxDto): Observable<AiQuestionCrop> {
    return this.http.post<AiQuestionCrop>(
      `${environment.apiBaseUrl}/ai/questions/extract/${extractionId}/crop`,
      { box },
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @exams-generator/web test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/ai/ai.service.ts apps/web/src/app/features/bank/bank.service.ts apps/web/src/app/features/bank/data-url-to-file.ts apps/web/src/app/features/bank/data-url-to-file.spec.ts apps/web/src/app/features/bank/bank.service.spec.ts
git commit -m "feat(web): call the crop endpoints and turn data URLs into uploadable files"
```

---

### Task 9: `<app-crop-review>` — ajustar el recorte a mano

Componente presentacional puro: sin `HttpClient`, sin `Router`. Recibe la foto y los slots, emite intención. El contenedor es quien llama al API — patrón container-presentational, igual que el resto del proyecto.

**Files:**
- Create: `apps/web/src/app/features/bank/crop-review/crop-review.component.ts`
- Create: `apps/web/src/app/features/bank/crop-review/crop-review.component.html`
- Test: `apps/web/src/app/features/bank/crop-review/crop-review.component.spec.ts`

**Interfaces:**
- Consumes: `NormalizedBoxDto` (`@exams-generator/shared`).
- Produces:
  ```ts
  export type CropTarget = { readonly kind: 'figure' } | { readonly kind: 'alternative'; readonly alternativeIndex: number };

  export interface CropSlot {
    readonly target: CropTarget;
    /** "Figura del enunciado" or "Alternativa c)". */
    readonly label: string;
    readonly dataUrl: string;
    readonly box: NormalizedBoxDto;
    readonly busy: boolean;
  }
  ```
  Entradas: `photoUrl = input.required<string>()`, `slots = input.required<readonly CropSlot[]>()`. Salidas: `recrop = output<{ target: CropTarget; box: NormalizedBoxDto }>()`, `discard = output<CropTarget>()`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/app/features/bank/crop-review/crop-review.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CropReviewComponent, CropSlot } from './crop-review.component';

const SLOT: CropSlot = {
  target: { kind: 'figure' },
  label: 'Figura del enunciado',
  dataUrl: 'data:image/png;base64,AAAA',
  box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
  busy: false,
};

async function render(slots: readonly CropSlot[]): Promise<ComponentFixture<CropReviewComponent>> {
  await TestBed.configureTestingModule({ imports: [CropReviewComponent] }).compileComponents();
  const fixture = TestBed.createComponent(CropReviewComponent);
  fixture.componentRef.setInput('photoUrl', 'blob:photo');
  fixture.componentRef.setInput('slots', slots);
  fixture.detectChanges();
  return fixture;
}

describe('CropReviewComponent', () => {
  it('renders nothing at all when there are no slots', async () => {
    const fixture = await render([]);

    expect(fixture.nativeElement.querySelector('[data-testid="crop-slot"]')).toBeNull();
  });

  it('renders one slot per crop, labelled', async () => {
    const fixture = await render([
      SLOT,
      { ...SLOT, target: { kind: 'alternative', alternativeIndex: 2 }, label: 'Alternativa c)' },
    ]);

    const labels = Array.from(
      fixture.nativeElement.querySelectorAll<HTMLElement>('[data-testid="crop-slot-label"]'),
    ).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['Figura del enunciado', 'Alternativa c)']);
  });

  it('emits recrop with the slot target and the adjusted box', async () => {
    const fixture = await render([SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    fixture.componentInstance.applyBox(SLOT.target, { x: 0.2, y: 0.2, w: 0.3, h: 0.3 });

    expect(emitted).toEqual([
      { target: { kind: 'figure' }, box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } },
    ]);
  });

  it('emits discard when the teacher removes a crop the AI invented', async () => {
    const fixture = await render([SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.discard.subscribe((event) => emitted.push(event));

    fixture.nativeElement.querySelector<HTMLButtonElement>('[data-testid="crop-discard"]')!.click();

    expect(emitted).toEqual([{ kind: 'figure' }]);
  });

  it('does not emit recrop while that slot is busy', async () => {
    const fixture = await render([{ ...SLOT, busy: true }]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    fixture.componentInstance.applyBox(SLOT.target, { x: 0.2, y: 0.2, w: 0.3, h: 0.3 });

    expect(emitted).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/web test`
Expected: FAIL — `Cannot find module './crop-review.component'`.

- [ ] **Step 3: Write the component**

```ts
// apps/web/src/app/features/bank/crop-review/crop-review.component.ts
import { Component, input, output } from '@angular/core';
import { NormalizedBoxDto } from '@exams-generator/shared';

export type CropTarget =
  | { readonly kind: 'figure' }
  | { readonly kind: 'alternative'; readonly alternativeIndex: number };

export interface CropSlot {
  readonly target: CropTarget;
  readonly label: string;
  readonly dataUrl: string;
  readonly box: NormalizedBoxDto;
  /** True while the API is re-cutting this slot — its controls are locked. */
  readonly busy: boolean;
}

/**
 * Lets the teacher fix a crop the vision model got wrong: the photo with a
 * draggable rectangle over it, the current cut beside it, and a way to throw
 * the whole slot away when the model saw a figure that is not there.
 *
 * Presentational only — it never calls the API. `bank-new` owns the HTTP and
 * feeds a new `slots` value back down, so this component holds no state that
 * could drift from what the server actually cut.
 */
@Component({
  selector: 'app-crop-review',
  standalone: true,
  templateUrl: './crop-review.component.html',
})
export class CropReviewComponent {
  readonly photoUrl = input.required<string>();
  readonly slots = input.required<readonly CropSlot[]>();

  readonly recrop = output<{ target: CropTarget; box: NormalizedBoxDto }>();
  readonly discard = output<CropTarget>();

  /** Called by the drag handler once the teacher lets go of the rectangle. */
  applyBox(target: CropTarget, box: NormalizedBoxDto): void {
    const slot = this.slots().find((candidate) => sameTarget(candidate.target, target));
    if (!slot || slot.busy) {
      return;
    }
    this.recrop.emit({ target, box });
  }

  protected removeSlot(target: CropTarget): void {
    this.discard.emit(target);
  }

  protected trackByLabel(_index: number, slot: CropSlot): string {
    return slot.label;
  }
}

/** Exported because `bank-new` matches slots by target too — see Task 10. */
export function sameTarget(a: CropTarget, b: CropTarget): boolean {
  if (a.kind !== b.kind) {
    return false;
  }
  return a.kind === 'figure' || a.alternativeIndex === (b as { alternativeIndex: number }).alternativeIndex;
}
```

Plantilla: por cada slot, un contenedor `position: relative` con `<img [src]="photoUrl()">` de fondo y un `<div>` absoluto posicionado desde `slot.box` (porcentajes, no píxeles — así el rectángulo sigue a la foto en cualquier ancho de pantalla) con ocho tiradores de redimensión; al costado `<img [src]="slot.dataUrl">` como preview; y dos botones, uno `[disabled]="slot.busy"` que dispara `applyBox` con el rectángulo actual, y otro `data-testid="crop-discard"` que llama `removeSlot(slot.target)`. Cada slot lleva `data-testid="crop-slot"` y su rótulo `data-testid="crop-slot-label"`.

El arrastre se implementa con `pointerdown`/`pointermove`/`pointerup` sobre el contenedor, convirtiendo las coordenadas del puntero a fracciones con `getBoundingClientRect()`. `applyBox` se llama SOLO en `pointerup` — no en cada `pointermove` — para que un arrastre sea una llamada al API, no cuarenta.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @exams-generator/web test`
Expected: PASS — 5 tests nuevos.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/features/bank/crop-review/
git commit -m "feat(web): add the crop review component for adjusting AI crops"
```

---

### Task 10: cablear el recorte en "Nueva pregunta"

Última tarea: la extracción muestra los recortes, el profesor los ajusta, y al guardar se suben.

La cadena de guardado del complemento **ya existe** (`submitStructured` → `attachStructuredImageAndFinish` → `replaceQuestionImage`, alimentada por el signal `sImage`). El recorte de la figura solo tiene que alimentar `sImage`. Lo nuevo es el eslabón de las alternativas.

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-new/bank-new.component.ts`
- Modify: `apps/web/src/app/features/bank/bank-new/bank-new.component.html`
- Test: `apps/web/src/app/features/bank/bank-new/bank-new.component.spec.ts` (existente, se extiende)

**Interfaces:**
- Consumes: `CropReviewComponent`, `CropSlot`, `CropTarget` (Task 9); `AiService.recropExtraction` y `BankService.setAlternativeImages` (Task 8); `dataUrlToFile` (Task 8).
- Produces: nada que consuma otra tarea.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/app/features/bank/bank-new/bank-new.component.spec.ts — append

const EXTRACTED_WITH_CROPS = {
  bodyTypst: '¿Qué muestra la figura?',
  alternatives: ['a', 'b', 'c', 'd', 'e'],
  correctAnswer: '0',
  extractionId: 'extraction-1',
  figureCrop: { dataUrl: 'data:image/png;base64,AAAA', box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } },
  alternativeCrops: [
    { alternativeIndex: 0, dataUrl: 'data:image/png;base64,BBBB', box: { x: 0, y: 0.7, w: 0.1, h: 0.1 } },
    { alternativeIndex: 2, dataUrl: 'data:image/png;base64,CCCC', box: { x: 0.3, y: 0.7, w: 0.1, h: 0.1 } },
  ],
};

describe('BankNewComponent — AI crops', () => {
  it('renders no crop review when the extraction returned no crops', () => {
    // extractWithAi resolves with a body carrying neither figureCrop nor alternativeCrops
    // ...
    expect(fixture.nativeElement.querySelector('app-crop-review')).toBeNull();
  });

  it('builds one slot per returned crop, labelled by alternative letter', () => {
    // extractWithAi resolves with EXTRACTED_WITH_CROPS
    // ...
    expect(component.cropSlots().map((slot) => slot.label)).toEqual([
      'Figura del enunciado',
      'Alternativa a)',
      'Alternativa c)',
    ]);
  });

  it('replaces a slot with the API result after a manual re-crop', () => {
    // ...
    component.onRecrop({ target: { kind: 'figure' }, box: { x: 0, y: 0, w: 0.2, h: 0.2 } });
    aiService.recropExtraction.mock.results // resolves with { dataUrl: 'data:image/png;base64,ZZZZ', box: { x: 0, y: 0, w: 0.2, h: 0.2 } }
    // ...
    expect(component.cropSlots()[0]!.dataUrl).toBe('data:image/png;base64,ZZZZ');
  });

  it('drops a slot the teacher discarded so it is never uploaded', () => {
    // ...
    component.onDiscard({ kind: 'alternative', alternativeIndex: 2 });

    expect(component.cropSlots().map((slot) => slot.label)).toEqual([
      'Figura del enunciado',
      'Alternativa a)',
    ]);
  });

  it('uploads the figure crop and the alternative crops after creating the question', () => {
    // ...saving with EXTRACTED_WITH_CROPS in place
    expect(bankService.createStructuredQuestion).toHaveBeenCalled();
    expect(bankService.replaceQuestionImage).toHaveBeenCalledWith('q1', expect.any(File));
    expect(bankService.setAlternativeImages).toHaveBeenCalledWith('q1', [
      { alternativeIndex: 0, file: expect.any(File) },
      { alternativeIndex: 2, file: expect.any(File) },
    ]);
  });

  it('keeps the created question and shows an actionable error when an image upload fails', () => {
    // ...setAlternativeImages errors
    expect(component.saveError()).toContain('La pregunta se guardó');
    // A resubmit must not create a second question.
    component.submitStructured();
    expect(bankService.createStructuredQuestion).toHaveBeenCalledTimes(1);
  });
});
```

Reutilizar el arnés de TestBed y los mocks de `AiService`/`BankService` que ya tiene ese spec; agregar `recropExtraction` y `setAlternativeImages` a los mocks existentes.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @exams-generator/web test`
Expected: FAIL — `component.cropSlots is not a function`.

- [ ] **Step 3: Add the crop state to the component**

```ts
// bank-new.component.ts

  /** Handle for the re-crop endpoint; null when the extraction produced no crops. */
  private extractionId: string | null = null;
  protected readonly cropSlots = signal<readonly CropSlot[]>([]);

  /**
   * The photo the crops were cut from, as an object URL. Feeds
   * `<app-crop-review>`'s background — the teacher adjusts the rectangle over
   * the ORIGINAL photo, not over the crop.
   */
  protected readonly cropPhotoUrl = computed(() => this.pImagePreviewUrl());
```

En el `next` de `extractWithAi()`, además de lo que ya hace:

```ts
      this.extractionId = extracted.extractionId ?? null;
      this.cropSlots.set(buildCropSlots(extracted));
      // The figure crop feeds the SAME signal the manual complement-image
      // picker feeds, so the existing save chain uploads it with no change.
      this.sImage.set(
        extracted.figureCrop ? dataUrlToFile(extracted.figureCrop.dataUrl, 'figura.png') : null,
      );
```

```ts
const ALTERNATIVE_LETTERS = ['a', 'b', 'c', 'd', 'e'];

/** Turns the extraction response's crops into review slots, figure first. */
function buildCropSlots(extracted: AiExtractedQuestion): readonly CropSlot[] {
  const slots: CropSlot[] = [];
  if (extracted.figureCrop) {
    slots.push({
      target: { kind: 'figure' },
      label: 'Figura del enunciado',
      dataUrl: extracted.figureCrop.dataUrl,
      box: extracted.figureCrop.box,
      busy: false,
    });
  }
  for (const crop of extracted.alternativeCrops ?? []) {
    slots.push({
      target: { kind: 'alternative', alternativeIndex: crop.alternativeIndex },
      label: `Alternativa ${ALTERNATIVE_LETTERS[crop.alternativeIndex] ?? crop.alternativeIndex})`,
      dataUrl: crop.dataUrl,
      box: crop.box,
      busy: false,
    });
  }
  return slots;
}
```

- [ ] **Step 4: Handle recrop and discard**

```ts
  protected onRecrop(event: { target: CropTarget; box: NormalizedBoxDto }): void {
    const extractionId = this.extractionId;
    if (!extractionId) return;

    this.updateSlot(event.target, (slot) => ({ ...slot, busy: true }));
    this.aiService.recropExtraction(extractionId, event.box).subscribe({
      next: (crop) => {
        this.updateSlot(event.target, (slot) => ({
          ...slot,
          dataUrl: crop.dataUrl,
          box: crop.box,
          busy: false,
        }));
        if (event.target.kind === 'figure') {
          this.sImage.set(dataUrlToFile(crop.dataUrl, 'figura.png'));
        }
      },
      error: (error: HttpErrorResponse) => {
        this.updateSlot(event.target, (slot) => ({ ...slot, busy: false }));
        this.extractError.set(
          error.status === 410
            ? 'La sesión de recorte expiró. Vuelve a extraer la pregunta desde la foto.'
            : 'No se pudo recortar. Inténtalo de nuevo.',
        );
      },
    });
  }

  protected onDiscard(target: CropTarget): void {
    this.cropSlots.update((slots) => slots.filter((slot) => !sameTarget(slot.target, target)));
    if (target.kind === 'figure') {
      this.sImage.set(null);
    }
  }

  private updateSlot(target: CropTarget, patch: (slot: CropSlot) => CropSlot): void {
    this.cropSlots.update((slots) =>
      slots.map((slot) => (sameTarget(slot.target, target) ? patch(slot) : slot)),
    );
  }
```

- [ ] **Step 5: Extend the save chain**

```ts
// Replace the body of attachStructuredImageAndFinish so it runs the alternative
// images after the complement image, and finishes only once both are done.

  private attachStructuredImageAndFinish(id: string): void {
    const image = this.sImage();
    if (!image) {
      this.attachAlternativeImagesAndFinish(id);
      return;
    }
    this.bankService.replaceQuestionImage(id, image).subscribe({
      next: () => this.attachAlternativeImagesAndFinish(id),
      error: () => this.failAfterCreate(),
    });
  }

  private attachAlternativeImagesAndFinish(id: string): void {
    const crops = this.cropSlots()
      .filter((slot) => slot.target.kind === 'alternative')
      .map((slot) => ({
        alternativeIndex: (slot.target as { alternativeIndex: number }).alternativeIndex,
        file: dataUrlToFile(slot.dataUrl, 'alternativa.png'),
      }));

    if (crops.length === 0) {
      this.saving.set(false);
      this.router.navigate(['/app/bank']);
      return;
    }

    this.bankService.setAlternativeImages(id, crops).subscribe({
      next: () => {
        this.saving.set(false);
        this.router.navigate(['/app/bank']);
      },
      error: () => this.failAfterCreate(),
    });
  }

  /**
   * The question itself is already created and `sCreatedQuestionId` is set, so
   * a resubmit retries only the image uploads. Deleting the question instead
   * would throw away a good transcription over a failed upload.
   */
  private failAfterCreate(): void {
    this.saving.set(false);
    this.saveError.set(
      'La pregunta se guardó, pero no se pudieron adjuntar las imágenes. Edítala desde el banco para volver a intentarlo.',
    );
  }
```

- [ ] **Step 6: Render the component**

En `bank-new.component.html`, dentro del tab Estructurada y antes de los botones de guardado:

```html
@if (cropSlots().length > 0 && cropPhotoUrl(); as photoUrl) {
  <app-crop-review
    [photoUrl]="photoUrl"
    [slots]="cropSlots()"
    (recrop)="onRecrop($event)"
    (discard)="onDiscard($event)"
  />
}
```

Agregar `CropReviewComponent` a los `imports` del decorador.

- [ ] **Step 7: Run the web tests**

Run: `pnpm --filter @exams-generator/web test`
Expected: PASS.

- [ ] **Step 8: Full suites and commit**

```bash
pnpm --filter @exams-generator/api test
pnpm --filter @exams-generator/web test
git add apps/web/src/app/features/bank/bank-new/
git commit -m "feat(web): review and adjust AI crops when creating a question from a photo"
```

---

## Self-Review

**Cobertura del spec:**

| Sección del spec | Tarea |
|---|---|
| §3 Contrato del puerto de IA | Tasks 1, 4 |
| §4 Puerto de recorte | Task 3 |
| §5 Ajuste a tinta | Task 2 |
| §6 Flujo de extracción | Task 5 (recortes), Task 6 (cache + `extractionId`) |
| §7 Re-recorte manual | Task 6 |
| §8 Guardado, `indexes` esparso, fallo parcial | Tasks 7, 8, 10 |
| §9 Interfaz web | Tasks 9, 10 |
| §10 Pruebas | distribuidas en cada tarea |
| §11 Orden de implementación | el orden de las tareas lo respeta |

**Desvío consciente respecto del spec §11:** el spec lista `sharp` primero y `NormalizedBox` segundo. El plan invierte ese par (`NormalizedBox` es Task 1, `sharp` es Task 3) porque el adaptador de `sharp` importa `toPixelRect`; escribirlo antes obligaría a un stub que se borra enseguida. El paso de verificación de Docker sigue siendo lo primero que se ejecuta dentro de la tarea de `sharp`, que es lo que el spec realmente protege.

**Puntos de atención para quien ejecute:**

- Task 3, Step 2 es un **gate duro**: si `sharp` no carga dentro de la imagen de producción, no seguir. Todo lo demás depende de eso.
- Task 5 cambia la firma de `ExtractQuestionService.extract` dos veces (Task 5 agrega el cropper, Task 6 agrega el cache y el `user`). Es deliberado: cada mitad tiene su propio test, y el segundo cambio es de una línea en el constructor.
- El helper `sameTarget` aparece en Task 9 (dentro de `crop-review.component.ts`) y se reusa en Task 10. Exportarlo desde el componente al escribir Task 9 para no duplicarlo.
- Los tests de Task 10 están esbozados con el arnés existente marcado con `// ...`: ese spec ya tiene TestBed y mocks montados, y duplicarlos aquí produciría dos arneses que divergen. Leer el spec existente antes de escribirlos.
