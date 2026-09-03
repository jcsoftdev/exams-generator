# Carpetas de preguntas por colegio — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que cada colegio tenga su propio árbol de carpetas tipo Drive sobre el banco de preguntas — sembrado desde la taxonomía global, editable libremente, y sin que borrar una carpeta borre una sola pregunta.

**Architecture:** Tabla nueva `question_folders` con `parent_id` autorreferencial y `tenant_id` obligatorio; la taxonomía global (`courses` → `topics`) no se toca y sigue siendo la clasificación oficial. Cada tenant recibe su set por defecto la primera vez que pide `GET /bank/folders`, sembrado dentro de una transacción con `SELECT … FOR UPDATE` sobre su fila en `tenants` y marcado con `tenants.folders_seeded_at`. Las preguntas propias del colegio apuntan a una carpeta vía `questions.folder_id`; las del banco central se muestran dentro de la carpeta cuyo `topic_id` coincide con su Tema, sin pertenecer a ella. En la web, una primitiva `ui-folder-tree` sobre el CDK Tree reemplaza el árbol Curso → Tema del banco, alimentada por un `BankFoldersStore` de signals con actualización optimista y rollback.

**Tech Stack:** NestJS 10 + Drizzle 0.33 / Postgres (`apps/api`), Angular 22 standalone + signals + Tailwind 4 + `@angular/cdk@^22` (`apps/web`), DTOs compartidos en `packages/shared`. Tests: Jest (proyectos `non-e2e`, `db-serial`, `e2e`) en el API, Vitest vía `ng test` (`@angular/build:unit-test`) en la web.

**Spec:** `docs/superpowers/specs/2026-09-03-question-folders-design.md`

## Global Constraints

- **Strict TDD, y el test rojo es un test de FEATURE.** En el API eso es un `*.e2e.spec.ts` con supertest contra el Nest real y el Postgres real; en la web, un spec de componente que maneja el flujo del usuario por TestBed. Los tests unitarios quedan SOLO para funciones puras (armado del árbol desde filas planas, sufijo de grado, ciclo/profundidad).
- **Cada tarea: escribir el test que falla → correrlo y decir en voz alta por qué falla → implementar → correr → commit.** Conventional Commits, en inglés, **sin `Co-Authored-By` ni atribución de IA**.
- **E2E siempre con `--runInBand`.** En paralelo produce fallos rotativos falsos por contención sobre el Postgres local.
- **Nunca correr un build de producción** (`pnpm build`, `ng build`, `turbo run build`). La única excepción es `pnpm --filter @exams-generator/shared build`, y **hay que pedirle permiso al usuario antes de correrlo** (ver Task 2, Step 8): el typecheck del API resuelve `@exams-generator/shared` contra `packages/shared/dist/index.d.ts` (`apps/api/tsconfig.build.json`), así que sin ese build los tipos nuevos no existen para el API. La web sí resuelve el paquete desde el SOURCE (`apps/web/tsconfig.typecheck.json`), y jest del API también (`moduleNameMapper` en `apps/api/jest.config.js`) — por eso los tests pasan aunque `dist` esté viejo, y el typecheck es un gate SEPARADO que hay que correr igual.
- **Nunca leer `.env` directamente.** Si hace falta un valor, `envsafe show .env`.
- **Shell: `bat`/`rg`/`fd`/`sd`/`eza`.** Nada de `cat`/`grep`/`find`/`sed`/`ls`.
- **`pnpm format` antes de cada commit.** CI tiene un job `typecheck + format` que falla con cualquier diferencia de Prettier.
- **Profundidad máxima de carpetas: 6 niveles.** La raíz es nivel 1. Crear o mover algo que resulte en nivel 7 es 422 `folder_depth_exceeded`.
- **Nombre de carpeta: 1–80 caracteres después de `trim()`.** Fuera de ese rango es 422 `folder_name_invalid`.
- **Códigos de error exactos, tal cual los escribe el spec:** `folder_name_invalid`, `folder_name_taken`, `folder_cycle`, `folder_depth_exceeded`, `folder_not_found`, `tenant_required`, `central_question_has_no_folder`.
- **Copy de UI en español, EXACTO como lo escribe el spec.** El texto del modal de borrado es literal, incluidas las comillas angulares `«»`.
- Comentarios y documentación del código en inglés; textos visibles al usuario en español.
- **`bank.e2e.spec.ts` puede fallar por razones ajenas a este trabajo** — verificarlo contra el commit base antes de perseguir un fallo ahí.

---

## File Structure

**API — dominio puro (`apps/api/src/modules/bank/folders/domain/`)**
- `folder-name.ts` — validación de nombre y regla del sufijo de grado. Sin I/O.
- `build-seed-folder-plan.ts` — arma el plan de siembra (raíces por stage → cursos → temas) desde filas planas. Sin I/O.
- `assemble-folder-tree.ts` — arma el árbol anidado + conteos desde filas planas. Sin I/O.
- `check-folder-move.ts` — ciclo y profundidad. Sin I/O.

**API — módulo (`apps/api/src/modules/bank/folders/`)**
- `bank-folders.errors.ts` — códigos de error y helper de excepción.
- `bank-folders.repository.ts` — Drizzle: listar, sembrar, crear, mover, borrar subárbol, conteos.
- `bank-folders.service.ts` — reglas, siembra al vuelo, autorización por tenant.
- `bank-folders.controller.ts` — `GET/POST/PATCH/DELETE /bank/folders`.
- `bank-folders.e2e.spec.ts` — el test de feature de todo lo anterior.

**API — schema y migración**
- `apps/api/src/db/schema/question-folders.schema.ts` (nuevo)
- `apps/api/src/db/schema/tenants.schema.ts` (nueva columna `folders_seeded_at`)
- `apps/api/src/db/schema/questions.schema.ts` (nueva columna `folder_id`)
- `apps/api/src/db/schema/index.ts` (nuevo export)
- `apps/api/drizzle/0022_*.sql` (generada, revisada a mano)

**API — modificados**
- `bank.module.ts`, `bank.controller.ts`, `bank.service.ts`, `bank.repository.ts`, `domain/ports/bank-repository.port.ts`

**Shared (`packages/shared/src/`)**
- `dto/bank-folder.dto.ts` (nuevo) + `index.ts` (export) + `dto/bank-question.dto.ts` (`folderId`) + `domain/grade-level.ts` (`GRADE_LEVEL_LABELS` promovido).

**Web — primitiva (`apps/web/src/app/ui/folder-tree/`)**
- `folder-tree.types.ts`, `folder-tree.component.ts`, `folder-tree.component.spec.ts`

**Web — feature (`apps/web/src/app/features/bank/`)**
- `folders/bank-folders.store.ts`, `folders/bank-folders.store.spec.ts`, `folders/folder-tree.model.ts`, `folders/folder-tree.model.spec.ts`
- Modificados: `bank.service.ts`, `bank.models.ts`, `bank-list/bank-list.component.{ts,html,spec.ts}`, `bank-new/bank-new.component.{ts,html,spec.ts}`
- Borrados al final: `bank-list/bank-question-tree.ts` y `bank-list/bank-question-tree.spec.ts`

---

## Ambigüedades del spec resueltas en este plan

Están explicadas donde aplican, pero se listan juntas para que nadie las descubra a mitad de una tarea:

1. **"el enum de errores del bank que ya existe" no existe.** El módulo bank tira `BadRequestException`/`ConflictException`/etc. con mensajes en texto, sin códigos. El único precedente de código estable en el repo es `ai.controller.ts:86` (`{ statusCode, code, message }` dentro de un `HttpException`). Este plan crea `bank-folders.errors.ts` con ese mismo shape y publica la lista de códigos en `packages/shared` para que la web pueda discriminarlos.
2. **El sufijo de grado.** El diagrama del spec escribe `Trigonometría: razones e identidades (4°)`, pero el spec también dice explícitamente "la misma regla que ya aplica `buildQuestionTree`… para que el nombre sembrado sea el mismo que hoy se ve". La implementación real (`bank-list.component.ts:882` `topicDisplayName`) produce `` `${name} · ${gradeLevelLabel(grade)}` `` → `Trigonometría: razones e identidades · 4° secundaria`. Gana la implementación: el diagrama es ilustrativo, la paridad es el requisito.
3. **Orden de las raíces por stage.** El diagrama las lista Colegio / Preuniversitario / Escuela, que no es alfabético ni progresivo. Este plan usa el orden progresivo `escuela` (0) → `colegio` (1) → `preuniversitario` (2).
4. **"La búsqueda por texto sigue global".** Hoy el buscador del banco filtra el árbol por nombre de curso/tema, no las preguntas. Se mantiene ese comportamiento sobre los nombres de carpeta: es "global" en el sentido de que no queda acotado a la carpeta seleccionada.
5. **Alcance de los conteos.** El spec no fija un filtro de estado. Los conteos de `GET /bank/folders` cuentan TODAS las preguntas visibles de la carpeta, igual que `GET /bank/questions` sin `status`.
6. **`GRADE_LEVEL_LABELS` vive hoy en la web** (`features/taxonomy/grade-level-labels.ts`) con un comentario en `packages/shared/src/domain/grade-level.ts` que dice "Labels are deliberately NOT here… the API had a `STAGE_LABELS` map that nothing on the server ever read". Esa razón deja de valer: ahora el API genera copy visible (el nombre sembrado). Se promueve el mapa a `packages/shared` y la web lo re-exporta.

---

### Task 1: Dominio puro de carpetas — nombre, sufijo de grado, plan de siembra, árbol, ciclo y profundidad

Primera tarea a propósito: son las cuatro funciones que las tareas 2–5 usan, no tocan la base de datos, y son las ÚNICAS de todo el plan que se prueban con tests unitarios (son puras). Todo lo demás se prueba con e2e.

**Files:**
- Modify: `packages/shared/src/domain/grade-level.ts`
- Modify: `apps/web/src/app/features/taxonomy/grade-level-labels.ts`
- Create: `apps/api/src/modules/bank/folders/domain/folder-name.ts`
- Create: `apps/api/src/modules/bank/folders/domain/build-seed-folder-plan.ts`
- Create: `apps/api/src/modules/bank/folders/domain/assemble-folder-tree.ts`
- Create: `apps/api/src/modules/bank/folders/domain/check-folder-move.ts`
- Test: `apps/api/src/modules/bank/folders/domain/folder-name.spec.ts`
- Test: `apps/api/src/modules/bank/folders/domain/build-seed-folder-plan.spec.ts`
- Test: `apps/api/src/modules/bank/folders/domain/assemble-folder-tree.spec.ts`
- Test: `apps/api/src/modules/bank/folders/domain/check-folder-move.spec.ts`

**Interfaces:**
- Consumes: `GRADE_LEVELS`, `GradeLevel` de `@exams-generator/shared` (ya existen).
- Produces:
  ```ts
  // packages/shared/src/domain/grade-level.ts
  export const GRADE_LEVEL_LABELS: Record<GradeLevel, string>;
  export function gradeLevelLabel(gradeLevel: string): string;

  // folder-name.ts
  export const MAX_FOLDER_NAME_LENGTH = 80;
  export type FolderNameResult = { ok: true; name: string } | { ok: false; code: "folder_name_invalid" };
  export function validateFolderName(raw: unknown): FolderNameResult;
  export function folderNameForTopic(
    topic: { readonly name: string; readonly gradeLevel: string | null },
    siblings: readonly { readonly name: string }[],
  ): string;

  // build-seed-folder-plan.ts
  export interface SeedCourseRow { readonly id: string; readonly name: string; readonly stage: string }
  export interface SeedTopicRow { readonly id: string; readonly courseId: string; readonly name: string; readonly gradeLevel: string | null }
  export interface SeedFolderPlanNode {
    readonly key: string; readonly parentKey: string | null;
    readonly name: string; readonly topicId: string | null; readonly position: number;
  }
  export function buildSeedFolderPlan(
    courses: readonly SeedCourseRow[], topics: readonly SeedTopicRow[],
  ): SeedFolderPlanNode[];

  // assemble-folder-tree.ts
  export interface FlatFolderRow {
    readonly id: string; readonly name: string; readonly parentId: string | null;
    readonly topicId: string | null; readonly position: number;
  }
  export function assembleFolderTree(
    rows: readonly FlatFolderRow[],
    ownCounts: ReadonlyMap<string, number>,
    centralCountsByTopic: ReadonlyMap<string, number>,
  ): BankFolderNode[];

  // check-folder-move.ts
  export const MAX_FOLDER_DEPTH = 6;
  export type FolderMoveResult = { ok: true } | { ok: false; code: "folder_cycle" | "folder_depth_exceeded" };
  export function checkFolderMove(params: {
    readonly folderId: string;
    readonly targetParentId: string | null;
    readonly descendantIds: readonly string[];
    readonly targetParentDepth: number;
    readonly subtreeHeight: number;
  }): FolderMoveResult;
  ```

- [ ] **Step 1: Promover `GRADE_LEVEL_LABELS` a `packages/shared`**

En `packages/shared/src/domain/grade-level.ts`, reemplazar el párrafo final del docblock ("Labels are deliberately NOT here…") por la razón nueva y agregar el mapa al final del archivo:

```ts
/**
 * Spanish labels for the catalog. These USED to live only in the web, with a
 * note here saying labels were deliberately excluded because "the API had a
 * `STAGE_LABELS` map that nothing on the server ever read". That stopped being
 * true: the question-folder seeder generates USER-VISIBLE folder names
 * server-side (`folderNameForTopic`), and the seeded name has to be
 * byte-identical to the suffix the bank tree already renders in the browser.
 * One map, two consumers, no drift.
 */
export const GRADE_LEVEL_LABELS: Record<GradeLevel, string> = {
  primaria_1: "1° primaria",
  primaria_2: "2° primaria",
  primaria_3: "3° primaria",
  primaria_4: "4° primaria",
  primaria_5: "5° primaria",
  primaria_6: "6° primaria",
  secundaria_1: "1° secundaria",
  secundaria_2: "2° secundaria",
  secundaria_3: "3° secundaria",
  secundaria_4: "4° secundaria",
  secundaria_5: "5° secundaria",
  pre: "Pre-admisión",
};

/** Falls back to the raw code so an unknown/legacy grade renders as itself instead of `undefined`. */
export function gradeLevelLabel(gradeLevel: string): string {
  return GRADE_LEVEL_LABELS[gradeLevel as GradeLevel] ?? gradeLevel;
}
```

En `apps/web/src/app/features/taxonomy/grade-level-labels.ts`, borrar el objeto literal `GRADE_LEVEL_LABELS` y re-exportar el compartido, dejando `STAGE_LABELS` intacto:

```ts
import { Stage } from '@exams-generator/shared';

/**
 * The grade labels are a CONTRACT now, not just web copy: the API's folder
 * seeder generates folder names with the same suffix (`folderNameForTopic`).
 * Re-exported from `@exams-generator/shared` so this file stays the single
 * import site the bank/ai/exams models already use.
 */
export { GRADE_LEVEL_LABELS } from '@exams-generator/shared';

/**
 * Long form, for controls where the stage is the subject. The short form used
 * to disambiguate a duplicated course name lives in `course-label.ts`.
 */
export const STAGE_LABELS: Record<Stage, string> = {
  escuela: 'Escuela (Primaria)',
  colegio: 'Colegio (Secundaria)',
  preuniversitario: 'Preuniversitario',
};
```

- [ ] **Step 2: Escribir el test que falla — nombre y sufijo de grado**

```ts
// apps/api/src/modules/bank/folders/domain/folder-name.spec.ts
import { folderNameForTopic, validateFolderName } from "./folder-name";

describe("validateFolderName", () => {
  it("trims and accepts a normal name", () => {
    expect(validateFolderName("  Trigonometría  ")).toEqual({ ok: true, name: "Trigonometría" });
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(validateFolderName("")).toEqual({ ok: false, code: "folder_name_invalid" });
    expect(validateFolderName("   ")).toEqual({ ok: false, code: "folder_name_invalid" });
  });

  it("rejects anything longer than 80 characters AFTER trimming", () => {
    // 80 spaces + 80 chars + 80 spaces trims down to exactly 80 -> valid.
    const exactly80 = "a".repeat(80);
    expect(validateFolderName(`${" ".repeat(80)}${exactly80}${" ".repeat(80)}`)).toEqual({
      ok: true,
      name: exactly80,
    });
    expect(validateFolderName("a".repeat(81))).toEqual({ ok: false, code: "folder_name_invalid" });
  });

  it("rejects a non-string — the body field is client-supplied and untyped at runtime", () => {
    expect(validateFolderName(undefined)).toEqual({ ok: false, code: "folder_name_invalid" });
    expect(validateFolderName(42)).toEqual({ ok: false, code: "folder_name_invalid" });
  });
});

describe("folderNameForTopic", () => {
  /**
   * Mirrors `topicDisplayName` in apps/web/src/app/features/bank/bank-list/
   * bank-list.component.ts — the suffix appears ONLY when a sibling topic of
   * the same course carries the exact same name, and only if the topic has a
   * grade to disambiguate with.
   */
  it("leaves a unique topic name bare", () => {
    const siblings = [{ name: "Longitud de arco" }, { name: "Identidades" }];
    expect(folderNameForTopic({ name: "Longitud de arco", gradeLevel: "pre" }, siblings)).toBe(
      "Longitud de arco",
    );
  });

  it("appends ' · <grade label>' when a sibling shares the name", () => {
    const siblings = [{ name: "Trigonometría" }, { name: "Trigonometría" }];
    expect(
      folderNameForTopic({ name: "Trigonometría", gradeLevel: "secundaria_4" }, siblings),
    ).toBe("Trigonometría · 4° secundaria");
  });

  it("stays bare when the name is shared but the topic has no grade", () => {
    const siblings = [{ name: "Trigonometría" }, { name: "Trigonometría" }];
    expect(folderNameForTopic({ name: "Trigonometría", gradeLevel: null }, siblings)).toBe(
      "Trigonometría",
    );
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd apps/api && pnpm exec jest --selectProjects non-e2e src/modules/bank/folders/domain/folder-name.spec.ts`
Expected: FAIL — `Cannot find module './folder-name'`.

- [ ] **Step 4: Implementar `folder-name.ts`**

```ts
// apps/api/src/modules/bank/folders/domain/folder-name.ts
import { gradeLevelLabel } from "@exams-generator/shared";

/** Spec §"Errores y bordes": name is 1..80 characters AFTER trimming. */
export const MAX_FOLDER_NAME_LENGTH = 80;

export type FolderNameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly code: "folder_name_invalid" };

/**
 * `raw` is typed `unknown` on purpose: it comes off a JSON request body, so
 * "it is a string" is a claim to verify, not a type the compiler can enforce.
 */
export function validateFolderName(raw: unknown): FolderNameResult {
  if (typeof raw !== "string") {
    return { ok: false, code: "folder_name_invalid" };
  }
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_FOLDER_NAME_LENGTH) {
    return { ok: false, code: "folder_name_invalid" };
  }
  return { ok: true, name };
}

/**
 * The seeded folder name for a topic. MUST stay byte-identical to
 * `topicDisplayName` in the web's `bank-list.component.ts`: the suffix appears
 * only when a sibling topic of the SAME course carries the exact same name,
 * and only when the topic has a grade to disambiguate with. A topic whose name
 * is unique in its course stays bare — a suffix on every row would be noise,
 * and a suffix on a topic with no grade would read as "· undefined".
 */
export function folderNameForTopic(
  topic: { readonly name: string; readonly gradeLevel: string | null },
  siblings: readonly { readonly name: string }[],
): string {
  const sharesName = siblings.filter((sibling) => sibling.name === topic.name).length > 1;
  if (sharesName && topic.gradeLevel) {
    return `${topic.name} · ${gradeLevelLabel(topic.gradeLevel)}`;
  }
  return topic.name;
}
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd apps/api && pnpm exec jest --selectProjects non-e2e src/modules/bank/folders/domain/folder-name.spec.ts`
Expected: PASS (10 assertions, 6 tests).

- [ ] **Step 6: Escribir el test que falla — plan de siembra**

```ts
// apps/api/src/modules/bank/folders/domain/build-seed-folder-plan.spec.ts
import { buildSeedFolderPlan, SeedCourseRow, SeedTopicRow } from "./build-seed-folder-plan";

const COURSES: SeedCourseRow[] = [
  { id: "c-mat-col", name: "Matemática", stage: "colegio" },
  { id: "c-com-col", name: "Comunicación", stage: "colegio" },
  { id: "c-tri-pre", name: "Trigonometría", stage: "preuniversitario" },
];

const TOPICS: SeedTopicRow[] = [
  { id: "t-1", courseId: "c-mat-col", name: "Trigonometría", gradeLevel: "secundaria_4" },
  { id: "t-2", courseId: "c-mat-col", name: "Trigonometría", gradeLevel: "secundaria_5" },
  { id: "t-3", courseId: "c-com-col", name: "Comprensión lectora", gradeLevel: null },
  { id: "t-4", courseId: "c-tri-pre", name: "Longitud de arco", gradeLevel: "pre" },
];

describe("buildSeedFolderPlan", () => {
  it("creates one root per stage that actually has courses, in school-progression order", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const roots = plan.filter((node) => node.parentKey === null);

    // No `escuela` course in the fixture -> no "Escuela" root at all.
    expect(roots.map((r) => [r.name, r.position])).toEqual([
      ["Colegio", 0],
      ["Preuniversitario", 1],
    ]);
  });

  it("puts one folder per course under its stage root, alphabetically", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const colegioKey = plan.find((node) => node.name === "Colegio")!.key;
    const courses = plan.filter((node) => node.parentKey === colegioKey);

    expect(courses.map((c) => [c.name, c.position])).toEqual([
      ["Comunicación", 0],
      ["Matemática", 1],
    ]);
    expect(courses.every((c) => c.topicId === null)).toBe(true);
  });

  it("puts one folder per topic under its course, carrying topicId and the grade suffix", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const matKey = plan.find((node) => node.name === "Matemática")!.key;
    const topics = plan.filter((node) => node.parentKey === matKey);

    expect(topics).toEqual([
      expect.objectContaining({ name: "Trigonometría · 4° secundaria", topicId: "t-1", position: 0 }),
      expect.objectContaining({ name: "Trigonometría · 5° secundaria", topicId: "t-2", position: 1 }),
    ]);
  });

  it("leaves a topic whose name is unique in its course bare", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    expect(plan.find((node) => node.topicId === "t-3")!.name).toBe("Comprensión lectora");
  });

  it("gives every node a unique key, so the repository can wire parents before ids exist", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    expect(new Set(plan.map((node) => node.key)).size).toBe(plan.length);
  });

  it("emits parents before children — the repository inserts in plan order", () => {
    const plan = buildSeedFolderPlan(COURSES, TOPICS);
    const seen = new Set<string>();
    for (const node of plan) {
      if (node.parentKey !== null) {
        expect(seen.has(node.parentKey)).toBe(true);
      }
      seen.add(node.key);
    }
  });

  it("returns an empty plan when there are no courses", () => {
    expect(buildSeedFolderPlan([], [])).toEqual([]);
  });
});
```

- [ ] **Step 7: Correr el test y verificar que falla**

Run: `cd apps/api && pnpm exec jest --selectProjects non-e2e src/modules/bank/folders/domain/build-seed-folder-plan.spec.ts`
Expected: FAIL — `Cannot find module './build-seed-folder-plan'`.

- [ ] **Step 8: Implementar `build-seed-folder-plan.ts`**

```ts
// apps/api/src/modules/bank/folders/domain/build-seed-folder-plan.ts
import { folderNameForTopic } from "./folder-name";

export interface SeedCourseRow {
  readonly id: string;
  readonly name: string;
  readonly stage: string;
}

export interface SeedTopicRow {
  readonly id: string;
  readonly courseId: string;
  readonly name: string;
  readonly gradeLevel: string | null;
}

/**
 * One node of the seed plan. `key`/`parentKey` are LOCAL identifiers, not
 * database ids: the plan is built before a single row is inserted, so a child
 * cannot reference its parent's uuid yet. The repository walks the plan in
 * order, inserts each node, and keeps a `key -> id` map to resolve `parentKey`
 * — which is why `buildSeedFolderPlan` guarantees parents come first.
 */
export interface SeedFolderPlanNode {
  readonly key: string;
  readonly parentKey: string | null;
  readonly name: string;
  readonly topicId: string | null;
  readonly position: number;
}

/**
 * Spanish labels for the stage roots, exactly as the spec writes them. A stage
 * with no courses gets no root at all — an empty "Escuela" branch would be a
 * dead node the teacher has to collapse forever.
 */
const STAGE_ROOT_LABELS: Readonly<Record<string, string>> = {
  escuela: "Escuela",
  colegio: "Colegio",
  preuniversitario: "Preuniversitario",
};

/**
 * School-progression order, NOT alphabetical. The spec's ASCII diagram lists
 * the roots Colegio / Preuniversitario / Escuela, which is neither — it is an
 * illustration, not an ordering rule (see the plan's "Ambigüedades" §3).
 */
const STAGE_ORDER = ["escuela", "colegio", "preuniversitario"] as const;

/**
 * The default folder set a tenant receives on its first `GET /bank/folders`:
 * a root per stage that has courses, a folder per course under it (alphabetical),
 * and a folder per topic under each course, carrying `topicId` so central-bank
 * questions of that topic surface inside it. `subtopics` are deliberately not
 * seeded — the web never used them and curso -> tema already covers the
 * teacher's example.
 */
export function buildSeedFolderPlan(
  courses: readonly SeedCourseRow[],
  topics: readonly SeedTopicRow[],
): SeedFolderPlanNode[] {
  const plan: SeedFolderPlanNode[] = [];
  // A stage the catalog grew that this list does not know about still gets a
  // root, appended after the known ones, labelled by its raw code.
  const stages = [
    ...STAGE_ORDER.filter((stage) => courses.some((course) => course.stage === stage)),
    ...[...new Set(courses.map((course) => course.stage))]
      .filter((stage) => !(STAGE_ORDER as readonly string[]).includes(stage))
      .sort((a, b) => a.localeCompare(b, "es")),
  ];

  let rootPosition = 0;
  for (const stage of stages) {
    const rootKey = `stage:${stage}`;
    plan.push({
      key: rootKey,
      parentKey: null,
      name: STAGE_ROOT_LABELS[stage] ?? stage,
      topicId: null,
      position: rootPosition,
    });
    rootPosition += 1;

    const stageCourses = courses
      .filter((course) => course.stage === stage)
      .sort((a, b) => a.name.localeCompare(b.name, "es"));

    for (const [coursePosition, course] of stageCourses.entries()) {
      const courseKey = `course:${course.id}`;
      plan.push({
        key: courseKey,
        parentKey: rootKey,
        name: course.name,
        topicId: null,
        position: coursePosition,
      });

      const courseTopics = topics.filter((topic) => topic.courseId === course.id);
      for (const [topicPosition, topic] of courseTopics.entries()) {
        plan.push({
          key: `topic:${topic.id}`,
          parentKey: courseKey,
          name: folderNameForTopic(topic, courseTopics),
          topicId: topic.id,
          position: topicPosition,
        });
      }
    }
  }

  return plan;
}
```

- [ ] **Step 9: Correr el test y verificar que pasa**

Run: `cd apps/api && pnpm exec jest --selectProjects non-e2e src/modules/bank/folders/domain/build-seed-folder-plan.spec.ts`
Expected: PASS (7 tests).

- [ ] **Step 10: Escribir el test que falla — armado del árbol y conteos**

```ts
// apps/api/src/modules/bank/folders/domain/assemble-folder-tree.spec.ts
import { assembleFolderTree, FlatFolderRow } from "./assemble-folder-tree";

const ROWS: FlatFolderRow[] = [
  { id: "pre", name: "Preuniversitario", parentId: null, topicId: null, position: 1 },
  { id: "col", name: "Colegio", parentId: null, topicId: null, position: 0 },
  { id: "mat", name: "Matemática", parentId: "col", topicId: null, position: 0 },
  { id: "tri4", name: "Trigonometría · 4° secundaria", parentId: "mat", topicId: "t-4", position: 0 },
  { id: "tri5", name: "Trigonometría · 5° secundaria", parentId: "mat", topicId: "t-5", position: 1 },
];

describe("assembleFolderTree", () => {
  it("nests children under their parent and sorts every level by position", () => {
    const tree = assembleFolderTree(ROWS, new Map(), new Map());

    expect(tree.map((node) => node.name)).toEqual(["Colegio", "Preuniversitario"]);
    expect(tree[0]!.children.map((node) => node.name)).toEqual(["Matemática"]);
    expect(tree[0]!.children[0]!.children.map((node) => node.id)).toEqual(["tri4", "tri5"]);
  });

  it("attaches own counts by folder id and central counts by topic id", () => {
    const tree = assembleFolderTree(
      ROWS,
      new Map([["tri4", 7]]),
      new Map([
        ["t-4", 30],
        ["t-5", 12],
      ]),
    );
    const [tri4, tri5] = tree[0]!.children[0]!.children;

    expect({ own: tri4!.ownCount, central: tri4!.centralCount }).toEqual({ own: 7, central: 30 });
    expect({ own: tri5!.ownCount, central: tri5!.centralCount }).toEqual({ own: 0, central: 12 });
  });

  it("gives a folder with no topicId a centralCount of 0 — a central question lives in exactly one topic folder", () => {
    const tree = assembleFolderTree(ROWS, new Map(), new Map([["t-4", 30]]));
    expect(tree[0]!.children[0]!.centralCount).toBe(0);
  });

  it("counts are DIRECT, never rolled up — the web sums the subtree itself", () => {
    const tree = assembleFolderTree(ROWS, new Map([["tri4", 7]]), new Map());
    expect(tree[0]!.ownCount).toBe(0);
    expect(tree[0]!.children[0]!.ownCount).toBe(0);
  });

  it("drops a row whose parent is missing instead of losing it into a phantom root", () => {
    const orphan: FlatFolderRow = {
      id: "ghost",
      name: "Huérfana",
      parentId: "does-not-exist",
      topicId: null,
      position: 0,
    };
    const tree = assembleFolderTree([...ROWS, orphan], new Map(), new Map());
    expect(tree.map((node) => node.id)).toEqual(["col", "pre"]);
  });

  it("returns an empty array for an empty tenant", () => {
    expect(assembleFolderTree([], new Map(), new Map())).toEqual([]);
  });
});
```

- [ ] **Step 11: Correr el test y verificar que falla**

Run: `cd apps/api && pnpm exec jest --selectProjects non-e2e src/modules/bank/folders/domain/assemble-folder-tree.spec.ts`
Expected: FAIL — `Cannot find module './assemble-folder-tree'`.

- [ ] **Step 12: Implementar `assemble-folder-tree.ts`**

```ts
// apps/api/src/modules/bank/folders/domain/assemble-folder-tree.ts
import { BankFolderNode } from "@exams-generator/shared";

/** One `question_folders` row, as the repository selects it. */
export interface FlatFolderRow {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly topicId: string | null;
  readonly position: number;
}

/**
 * Builds the nested tree `GET /bank/folders` returns from the flat row list
 * plus the two count maps, in memory — the same shape `buildQuestionTree`
 * already uses in the web, and for the same reason: two GROUP BY queries beat
 * one recursive query per level, and the tree of a tenant is small.
 *
 * Counts are DIRECT, never accumulated: `ownCount` is the folder's own
 * questions, `centralCount` the central-bank questions whose topic this folder
 * is linked to. Rolling them up is the web's job (`toFolderTreeNodes`) — the
 * wire carries the raw numbers so a client can present them either way without
 * a second endpoint.
 *
 * A row whose `parentId` names a folder that is not in `rows` is DROPPED, not
 * promoted to a root. Within one tenant's snapshot that can only mean the
 * parent was deleted between the two reads, and silently re-rooting an orphan
 * would show the teacher a folder in a place it never lived.
 */
export function assembleFolderTree(
  rows: readonly FlatFolderRow[],
  ownCounts: ReadonlyMap<string, number>,
  centralCountsByTopic: ReadonlyMap<string, number>,
): BankFolderNode[] {
  const childrenByParent = new Map<string | null, FlatFolderRow[]>();
  const known = new Set(rows.map((row) => row.id));

  for (const row of rows) {
    if (row.parentId !== null && !known.has(row.parentId)) {
      continue;
    }
    const siblings = childrenByParent.get(row.parentId);
    if (siblings) {
      siblings.push(row);
    } else {
      childrenByParent.set(row.parentId, [row]);
    }
  }

  const build = (parentId: string | null): BankFolderNode[] =>
    (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"))
      .map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        topicId: row.topicId,
        position: row.position,
        ownCount: ownCounts.get(row.id) ?? 0,
        centralCount: row.topicId ? (centralCountsByTopic.get(row.topicId) ?? 0) : 0,
        children: build(row.id),
      }));

  return build(null);
}
```

- [ ] **Step 13: Correr el test y verificar que pasa**

Run: `cd apps/api && pnpm exec jest --selectProjects non-e2e src/modules/bank/folders/domain/assemble-folder-tree.spec.ts`
Expected: FAIL todavía — `BankFolderNode` no existe aún en `@exams-generator/shared`. Ese tipo se crea en la Task 2, Step 3. **Si prefieres no dejar un rojo colgando entre tareas**, adelanta ese Step 3 aquí: son 20 líneas de interfaces sin lógica y no cambian el orden de nada más. Después de crearlo: PASS (6 tests).

- [ ] **Step 14: Escribir el test que falla — ciclo y profundidad**

```ts
// apps/api/src/modules/bank/folders/domain/check-folder-move.spec.ts
import { checkFolderMove, MAX_FOLDER_DEPTH } from "./check-folder-move";

describe("checkFolderMove", () => {
  it("allows a move to an unrelated parent that leaves the subtree within the depth cap", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "p",
        descendantIds: ["f", "child"],
        targetParentDepth: 2,
        subtreeHeight: 2,
      }),
    ).toEqual({ ok: true });
  });

  it("allows a move to the root", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: null,
        descendantIds: ["f"],
        targetParentDepth: 0,
        subtreeHeight: 1,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects moving a folder into itself", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "f",
        descendantIds: ["f"],
        targetParentDepth: 1,
        subtreeHeight: 1,
      }),
    ).toEqual({ ok: false, code: "folder_cycle" });
  });

  it("rejects moving a folder into one of its own descendants", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "grandchild",
        descendantIds: ["f", "child", "grandchild"],
        targetParentDepth: 3,
        subtreeHeight: 3,
      }),
    ).toEqual({ ok: false, code: "folder_cycle" });
  });

  it("rejects a move whose deepest leaf would land past level 6", () => {
    // Parent sits at level 5, subtree is 2 levels tall -> deepest leaf at 7.
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "p",
        descendantIds: ["f", "child"],
        targetParentDepth: 5,
        subtreeHeight: 2,
      }),
    ).toEqual({ ok: false, code: "folder_depth_exceeded" });
  });

  it("accepts a move that lands EXACTLY on level 6", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "p",
        descendantIds: ["f"],
        targetParentDepth: 5,
        subtreeHeight: 1,
      }),
    ).toEqual({ ok: true });
  });

  it("checks the cycle BEFORE the depth — a self-move must never report a depth error", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "f",
        descendantIds: ["f"],
        targetParentDepth: 9,
        subtreeHeight: 9,
      }),
    ).toEqual({ ok: false, code: "folder_cycle" });
  });

  it("pins the cap the spec fixed", () => {
    expect(MAX_FOLDER_DEPTH).toBe(6);
  });
});
```

- [ ] **Step 15: Correr el test y verificar que falla**

Run: `cd apps/api && pnpm exec jest --selectProjects non-e2e src/modules/bank/folders/domain/check-folder-move.spec.ts`
Expected: FAIL — `Cannot find module './check-folder-move'`.

- [ ] **Step 16: Implementar `check-folder-move.ts`**

```ts
// apps/api/src/modules/bank/folders/domain/check-folder-move.ts

/** Spec §"Modelo de datos": a root folder is level 1, so 6 means five levels of nesting under a root. */
export const MAX_FOLDER_DEPTH = 6;

export type FolderMoveResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: "folder_cycle" | "folder_depth_exceeded" };

export interface CheckFolderMoveParams {
  readonly folderId: string;
  /** `null` = move to the root. */
  readonly targetParentId: string | null;
  /** The folder itself PLUS every descendant, from the repository's recursive CTE. */
  readonly descendantIds: readonly string[];
  /** Level of the target parent (1 for a root folder). `0` when moving to the root. */
  readonly targetParentDepth: number;
  /** Levels the moved subtree occupies, counting the folder itself (a leaf is 1). */
  readonly subtreeHeight: number;
}

/**
 * The two structural rules a move has to satisfy, as one pure decision so the
 * service does the SQL and this does the thinking.
 *
 * Cycle is checked FIRST and deliberately: moving a folder into its own
 * descendant is also, usually, a depth violation, and reporting
 * `folder_depth_exceeded` for it would send the teacher off to shorten a path
 * that was never the problem.
 */
export function checkFolderMove(params: CheckFolderMoveParams): FolderMoveResult {
  const { targetParentId, descendantIds, targetParentDepth, subtreeHeight } = params;

  if (targetParentId !== null && descendantIds.includes(targetParentId)) {
    return { ok: false, code: "folder_cycle" };
  }

  if (targetParentDepth + subtreeHeight > MAX_FOLDER_DEPTH) {
    return { ok: false, code: "folder_depth_exceeded" };
  }

  return { ok: true };
}
```

- [ ] **Step 17: Correr toda la carpeta de dominio**

Run: `cd apps/api && pnpm exec jest --selectProjects non-e2e src/modules/bank/folders/domain/`
Expected: PASS — 4 suites, 27 tests.

- [ ] **Step 18: Formatear y commitear**

```bash
pnpm format
git add packages/shared/src/domain/grade-level.ts \
        apps/web/src/app/features/taxonomy/grade-level-labels.ts \
        apps/api/src/modules/bank/folders/domain
git commit -m "feat(api): add pure domain for question folders (naming, seed plan, tree, move rules)"
```

---

### Task 2: Schema, migración, DTOs compartidos y `GET /bank/folders` con siembra al vuelo

El primer incremento usable del API: un tenant nuevo pide su árbol y lo recibe sembrado. Trae adentro el schema, la migración y los DTOs compartidos porque nada de eso tiene un test de feature propio — se prueban por el endpoint que los usa.

**Files:**
- Create: `apps/api/src/db/schema/question-folders.schema.ts`
- Modify: `apps/api/src/db/schema/tenants.schema.ts`
- Modify: `apps/api/src/db/schema/questions.schema.ts`
- Modify: `apps/api/src/db/schema/index.ts`
- Create: `apps/api/drizzle/0022_*.sql` (generada)
- Create: `packages/shared/src/dto/bank-folder.dto.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/shared/src/dto/bank-question.dto.ts`
- Create: `apps/api/src/modules/bank/folders/bank-folders.errors.ts`
- Create: `apps/api/src/modules/bank/folders/bank-folders.repository.ts`
- Create: `apps/api/src/modules/bank/folders/bank-folders.service.ts`
- Create: `apps/api/src/modules/bank/folders/bank-folders.controller.ts`
- Modify: `apps/api/src/modules/bank/bank.module.ts`
- Test: `apps/api/src/modules/bank/folders/bank-folders.e2e.spec.ts`

**Interfaces:**
- Consumes: `buildSeedFolderPlan`, `assembleFolderTree`, `folderNameForTopic` (Task 1); `db`, `DRIZZLE_DB`, `Database` de `../../db/client`; `JwtAuthGuard`, `CurrentUser`, `AuthTokenPayload` (`{ sub, role, tenantId }`) de `../auth/`.
- Produces:
  ```ts
  // packages/shared/src/dto/bank-folder.dto.ts
  export const UNFILED_FOLDER_ID = "unfiled";
  export const MAX_FOLDER_DEPTH = 6;
  export const MAX_FOLDER_NAME_LENGTH = 80;
  export const BANK_FOLDER_ERROR_CODES = [...] as const;
  export type BankFolderErrorCode = (typeof BANK_FOLDER_ERROR_CODES)[number];
  export interface BankFolderNode { id; name; parentId; topicId; position; ownCount; centralCount; children }
  export interface BankFoldersResponse { folders: readonly BankFolderNode[]; unfiledCount: number }
  export interface CreateBankFolderDto { name: string; parentId?: string | null }
  export interface UpdateBankFolderDto { name?: string; parentId?: string | null }
  export interface DeleteBankFolderResponse { deletedFolders: number; unfiledQuestions: number }

  // bank-folders.errors.ts
  export function bankFolderError(code: BankFolderErrorCode): HttpException;

  // bank-folders.repository.ts
  export class BankFoldersRepository {
    listFolders(tenantId: string): Promise<FlatFolderRow[]>;
    seedIfNeeded(tenantId: string, plan: readonly SeedFolderPlanNode[]): Promise<void>;
    loadSeedSource(): Promise<{ courses: SeedCourseRow[]; topics: SeedTopicRow[] }>;
    countOwnByFolder(tenantId: string): Promise<Map<string, number>>;
    countCentralByTopic(topicIds: readonly string[]): Promise<Map<string, number>>;
    countUnfiled(tenantId: string): Promise<number>;
  }

  // bank-folders.service.ts
  export class BankFoldersService {
    getTree(user: AuthTokenPayload): Promise<BankFoldersResponse>;
  }
  ```

- [ ] **Step 1: Escribir el schema de `question_folders`**

```ts
// apps/api/src/db/schema/question-folders.schema.ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.schema";
import { topics } from "./topics.schema";

/**
 * A tenant's OWN folder tree over the question bank — never global, never
 * shared. The global taxonomy (`courses` -> `topics` -> `subtopics`) is
 * untouched and stays the official classification the exam builder and the AI
 * read; this table is the school's private filing cabinet on top of it.
 *
 * `parent_id` is the self-reference, resolved through Drizzle's documented
 * lazy `(): AnyPgColumn => questionFolders.id` callback (same pattern as
 * `tenants.logo_asset_id`). `ON DELETE CASCADE` on BOTH FKs is load-bearing:
 * dropping a tenant drops its whole cabinet, and deleting a folder deletes its
 * subtree in one statement instead of a recursive delete in application code.
 *
 * `topic_id` is set only on folders seeded from a topic and is what makes a
 * CENTRAL-bank question (`questions.tenant_id IS NULL`) visible inside a
 * tenant's folder without belonging to it — a central question can never carry
 * a `folder_id`, since folders are per-tenant and the central bank is shared.
 * `ON DELETE SET NULL`: retiring a topic from the taxonomy must not delete a
 * school's folder or unfile its questions.
 */
export const questionFolders = pgTable(
  "question_folders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => questionFolders.id, {
      onDelete: "cascade",
    }),
    name: text("name").notNull(),
    topicId: uuid("topic_id").references(() => topics.id, { onDelete: "set null" }),
    /** Order among siblings. Seeded folders follow the seed order; new ones go last. */
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    /**
     * Sibling uniqueness for NON-root folders. Postgres treats every NULL as
     * distinct in a unique index, so this one silently permits any number of
     * same-named ROOTS — which is why the partial index below exists. Same
     * NULL-distinct trap `topics_course_id_slug_grade_idx` documents.
     */
    siblingNameIdx: uniqueIndex("question_folders_sibling_name_idx").on(
      table.tenantId,
      table.parentId,
      table.name,
    ),
    /** The root half of the rule above — the case the plain unique index cannot cover. */
    rootNameIdx: uniqueIndex("question_folders_root_name_idx")
      .on(table.tenantId, table.name)
      .where(sql`${table.parentId} is null`),
    /**
     * One topic maps to at most ONE folder per tenant, so a central question
     * surfaces in exactly one place in the tree. Partial (`topic_id IS NOT
     * NULL`) because every hand-made folder has a NULL topic and they must not
     * collide with each other.
     */
    tenantTopicIdx: uniqueIndex("question_folders_tenant_topic_idx")
      .on(table.tenantId, table.topicId)
      .where(sql`${table.topicId} is not null`),
    /** Loading one level of children, and the recursive CTEs that walk the tree. */
    parentIdx: index("question_folders_tenant_parent_idx").on(table.tenantId, table.parentId),
  }),
);
```

Confirmar que `.where(sql\`…\`)` sobre `uniqueIndex` es un patrón ya usado en este repo:

```bash
rg -n "uniqueIndex\(" -A 8 apps/api/src/db/schema/cycles.schema.ts
```

Expected: `cycles_active_idx` con `.where(sql\`${table.isActive} = true\`)` — drizzle-kit 0.24 lo soporta nativamente.

- [ ] **Step 2: Agregar las dos columnas nuevas y exportar el schema**

En `apps/api/src/db/schema/tenants.schema.ts`, importar `timestamp` de `drizzle-orm/pg-core` y agregar la columna al final del objeto:

```ts
  /**
   * Set the first time this tenant's default folder set is seeded
   * (`BankFoldersService.getTree`). NULL means "never seeded". Without this
   * marker, a tenant that deletes every folder on purpose would silently get
   * the whole default set back on the next page load.
   */
  foldersSeededAt: timestamp("folders_seeded_at", { withTimezone: true }),
```

En `apps/api/src/db/schema/questions.schema.ts`, importar `questionFolders` desde `./question-folders.schema` y agregar, junto a `subtopicId`:

```ts
    /**
     * The tenant folder this question is filed under. Only meaningful when
     * `tenant_id` is non-null: folders are per-tenant, so a CENTRAL question
     * can never carry one (the service rejects it with 422
     * `central_question_has_no_folder`) — it surfaces inside a folder through
     * that folder's `topic_id` instead. `ON DELETE SET NULL` is the whole point
     * of the delete flow: removing a folder unfiles its questions, it never
     * deletes one.
     */
    folderId: uuid("folder_id").references(() => questionFolders.id, { onDelete: "set null" }),
```

…y el índice, dentro del segundo argumento de `pgTable`:

```ts
    folderIdIdx: index("questions_folder_id_idx").on(table.folderId),
```

En `apps/api/src/db/schema/index.ts`, insertar el export ANTES de `questions.schema` (`questions` importa `questionFolders`):

```ts
export * from "./question-folders.schema";
```

- [ ] **Step 3: Escribir los DTOs compartidos**

```ts
// packages/shared/src/dto/bank-folder.dto.ts

/**
 * Sentinel `folderId` for `GET /bank/questions?folderId=unfiled` — the tenant's
 * own questions with no folder. A sentinel rather than a second query param so
 * the web has ONE selection type (a folder id) for every node of the tree,
 * including the virtual "Sin carpeta" one.
 */
export const UNFILED_FOLDER_ID = "unfiled";

/** A root folder is level 1, so this allows five levels of nesting under a root. */
export const MAX_FOLDER_DEPTH = 6;

/** Characters allowed in a folder name, counted AFTER trimming. */
export const MAX_FOLDER_NAME_LENGTH = 80;

/**
 * Stable error codes for the folder endpoints, carried as `code` in the error
 * body (`{ statusCode, code, message }` — the shape `ai.controller.ts` already
 * uses for `ai_not_configured`). They live in `shared` because the web
 * discriminates on them: `folder_name_taken` marks the inline input red,
 * `folder_not_found` triggers a full tree reload (another tab deleted it),
 * and everything else is a plain message.
 */
export const BANK_FOLDER_ERROR_CODES = [
  "folder_name_invalid",
  "folder_name_taken",
  "folder_cycle",
  "folder_depth_exceeded",
  "folder_not_found",
  "tenant_required",
  "central_question_has_no_folder",
] as const;

export type BankFolderErrorCode = (typeof BANK_FOLDER_ERROR_CODES)[number];

/**
 * One node of `GET /bank/folders`.
 *
 * `ownCount` and `centralCount` are DIRECT counts of this folder only, never
 * rolled up over the subtree: the server computes them with two GROUP BY
 * queries, and the client sums whichever way it wants to display. `topicId` is
 * non-null only on a folder seeded from a topic; it is what makes central-bank
 * questions of that topic appear inside the folder without belonging to it.
 */
export interface BankFolderNode {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly topicId: string | null;
  readonly position: number;
  /** Tenant-owned questions whose `folderId` is this folder. */
  readonly ownCount: number;
  /** Central-bank questions whose `topicId` equals this folder's `topicId`. 0 when `topicId` is null. */
  readonly centralCount: number;
  readonly children: readonly BankFolderNode[];
}

export interface BankFoldersResponse {
  /** Roots, ordered by `position`. */
  readonly folders: readonly BankFolderNode[];
  /** Tenant-owned questions with no folder — the virtual "Sin carpeta" node's count. */
  readonly unfiledCount: number;
}

export interface CreateBankFolderDto {
  readonly name: string;
  /** Omitted or `null` creates a root folder. */
  readonly parentId?: string | null;
}

/** Every field optional: this one body renames, moves, or does both. `parentId: null` moves to the root. */
export interface UpdateBankFolderDto {
  readonly name?: string;
  readonly parentId?: string | null;
}

export interface DeleteBankFolderResponse {
  /** Folders removed, counting the one addressed plus its whole subtree. */
  readonly deletedFolders: number;
  /** Tenant-owned questions left with `folderId: null`. Drives the post-delete banner. */
  readonly unfiledQuestions: number;
}
```

En `packages/shared/src/index.ts`, agregar la línea después de `bank-question.dto`:

```ts
export * from "./dto/bank-folder.dto";
```

En `packages/shared/src/dto/bank-question.dto.ts`, agregar el campo al final de `BankQuestionDto`:

```ts
  /**
   * The tenant folder this question is filed under, or `null` (unfiled, or a
   * central-bank question — those never carry one). Nullable, never absent:
   * every read path selects it.
   */
  readonly folderId: string | null;
```

- [ ] **Step 4: Generar la migración y revisarla a mano**

```bash
cd apps/api && pnpm exec drizzle-kit generate --schema=./src/db/schema/index.ts --dialect=postgresql --out=./drizzle
```

Renombrar el archivo generado a `apps/api/drizzle/0022_question_folders.sql` **y actualizar el `tag` correspondiente en `apps/api/drizzle/meta/_journal.json`** (drizzle resuelve el archivo por ese tag; renombrar sin tocar el journal rompe la migración).

Revisar el SQL con `bat --plain apps/api/drizzle/0022_question_folders.sql` y confirmar que trae, literalmente:

```sql
CREATE TABLE IF NOT EXISTS "question_folders" (...);
ALTER TABLE "tenants" ADD COLUMN "folders_seeded_at" timestamp with time zone;
ALTER TABLE "questions" ADD COLUMN "folder_id" uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "question_folders_root_name_idx" ON "question_folders" USING btree ("tenant_id","name") WHERE "question_folders"."parent_id" is null;
CREATE UNIQUE INDEX IF NOT EXISTS "question_folders_tenant_topic_idx" ON "question_folders" USING btree ("tenant_id","topic_id") WHERE "question_folders"."topic_id" is not null;
```

**Si falta alguna de las dos cláusulas `WHERE`**, agregarlas a mano al SQL generado — sin ellas, dos raíces homónimas y dos carpetas para el mismo tema pasan sin ruido, y `folder_name_taken` deja de existir para raíces.

Aplicar la migración contra el Postgres local:

```bash
pnpm --filter @exams-generator/api db:migrate
```

- [ ] **Step 5: Escribir el test de feature que falla**

```ts
// apps/api/src/modules/bank/folders/bank-folders.e2e.spec.ts
import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { eq, inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../../app.module";
import { db, pool } from "../../../db/client";
import { runMigrations } from "../../../db/migrate";
import { courses, questionFolders, tenants, topics, users } from "../../../db/schema";
import { TokenService } from "../../auth/token.service";

/**
 * Full HTTP e2e — real Nest app, real Postgres. The folder tree is a
 * per-tenant structure seeded from the GLOBAL taxonomy, so the isolation this
 * exercises ("tenant B never sees A's folders") is the same release gate
 * `bank.e2e.spec.ts` covers for questions, one level up.
 */
describe("Bank folders (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;

  let courseColegioId: string;
  let coursePreId: string;
  let sharedNameTopic4Id: string;
  let sharedNameTopic5Id: string;
  let preTopicId: string;

  let tenantAId: string;
  let tenantBId: string;
  let teacherAId: string;
  let teacherBId: string;
  let staffUserId: string;

  let tokenA: string;
  let tokenB: string;
  let staffToken: string;

  const suffix = randomUUID();

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);

    const [colegioCourse] = await db
      .insert(courses)
      .values({ name: `ZZ Folders Colegio ${suffix}`, stage: "colegio" })
      .returning({ id: courses.id });
    courseColegioId = colegioCourse!.id;

    const [preCourse] = await db
      .insert(courses)
      .values({ name: `ZZ Folders Pre ${suffix}`, stage: "preuniversitario" })
      .returning({ id: courses.id });
    coursePreId = preCourse!.id;

    // Two topics of the SAME course sharing a name, differing only in grade —
    // the exact case the grade suffix exists for.
    const [t4] = await db
      .insert(topics)
      .values({ courseId: courseColegioId, name: `Trigo ${suffix}`, gradeLevel: "secundaria_4" })
      .returning({ id: topics.id });
    sharedNameTopic4Id = t4!.id;

    const [t5] = await db
      .insert(topics)
      .values({ courseId: courseColegioId, name: `Trigo ${suffix}`, gradeLevel: "secundaria_5" })
      .returning({ id: topics.id });
    sharedNameTopic5Id = t5!.id;

    const [tPre] = await db
      .insert(topics)
      .values({ courseId: coursePreId, name: `Arco ${suffix}` })
      .returning({ id: topics.id });
    preTopicId = tPre!.id;

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `Folders A ${suffix}`, slug: `folders-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `Folders B ${suffix}`, slug: `folders-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `folders-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherAId = teacherA!.id;

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `folders-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    teacherBId = teacherB!.id;

    const [staff] = await db
      .insert(users)
      .values({
        tenantId: null,
        email: `folders-staff-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.ContentEditor,
      })
      .returning({ id: users.id });
    staffUserId = staff!.id;

    tokenA = tokenService.sign({ sub: teacherAId, tenantId: tenantAId, role: Role.Teacher });
    tokenB = tokenService.sign({ sub: teacherBId, tenantId: tenantBId, role: Role.Teacher });
    staffToken = tokenService.sign({ sub: staffUserId, tenantId: null, role: Role.ContentEditor });
  });

  afterAll(async () => {
    const cleanupSteps: Array<[string, () => Promise<unknown>]> = [
      // Folders cascade off the tenants below, but deleting them explicitly
      // keeps the failure readable if a FK ever changes.
      [
        "delete folders",
        () => db.delete(questionFolders).where(inArray(questionFolders.tenantId, [tenantAId, tenantBId])),
      ],
      ["delete users", () => db.delete(users).where(inArray(users.id, [teacherAId, teacherBId, staffUserId]))],
      ["delete tenants", () => db.delete(tenants).where(inArray(tenants.id, [tenantAId, tenantBId]))],
      [
        "delete topics",
        () => db.delete(topics).where(inArray(topics.id, [sharedNameTopic4Id, sharedNameTopic5Id, preTopicId])),
      ],
      ["delete courses", () => db.delete(courses).where(inArray(courses.id, [courseColegioId, coursePreId]))],
      ["close app", () => app.close()],
    ];
    for (const [label, step] of cleanupSteps) {
      try {
        await step();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[afterAll cleanup] "${label}" failed, continuing with remaining steps:`, err);
      }
    }
    await pool.end();
  });

  function foldersRequest(token: string) {
    return request(app.getHttpServer()).get("/bank/folders").set("Authorization", `Bearer ${token}`);
  }

  /** Flattens the nested response so a test can assert on one node without walking children by hand. */
  function flatten(nodes: readonly any[]): any[] {
    return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
  }

  it("seeds the default tree on the tenant's FIRST call: a root per stage, a folder per course, a folder per topic", async () => {
    const response = await foldersRequest(tokenA).expect(200);
    const all = flatten(response.body.folders);

    // Roots the fixture guarantees exist (the real catalog may add more).
    const roots = response.body.folders.map((node: any) => node.name);
    expect(roots).toEqual(expect.arrayContaining(["Colegio", "Preuniversitario"]));

    const courseFolder = all.find((node) => node.name === `ZZ Folders Colegio ${suffix}`);
    expect(courseFolder).toBeDefined();
    expect(courseFolder.topicId).toBeNull();

    const topicFolders = all.filter((node) => node.parentId === courseFolder.id);
    expect(topicFolders.map((node) => node.name).sort()).toEqual([
      `Trigo ${suffix} · 4° secundaria`,
      `Trigo ${suffix} · 5° secundaria`,
    ]);
    expect(topicFolders.map((node) => node.topicId).sort()).toEqual(
      [sharedNameTopic4Id, sharedNameTopic5Id].sort(),
    );

    // A topic whose name is unique in its course keeps its bare name.
    expect(all.find((node) => node.topicId === preTopicId).name).toBe(`Arco ${suffix}`);
  });

  it("does not re-seed on a second call — folders_seeded_at is the marker, not 'has rows'", async () => {
    const first = await foldersRequest(tokenA).expect(200);
    const before = flatten(first.body.folders).length;

    const [row] = await db
      .select({ seededAt: tenants.foldersSeededAt })
      .from(tenants)
      .where(eq(tenants.id, tenantAId));
    expect(row!.seededAt).not.toBeNull();

    // Emptying the cabinet on purpose must NOT bring the default set back.
    await db.delete(questionFolders).where(eq(questionFolders.tenantId, tenantAId));
    const second = await foldersRequest(tokenA).expect(200);

    expect(before).toBeGreaterThan(0);
    expect(second.body.folders).toEqual([]);
  });

  it("keeps tenants isolated — B's tree is its own, and B seeds independently", async () => {
    const responseB = await foldersRequest(tokenB).expect(200);
    const idsB = flatten(responseB.body.folders).map((node: any) => node.id);

    const rowsA = await db
      .select({ id: questionFolders.id })
      .from(questionFolders)
      .where(eq(questionFolders.tenantId, tenantAId));

    expect(idsB.length).toBeGreaterThan(0);
    for (const rowA of rowsA) {
      expect(idsB).not.toContain(rowA.id);
    }
  });

  it("returns unfiledCount and per-folder counts, both zero for a bank with no questions here", async () => {
    const response = await foldersRequest(tokenB).expect(200);
    const node = flatten(response.body.folders)[0];

    expect(response.body).toHaveProperty("unfiledCount", 0);
    expect(node).toMatchObject({ ownCount: 0, centralCount: 0 });
  });

  it("rejects a user with no tenant with 403 tenant_required", async () => {
    const response = await foldersRequest(staffToken).expect(403);
    expect(response.body).toMatchObject({ code: "tenant_required" });
  });

  it("rejects an unauthenticated request with 401", async () => {
    await request(app.getHttpServer()).get("/bank/folders").expect(401);
  });
});
```

- [ ] **Step 6: Correr el test y verificar que falla**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts`
Expected: FAIL — todos los `GET /bank/folders` devuelven 404 (la ruta no existe todavía). El primer test rompe en `expect(200)` con "expected 200 got 404".

- [ ] **Step 7: Implementar errores, repositorio, servicio, controlador y registro en el módulo**

```ts
// apps/api/src/modules/bank/folders/bank-folders.errors.ts
import { BankFolderErrorCode } from "@exams-generator/shared";
import { HttpException, HttpStatus } from "@nestjs/common";

/**
 * HTTP status + Spanish message per folder error code. Same body shape
 * `ai.controller.ts` uses for `ai_not_configured` — `{ statusCode, code,
 * message }` — because a STABLE code is what lets the web react differently
 * per failure (mark the inline input red vs. reload the tree) instead of
 * string-matching a message.
 *
 * `folder_not_found` is 404 even when the folder exists but belongs to another
 * tenant: same reasoning as `BankService.getQuestionById`, an id must not be
 * usable to probe another school's structure.
 */
const ERROR_SPEC: Readonly<Record<BankFolderErrorCode, { status: HttpStatus; message: string }>> = {
  folder_name_invalid: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "El nombre de la carpeta debe tener entre 1 y 80 caracteres.",
  },
  folder_name_taken: {
    status: HttpStatus.CONFLICT,
    message: "Ya existe una carpeta con ese nombre en el mismo nivel.",
  },
  folder_cycle: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "No puedes mover una carpeta dentro de sí misma.",
  },
  folder_depth_exceeded: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "Las carpetas admiten como máximo 6 niveles.",
  },
  folder_not_found: { status: HttpStatus.NOT_FOUND, message: "La carpeta no existe." },
  tenant_required: {
    status: HttpStatus.FORBIDDEN,
    message: "Las carpetas son de cada colegio; tu usuario no pertenece a uno.",
  },
  central_question_has_no_folder: {
    status: HttpStatus.UNPROCESSABLE_ENTITY,
    message: "Las preguntas del banco central no se guardan en carpetas de un colegio.",
  },
};

export function bankFolderError(code: BankFolderErrorCode): HttpException {
  const { status, message } = ERROR_SPEC[code];
  return new HttpException({ statusCode: status, code, message }, status);
}
```

```ts
// apps/api/src/modules/bank/folders/bank-folders.repository.ts
import { Inject, Injectable } from "@nestjs/common";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";
import { Database, DRIZZLE_DB } from "../../../db/client";
import { courses, questionFolders, questions, tenants, topics } from "../../../db/schema";
import { FlatFolderRow } from "./domain/assemble-folder-tree";
import { SeedCourseRow, SeedFolderPlanNode, SeedTopicRow } from "./domain/build-seed-folder-plan";

@Injectable()
export class BankFoldersRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: Database) {}

  async listFolders(tenantId: string): Promise<FlatFolderRow[]> {
    return this.db
      .select({
        id: questionFolders.id,
        name: questionFolders.name,
        parentId: questionFolders.parentId,
        topicId: questionFolders.topicId,
        position: questionFolders.position,
      })
      .from(questionFolders)
      .where(eq(questionFolders.tenantId, tenantId));
  }

  /** The whole global taxonomy the seed plan is built from. Two flat reads, no join. */
  async loadSeedSource(): Promise<{ courses: SeedCourseRow[]; topics: SeedTopicRow[] }> {
    const [courseRows, topicRows] = await Promise.all([
      this.db.select({ id: courses.id, name: courses.name, stage: courses.stage }).from(courses),
      this.db
        .select({
          id: topics.id,
          courseId: topics.courseId,
          name: topics.name,
          gradeLevel: topics.gradeLevel,
        })
        .from(topics),
    ]);
    return { courses: courseRows, topics: topicRows };
  }

  /**
   * Seeds the tenant's default folder set, exactly once, ever.
   *
   * The whole thing runs inside ONE transaction that opens with
   * `SELECT … FOR UPDATE` on the tenant row: two browser tabs hitting
   * `GET /bank/folders` at the same moment both reach here, and the row lock is
   * what makes the second one WAIT for the first to commit and then read a
   * non-null `folders_seeded_at` — instead of both inserting the plan and the
   * unique indexes turning a race into a 500.
   */
  async seedIfNeeded(tenantId: string, plan: readonly SeedFolderPlanNode[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ seededAt: tenants.foldersSeededAt })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .for("update");

      if (!locked || locked.seededAt !== null) {
        return;
      }

      const idByKey = new Map<string, string>();
      // Sequential on purpose: a child's `parent_id` is the id its parent just
      // returned, and `buildSeedFolderPlan` guarantees parents come first.
      for (const node of plan) {
        const [inserted] = await tx
          .insert(questionFolders)
          .values({
            tenantId,
            parentId: node.parentKey === null ? null : (idByKey.get(node.parentKey) ?? null),
            name: node.name,
            topicId: node.topicId,
            position: node.position,
          })
          .returning({ id: questionFolders.id });
        idByKey.set(node.key, inserted!.id);
      }

      await tx
        .update(tenants)
        .set({ foldersSeededAt: new Date() })
        .where(eq(tenants.id, tenantId));
    });
  }

  /** `folder_id -> count` over the tenant's OWN questions. One GROUP BY, never one query per folder. */
  async countOwnByFolder(tenantId: string): Promise<Map<string, number>> {
    const rows = await this.db
      .select({ folderId: questions.folderId, total: count() })
      .from(questions)
      .where(and(eq(questions.tenantId, tenantId), sql`${questions.folderId} is not null`))
      .groupBy(questions.folderId);

    return new Map(rows.map((row) => [row.folderId as string, Number(row.total)]));
  }

  /** `topic_id -> count` over CENTRAL questions only, restricted to the topics this tenant's folders link to. */
  async countCentralByTopic(topicIds: readonly string[]): Promise<Map<string, number>> {
    if (topicIds.length === 0) {
      return new Map();
    }
    const rows = await this.db
      .select({ topicId: questions.topicId, total: count() })
      .from(questions)
      .where(and(isNull(questions.tenantId), inArray(questions.topicId, [...topicIds])))
      .groupBy(questions.topicId);

    return new Map(rows.map((row) => [row.topicId, Number(row.total)]));
  }

  async countUnfiled(tenantId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(questions)
      .where(and(eq(questions.tenantId, tenantId), isNull(questions.folderId)));

    return Number(row?.total ?? 0);
  }
}
```

```ts
// apps/api/src/modules/bank/folders/bank-folders.service.ts
import { BankFoldersResponse } from "@exams-generator/shared";
import { Injectable } from "@nestjs/common";
import { AuthTokenPayload } from "../../auth/token.service";
import { BankFoldersRepository } from "./bank-folders.repository";
import { bankFolderError } from "./bank-folders.errors";
import { assembleFolderTree } from "./domain/assemble-folder-tree";
import { buildSeedFolderPlan } from "./domain/build-seed-folder-plan";

@Injectable()
export class BankFoldersService {
  constructor(private readonly repository: BankFoldersRepository) {}

  /**
   * Every folder route needs a tenant: folders ARE the tenant's own structure,
   * so platform staff (`tenantId: null`) has nothing to read here. 403 with a
   * stable code rather than an empty tree, so the web can say why instead of
   * rendering a blank cabinet.
   */
  protected requireTenantId(user: AuthTokenPayload): string {
    if (!user.tenantId) {
      throw bankFolderError("tenant_required");
    }
    return user.tenantId;
  }

  /**
   * The tree, seeding on the way in when this tenant has never been seeded.
   * On-the-fly rather than at tenant creation: no job, no migration backfill,
   * and a tenant created before this feature existed gets its cabinet the
   * first time a teacher opens the bank.
   */
  async getTree(user: AuthTokenPayload): Promise<BankFoldersResponse> {
    const tenantId = this.requireTenantId(user);

    const source = await this.repository.loadSeedSource();
    await this.repository.seedIfNeeded(tenantId, buildSeedFolderPlan(source.courses, source.topics));

    const rows = await this.repository.listFolders(tenantId);
    const topicIds = rows.map((row) => row.topicId).filter((id): id is string => id !== null);

    const [ownCounts, centralCounts, unfiledCount] = await Promise.all([
      this.repository.countOwnByFolder(tenantId),
      this.repository.countCentralByTopic(topicIds),
      this.repository.countUnfiled(tenantId),
    ]);

    return { folders: assembleFolderTree(rows, ownCounts, centralCounts), unfiledCount };
  }
}
```

```ts
// apps/api/src/modules/bank/folders/bank-folders.controller.ts
import { BankFoldersResponse } from "@exams-generator/shared";
import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser } from "../../auth/current-user.decorator";
import { JwtAuthGuard } from "../../auth/jwt-auth.guard";
import { AuthTokenPayload } from "../../auth/token.service";
import { BankFoldersService } from "./bank-folders.service";

/**
 * A tenant's own folder tree over the bank. Separate controller from
 * `BankController` (which is mounted at `bank/questions`) so the route prefix
 * stays honest — same module, so guards and the questions repository are
 * shared, not duplicated.
 */
@Controller("bank/folders")
@UseGuards(JwtAuthGuard)
export class BankFoldersController {
  constructor(private readonly service: BankFoldersService) {}

  @Get()
  async getTree(@CurrentUser() user: AuthTokenPayload): Promise<BankFoldersResponse> {
    return this.service.getTree(user);
  }
}
```

En `apps/api/src/modules/bank/bank.module.ts`: importar los tres, agregar `BankFoldersController` a `controllers`, y `BankFoldersService` + `BankFoldersRepository` a `providers`. Exportar `BankFoldersService` (la Task 7 lo inyecta desde `BankService`):

```ts
@Module({
  controllers: [BankController, BankFoldersController],
  providers: [
    { provide: DRIZZLE_DB, useValue: db },
    BankService,
    BankRepository,
    BankFoldersService,
    BankFoldersRepository,
    { provide: STORAGE_PORT, useFactory: resolveStorageAdapter },
    { provide: PDF_COMPILER_PORT, useFactory: resolvePdfCompilerAdapter },
  ],
  exports: [BankRepository, BankFoldersService, PDF_COMPILER_PORT],
})
```

- [ ] **Step 8: Pedir permiso y correr el build de `shared`**

El typecheck del API lee `packages/shared/dist/index.d.ts`, así que `BankFolderNode` no existe para él hasta que se compile el paquete. **Preguntarle al usuario antes de correrlo** — es un build y la regla global los prohíbe sin aprobación explícita:

> "Necesito correr `pnpm --filter @exams-generator/shared build` para que el typecheck del API vea los DTOs nuevos de carpetas. ¿Lo corro?"

Con el sí:

```bash
pnpm --filter @exams-generator/shared build
```

- [ ] **Step 9: Correr el test y verificar que pasa**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts`
Expected: PASS — 6 tests.

- [ ] **Step 10: Correr el typecheck y los tests de dominio otra vez**

```bash
pnpm --filter @exams-generator/api typecheck
pnpm --filter @exams-generator/web typecheck
cd apps/api && pnpm exec jest --selectProjects non-e2e src/modules/bank/folders/domain/
```

Expected: sin errores; 4 suites, 27 tests en verde (incluido `assemble-folder-tree.spec.ts`, que ahora sí resuelve `BankFolderNode`).

- [ ] **Step 11: Formatear y commitear**

```bash
pnpm format
git add apps/api/src/db/schema apps/api/drizzle packages/shared/src \
        apps/api/src/modules/bank/folders apps/api/src/modules/bank/bank.module.ts
git commit -m "feat(api): add question_folders schema and GET /bank/folders with on-demand seeding"
```

---

### Task 3: `POST /bank/folders` — crear carpeta

**Files:**
- Modify: `apps/api/src/modules/bank/folders/bank-folders.repository.ts`
- Modify: `apps/api/src/modules/bank/folders/bank-folders.service.ts`
- Modify: `apps/api/src/modules/bank/folders/bank-folders.controller.ts`
- Test: `apps/api/src/modules/bank/folders/bank-folders.e2e.spec.ts` (agrega un `describe`)

**Interfaces:**
- Consumes: `validateFolderName` (Task 1), `MAX_FOLDER_DEPTH`/`checkFolderMove` (Task 1), `bankFolderError` (Task 2), `CreateBankFolderDto` (Task 2).
- Produces:
  ```ts
  // bank-folders.repository.ts
  findFolder(tenantId: string, id: string): Promise<FlatFolderRow | undefined>;
  folderDepth(tenantId: string, id: string): Promise<number>;               // 1 for a root
  nextPosition(tenantId: string, parentId: string | null): Promise<number>;
  insertFolder(row: { tenantId: string; parentId: string | null; name: string; position: number }): Promise<FlatFolderRow>;
  isUniqueViolation(error: unknown): boolean;                                // exported free function

  // bank-folders.service.ts
  create(user: AuthTokenPayload, dto: CreateBankFolderDto): Promise<BankFolderNode>;
  ```

- [ ] **Step 1: Escribir el test que falla**

Agregar al final de `bank-folders.e2e.spec.ts`, dentro del `describe` raíz, junto con este helper arriba (al lado de `foldersRequest`):

```ts
  function createFolderRequest(token: string) {
    return request(app.getHttpServer()).post("/bank/folders").set("Authorization", `Bearer ${token}`);
  }

  /** Ids created by a test, torn down in `afterAll` before the tenants go. */
  const createdFolderIds: string[] = [];

  async function makeFolder(token: string, body: Record<string, unknown>): Promise<any> {
    const response = await createFolderRequest(token).send(body).expect(201);
    createdFolderIds.push(response.body.id);
    return response.body;
  }
```

```ts
  describe("POST /bank/folders", () => {
    it("creates a root folder and returns the node, appended after existing roots", async () => {
      const folder = await makeFolder(tokenB, { name: "  Mis apuntes  " });

      expect(folder).toMatchObject({
        name: "Mis apuntes", // trimmed
        parentId: null,
        topicId: null,
        ownCount: 0,
        centralCount: 0,
        children: [],
      });
      expect(typeof folder.id).toBe("string");
    });

    it("creates a child under an existing folder", async () => {
      const parent = await makeFolder(tokenB, { name: `Padre ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: "Hija", parentId: parent.id });

      expect(child.parentId).toBe(parent.id);
    });

    it("rejects an empty name with 422 folder_name_invalid", async () => {
      const response = await createFolderRequest(tokenB).send({ name: "   " }).expect(422);
      expect(response.body).toMatchObject({ code: "folder_name_invalid" });
    });

    it("rejects a name longer than 80 characters with 422 folder_name_invalid", async () => {
      const response = await createFolderRequest(tokenB).send({ name: "a".repeat(81) }).expect(422);
      expect(response.body).toMatchObject({ code: "folder_name_invalid" });
    });

    it("rejects a duplicate name among siblings with 409 folder_name_taken", async () => {
      const name = `Repetida ${randomUUID()}`;
      await makeFolder(tokenB, { name });

      const response = await createFolderRequest(tokenB).send({ name }).expect(409);
      expect(response.body).toMatchObject({ code: "folder_name_taken" });
    });

    it("allows the same name under a DIFFERENT parent", async () => {
      const parent = await makeFolder(tokenB, { name: `Otro padre ${randomUUID()}` });
      const name = `Compartida ${randomUUID()}`;
      await makeFolder(tokenB, { name });

      const nested = await makeFolder(tokenB, { name, parentId: parent.id });
      expect(nested.name).toBe(name);
    });

    it("rejects a parent that belongs to another tenant with 404 folder_not_found", async () => {
      const parentOfB = await makeFolder(tokenB, { name: `Ajena ${randomUUID()}` });

      const response = await createFolderRequest(tokenA)
        .send({ name: "Intrusa", parentId: parentOfB.id })
        .expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("rejects a 7th level with 422 folder_depth_exceeded", async () => {
      let parentId: string | null = null;
      for (let level = 1; level <= 6; level += 1) {
        const node = await makeFolder(tokenB, { name: `N${level} ${randomUUID()}`, parentId });
        parentId = node.id;
      }

      const response = await createFolderRequest(tokenB)
        .send({ name: "N7", parentId })
        .expect(422);
      expect(response.body).toMatchObject({ code: "folder_depth_exceeded" });
    });

    it("rejects a user with no tenant with 403 tenant_required", async () => {
      const response = await createFolderRequest(staffToken).send({ name: "X" }).expect(403);
      expect(response.body).toMatchObject({ code: "tenant_required" });
    });
  });
```

Y agregar el paso de limpieza al PRINCIPIO de `cleanupSteps` en `afterAll` (antes de "delete folders", que ya cubre por tenant — este es explícito por si el tenant sobrevive a un fallo previo):

```ts
      [
        "delete created folders",
        async () => {
          if (createdFolderIds.length > 0) {
            await db.delete(questionFolders).where(inArray(questionFolders.id, createdFolderIds));
          }
        },
      ],
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts -t "POST /bank/folders"`
Expected: FAIL — 404 en cada `POST` ("expected 201 got 404"); la ruta no existe.

- [ ] **Step 3: Agregar los métodos al repositorio**

```ts
// apps/api/src/modules/bank/folders/bank-folders.repository.ts — añadir imports
import { asc, desc, max } from "drizzle-orm";

/**
 * Postgres `23505 unique_violation`. The sibling-name rule is enforced by two
 * unique indexes rather than a SELECT-then-INSERT, so the race between two tabs
 * creating "Álgebra" at the same instant ends in a clean 409 instead of two
 * folders with the same name. `pg` surfaces the code on the error object.
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505";
}
```

```ts
  // …dentro de BankFoldersRepository

  async findFolder(tenantId: string, id: string): Promise<FlatFolderRow | undefined> {
    const [row] = await this.db
      .select({
        id: questionFolders.id,
        name: questionFolders.name,
        parentId: questionFolders.parentId,
        topicId: questionFolders.topicId,
        position: questionFolders.position,
      })
      .from(questionFolders)
      .where(and(eq(questionFolders.id, id), eq(questionFolders.tenantId, tenantId)))
      .limit(1);

    return row;
  }

  /**
   * How deep a folder sits: 1 for a root, 2 for its child, and so on. Walks
   * UPWARD through `parent_id` with a recursive CTE — cheap (the cap is 6) and,
   * more importantly, scoped to the tenant at the anchor so a crafted id from
   * another school can never be walked.
   */
  async folderDepth(tenantId: string, id: string): Promise<number> {
    const result = await this.db.execute(sql`
      WITH RECURSIVE chain AS (
        SELECT id, parent_id, 1 AS depth
          FROM question_folders
         WHERE id = ${id} AND tenant_id = ${tenantId}
        UNION ALL
        SELECT f.id, f.parent_id, c.depth + 1
          FROM question_folders f
          JOIN chain c ON f.id = c.parent_id
      )
      SELECT COALESCE(MAX(depth), 0)::int AS depth FROM chain
    `);
    return Number((result.rows[0] as { depth: number } | undefined)?.depth ?? 0);
  }

  /** Next free `position` among the siblings of `parentId` — new folders go last. */
  async nextPosition(tenantId: string, parentId: string | null): Promise<number> {
    const [row] = await this.db
      .select({ highest: max(questionFolders.position) })
      .from(questionFolders)
      .where(
        and(
          eq(questionFolders.tenantId, tenantId),
          parentId === null
            ? isNull(questionFolders.parentId)
            : eq(questionFolders.parentId, parentId),
        ),
      );

    return row?.highest === null || row?.highest === undefined ? 0 : Number(row.highest) + 1;
  }

  async insertFolder(row: {
    tenantId: string;
    parentId: string | null;
    name: string;
    position: number;
  }): Promise<FlatFolderRow> {
    const [inserted] = await this.db
      .insert(questionFolders)
      .values(row)
      .returning({
        id: questionFolders.id,
        name: questionFolders.name,
        parentId: questionFolders.parentId,
        topicId: questionFolders.topicId,
        position: questionFolders.position,
      });

    return inserted!;
  }
```

- [ ] **Step 4: Agregar `create` al servicio**

```ts
// apps/api/src/modules/bank/folders/bank-folders.service.ts — añadir imports
import { BankFolderNode, CreateBankFolderDto } from "@exams-generator/shared";
import { isUniqueViolation } from "./bank-folders.repository";
import { checkFolderMove, MAX_FOLDER_DEPTH } from "./domain/check-folder-move";
import { validateFolderName } from "./domain/folder-name";
import { FlatFolderRow } from "./domain/assemble-folder-tree";
```

```ts
  /**
   * A freshly created/renamed folder as the wire shape. Counts are always zero
   * for a NEW folder and the children array empty; a rename returns the node
   * with its stored counts refreshed by the caller's next `GET /bank/folders`,
   * which the web issues anyway after an optimistic update settles.
   */
  private toNode(row: FlatFolderRow, ownCount = 0, centralCount = 0): BankFolderNode {
    return {
      id: row.id,
      name: row.name,
      parentId: row.parentId,
      topicId: row.topicId,
      position: row.position,
      ownCount,
      centralCount,
      children: [],
    };
  }

  async create(user: AuthTokenPayload, dto: CreateBankFolderDto): Promise<BankFolderNode> {
    const tenantId = this.requireTenantId(user);

    const validated = validateFolderName(dto.name);
    if (!validated.ok) {
      throw bankFolderError(validated.code);
    }

    const parentId = dto.parentId ?? null;
    if (parentId !== null) {
      const parent = await this.repository.findFolder(tenantId, parentId);
      if (!parent) {
        // Another tenant's folder is indistinguishable from a missing one.
        throw bankFolderError("folder_not_found");
      }
      const parentDepth = await this.repository.folderDepth(tenantId, parentId);
      // A brand-new folder is a leaf, so its subtree is exactly 1 level tall.
      const move = checkFolderMove({
        folderId: "new",
        targetParentId: parentId,
        descendantIds: [],
        targetParentDepth: parentDepth,
        subtreeHeight: 1,
      });
      if (!move.ok) {
        throw bankFolderError(move.code);
      }
    }

    const position = await this.repository.nextPosition(tenantId, parentId);

    try {
      const row = await this.repository.insertFolder({
        tenantId,
        parentId,
        name: validated.name,
        position,
      });
      return this.toNode(row);
    } catch (error) {
      // The unique indexes are the sibling-name rule; a SELECT-then-INSERT would
      // just be a slower way to lose the same race.
      if (isUniqueViolation(error)) {
        throw bankFolderError("folder_name_taken");
      }
      throw error;
    }
  }
```

`MAX_FOLDER_DEPTH` queda importado para el docstring/test de contrato; si el linter se queja de import sin uso, borrarlo — la profundidad la aplica `checkFolderMove`.

- [ ] **Step 5: Agregar la ruta al controlador**

```ts
// apps/api/src/modules/bank/folders/bank-folders.controller.ts
import { BankFolderNode, BankFoldersResponse, CreateBankFolderDto } from "@exams-generator/shared";
import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
```

```ts
  /**
   * `name` and `parentId` are read off the raw body and validated in the
   * service, NOT by a DTO class: the invalid-name case has to answer 422 with
   * `code: "folder_name_invalid"`, and a `ValidationPipe` would answer 400 with
   * its own message shape.
   */
  @Post()
  async create(
    @CurrentUser() user: AuthTokenPayload,
    @Body() body: CreateBankFolderDto,
  ): Promise<BankFolderNode> {
    return this.service.create(user, { name: body?.name, parentId: body?.parentId ?? null });
  }
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts`
Expected: PASS — 15 tests (6 de la Task 2 + 9 nuevos).

- [ ] **Step 7: Formatear y commitear**

```bash
pnpm format
pnpm --filter @exams-generator/api typecheck
git add apps/api/src/modules/bank/folders
git commit -m "feat(api): add POST /bank/folders with name, sibling and depth rules"
```

---

### Task 4: `PATCH /bank/folders/:id` — renombrar y mover

**Files:**
- Modify: `apps/api/src/modules/bank/folders/bank-folders.repository.ts`
- Modify: `apps/api/src/modules/bank/folders/bank-folders.service.ts`
- Modify: `apps/api/src/modules/bank/folders/bank-folders.controller.ts`
- Test: `apps/api/src/modules/bank/folders/bank-folders.e2e.spec.ts`

**Interfaces:**
- Consumes: `findFolder`, `folderDepth`, `nextPosition`, `isUniqueViolation` (Task 3); `checkFolderMove`, `validateFolderName` (Task 1).
- Produces:
  ```ts
  // bank-folders.repository.ts
  loadSubtree(tenantId: string, rootId: string): Promise<{ ids: string[]; height: number }>;
  updateFolder(tenantId: string, id: string, patch: { name?: string; parentId?: string | null; position?: number }): Promise<FlatFolderRow | undefined>;

  // bank-folders.service.ts
  update(user: AuthTokenPayload, id: string, dto: UpdateBankFolderDto): Promise<BankFolderNode>;
  ```

- [ ] **Step 1: Escribir el test que falla**

Helper junto a los otros:

```ts
  function patchFolderRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .patch(`/bank/folders/${id}`)
      .set("Authorization", `Bearer ${token}`);
  }
```

```ts
  describe("PATCH /bank/folders/:id", () => {
    it("renames a folder", async () => {
      const folder = await makeFolder(tokenB, { name: `Antes ${randomUUID()}` });
      const renamed = `Después ${randomUUID()}`;

      const response = await patchFolderRequest(tokenB, folder.id).send({ name: renamed }).expect(200);
      expect(response.body).toMatchObject({ id: folder.id, name: renamed, parentId: null });
    });

    it("moves a folder under another parent", async () => {
      const parent = await makeFolder(tokenB, { name: `Destino ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: `Viajera ${randomUUID()}` });

      const response = await patchFolderRequest(tokenB, child.id)
        .send({ parentId: parent.id })
        .expect(200);
      expect(response.body.parentId).toBe(parent.id);
    });

    it("moves a folder back to the root with parentId: null", async () => {
      const parent = await makeFolder(tokenB, { name: `Origen ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: `Hija ${randomUUID()}`, parentId: parent.id });

      const response = await patchFolderRequest(tokenB, child.id).send({ parentId: null }).expect(200);
      expect(response.body.parentId).toBeNull();
    });

    it("renames and moves in one request", async () => {
      const parent = await makeFolder(tokenB, { name: `Combo padre ${randomUUID()}` });
      const folder = await makeFolder(tokenB, { name: `Combo ${randomUUID()}` });
      const newName = `Combo nuevo ${randomUUID()}`;

      const response = await patchFolderRequest(tokenB, folder.id)
        .send({ name: newName, parentId: parent.id })
        .expect(200);
      expect(response.body).toMatchObject({ name: newName, parentId: parent.id });
    });

    it("rejects moving a folder into itself with 422 folder_cycle", async () => {
      const folder = await makeFolder(tokenB, { name: `Autoref ${randomUUID()}` });

      const response = await patchFolderRequest(tokenB, folder.id)
        .send({ parentId: folder.id })
        .expect(422);
      expect(response.body).toMatchObject({ code: "folder_cycle" });
    });

    it("rejects moving a folder into its own descendant with 422 folder_cycle", async () => {
      const root = await makeFolder(tokenB, { name: `Abuela ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: `Madre ${randomUUID()}`, parentId: root.id });
      const grandchild = await makeFolder(tokenB, { name: `Nieta ${randomUUID()}`, parentId: child.id });

      const response = await patchFolderRequest(tokenB, root.id)
        .send({ parentId: grandchild.id })
        .expect(422);
      expect(response.body).toMatchObject({ code: "folder_cycle" });
    });

    it("rejects a move whose SUBTREE would pass level 6 with 422 folder_depth_exceeded", async () => {
      // A 3-level subtree…
      const a = await makeFolder(tokenB, { name: `A ${randomUUID()}` });
      const b = await makeFolder(tokenB, { name: `B ${randomUUID()}`, parentId: a.id });
      await makeFolder(tokenB, { name: `C ${randomUUID()}`, parentId: b.id });

      // …dropped under a parent at level 4 would put its deepest leaf at 7.
      let parentId: string | null = null;
      for (let level = 1; level <= 4; level += 1) {
        const node = await makeFolder(tokenB, { name: `D${level} ${randomUUID()}`, parentId });
        parentId = node.id;
      }

      const response = await patchFolderRequest(tokenB, a.id).send({ parentId }).expect(422);
      expect(response.body).toMatchObject({ code: "folder_depth_exceeded" });
    });

    it("rejects a rename that collides with a sibling with 409 folder_name_taken", async () => {
      const taken = `Ocupado ${randomUUID()}`;
      await makeFolder(tokenB, { name: taken });
      const other = await makeFolder(tokenB, { name: `Libre ${randomUUID()}` });

      const response = await patchFolderRequest(tokenB, other.id).send({ name: taken }).expect(409);
      expect(response.body).toMatchObject({ code: "folder_name_taken" });
    });

    it("rejects an invalid name with 422 folder_name_invalid", async () => {
      const folder = await makeFolder(tokenB, { name: `Válida ${randomUUID()}` });

      const response = await patchFolderRequest(tokenB, folder.id).send({ name: "" }).expect(422);
      expect(response.body).toMatchObject({ code: "folder_name_invalid" });
    });

    it("rejects another tenant's folder with 404 folder_not_found", async () => {
      const folderOfB = await makeFolder(tokenB, { name: `Suya ${randomUUID()}` });

      const response = await patchFolderRequest(tokenA, folderOfB.id)
        .send({ name: "Robada" })
        .expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("rejects a target parent from another tenant with 404 folder_not_found", async () => {
      const folderOfB = await makeFolder(tokenB, { name: `Mía ${randomUUID()}` });
      const [folderOfA] = await db
        .insert(questionFolders)
        .values({ tenantId: tenantAId, parentId: null, name: `De A ${randomUUID()}`, position: 0 })
        .returning({ id: questionFolders.id });
      createdFolderIds.push(folderOfA!.id);

      const response = await patchFolderRequest(tokenB, folderOfB.id)
        .send({ parentId: folderOfA!.id })
        .expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts -t "PATCH /bank/folders"`
Expected: FAIL — 404 en cada PATCH; la ruta no existe.

- [ ] **Step 3: Agregar `loadSubtree` y `updateFolder` al repositorio**

```ts
  /**
   * Every id in the subtree rooted at `rootId` (including `rootId` itself), plus
   * how many levels tall that subtree is. One recursive CTE instead of N queries
   * — and it is what both the move rules and the delete flow walk.
   *
   * The anchor is tenant-scoped; the recursive half is not, and does not need to
   * be: `parent_id` never crosses tenants (a folder's parent is always in the
   * same cabinet), so reachability from a tenant-scoped anchor stays inside it.
   */
  async loadSubtree(tenantId: string, rootId: string): Promise<{ ids: string[]; height: number }> {
    const result = await this.db.execute(sql`
      WITH RECURSIVE subtree AS (
        SELECT id, 1 AS depth
          FROM question_folders
         WHERE id = ${rootId} AND tenant_id = ${tenantId}
        UNION ALL
        SELECT f.id, s.depth + 1
          FROM question_folders f
          JOIN subtree s ON f.parent_id = s.id
      )
      SELECT id, depth FROM subtree
    `);

    const rows = result.rows as { id: string; depth: number }[];
    return {
      ids: rows.map((row) => row.id),
      height: rows.reduce((tallest, row) => Math.max(tallest, Number(row.depth)), 0),
    };
  }

  async updateFolder(
    tenantId: string,
    id: string,
    patch: { name?: string; parentId?: string | null; position?: number },
  ): Promise<FlatFolderRow | undefined> {
    const [row] = await this.db
      .update(questionFolders)
      .set(patch)
      .where(and(eq(questionFolders.id, id), eq(questionFolders.tenantId, tenantId)))
      .returning({
        id: questionFolders.id,
        name: questionFolders.name,
        parentId: questionFolders.parentId,
        topicId: questionFolders.topicId,
        position: questionFolders.position,
      });

    return row;
  }
```

- [ ] **Step 4: Agregar `update` al servicio**

```ts
  /**
   * Rename, move, or both. `parentId` is only touched when the key is PRESENT in
   * the body — `undefined` means "leave it where it is", `null` means "make it a
   * root". That distinction is the whole reason the DTO's field is
   * `parentId?: string | null` and not just `string | null`.
   */
  async update(
    user: AuthTokenPayload,
    id: string,
    dto: UpdateBankFolderDto,
  ): Promise<BankFolderNode> {
    const tenantId = this.requireTenantId(user);

    const folder = await this.repository.findFolder(tenantId, id);
    if (!folder) {
      throw bankFolderError("folder_not_found");
    }

    const patch: { name?: string; parentId?: string | null; position?: number } = {};

    if (dto.name !== undefined) {
      const validated = validateFolderName(dto.name);
      if (!validated.ok) {
        throw bankFolderError(validated.code);
      }
      patch.name = validated.name;
    }

    const movingParent = Object.prototype.hasOwnProperty.call(dto, "parentId");
    if (movingParent) {
      const targetParentId = dto.parentId ?? null;

      if (targetParentId !== null) {
        const parent = await this.repository.findFolder(tenantId, targetParentId);
        if (!parent) {
          throw bankFolderError("folder_not_found");
        }
      }

      const subtree = await this.repository.loadSubtree(tenantId, id);
      const targetParentDepth =
        targetParentId === null ? 0 : await this.repository.folderDepth(tenantId, targetParentId);

      const move = checkFolderMove({
        folderId: id,
        targetParentId,
        descendantIds: subtree.ids,
        targetParentDepth,
        subtreeHeight: subtree.height,
      });
      if (!move.ok) {
        throw bankFolderError(move.code);
      }

      patch.parentId = targetParentId;
      // Landing among new siblings: go last, same rule `create` applies.
      patch.position = await this.repository.nextPosition(tenantId, targetParentId);
    }

    if (patch.name === undefined && !movingParent) {
      // Nothing asked for — hand the folder back unchanged rather than issue an
      // UPDATE with an empty SET (which Drizzle rejects at runtime).
      return this.toNode(folder);
    }

    try {
      const updated = await this.repository.updateFolder(tenantId, id, patch);
      if (!updated) {
        throw bankFolderError("folder_not_found");
      }
      return this.toNode(updated);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw bankFolderError("folder_name_taken");
      }
      throw error;
    }
  }
```

- [ ] **Step 5: Agregar la ruta al controlador**

```ts
import { Param, ParseUUIDPipe, Patch } from "@nestjs/common";
import { UpdateBankFolderDto } from "@exams-generator/shared";
```

```ts
  /**
   * Rename and/or move. `ParseUUIDPipe` on `:id` means a malformed id is a 400
   * before the service runs — a non-uuid can never be a folder of this tenant,
   * so there is nothing 404 would tell the caller that 400 does not.
   */
  @Patch(":id")
  async update(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: UpdateBankFolderDto,
  ): Promise<BankFolderNode> {
    return this.service.update(user, id, body ?? {});
  }
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts`
Expected: PASS — 26 tests.

- [ ] **Step 7: Formatear y commitear**

```bash
pnpm format
pnpm --filter @exams-generator/api typecheck
git add apps/api/src/modules/bank/folders
git commit -m "feat(api): add PATCH /bank/folders/:id with rename, move, cycle and depth rules"
```

---

### Task 5: `DELETE /bank/folders/:id` — borrar el subárbol sin borrar preguntas

La regla central del spec: **ninguna pregunta se borra del banco**. Las propias quedan `folder_id NULL`, las centrales ni se tocan.

**Files:**
- Modify: `apps/api/src/modules/bank/folders/bank-folders.repository.ts`
- Modify: `apps/api/src/modules/bank/folders/bank-folders.service.ts`
- Modify: `apps/api/src/modules/bank/folders/bank-folders.controller.ts`
- Test: `apps/api/src/modules/bank/folders/bank-folders.e2e.spec.ts`

**Interfaces:**
- Consumes: `loadSubtree` (Task 4), `findFolder` (Task 3).
- Produces:
  ```ts
  // bank-folders.repository.ts
  deleteSubtree(tenantId: string, rootId: string, subtreeIds: readonly string[]): Promise<number>; // unfiled questions
  // bank-folders.service.ts
  remove(user: AuthTokenPayload, id: string): Promise<DeleteBankFolderResponse>;
  ```

- [ ] **Step 1: Escribir el test que falla**

Primero, el andamiaje para meter preguntas reales en el fixture. Agregar cerca de los otros helpers del spec:

```ts
  const createdQuestionIds: string[] = [];

  /**
   * Inserts a question straight through Drizzle rather than through
   * `POST /bank/questions/structured`: this suite is about FOLDERS, and the
   * creation endpoint has its own taxonomy validation, dedup-by-hash and
   * MinIO round-trip that would only add noise here.
   */
  async function insertQuestion(input: {
    tenantId: string | null;
    topicId: string;
    folderId: string | null;
    createdBy: string;
  }): Promise<string> {
    const [row] = await db
      .insert(questions)
      .values({
        tenantId: input.tenantId,
        topicId: input.topicId,
        folderId: input.folderId,
        difficulty: Difficulty.Medium,
        gradeLevel: "secundaria_4",
        status: "approved",
        type: "structured",
        bodyTypst: `Enunciado ${randomUUID()}`,
        bodyHash: randomUUID(),
        alternatives: ["a", "b", "c", "d"],
        correctAnswer: "0",
        createdBy: input.createdBy,
      })
      .returning({ id: questions.id });

    createdQuestionIds.push(row!.id);
    return row!.id;
  }

  function deleteFolderRequest(token: string, id: string) {
    return request(app.getHttpServer())
      .delete(`/bank/folders/${id}`)
      .set("Authorization", `Bearer ${token}`);
  }
```

Agregar `Difficulty` al import de `@exams-generator/shared` y `questions` al import de `../../../db/schema`, y este paso PRIMERO en `cleanupSteps` (las preguntas tienen que irse antes que las carpetas y los temas):

```ts
      [
        "delete questions",
        async () => {
          if (createdQuestionIds.length > 0) {
            await db.delete(questions).where(inArray(questions.id, createdQuestionIds));
          }
        },
      ],
```

```ts
  describe("DELETE /bank/folders/:id", () => {
    it("deletes the whole subtree and unfiles the tenant's own questions, without deleting a single question", async () => {
      const root = await makeFolder(tokenB, { name: `Borrable ${randomUUID()}` });
      const child = await makeFolder(tokenB, { name: `Hija ${randomUUID()}`, parentId: root.id });

      const inRoot = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: root.id,
        createdBy: teacherBId,
      });
      const inChild = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: child.id,
        createdBy: teacherBId,
      });

      const response = await deleteFolderRequest(tokenB, root.id).expect(200);
      expect(response.body).toEqual({ deletedFolders: 2, unfiledQuestions: 2 });

      const rows = await db
        .select({ id: questions.id, folderId: questions.folderId })
        .from(questions)
        .where(inArray(questions.id, [inRoot, inChild]));

      expect(rows).toHaveLength(2);
      expect(rows.every((row) => row.folderId === null)).toBe(true);

      const remaining = await db
        .select({ id: questionFolders.id })
        .from(questionFolders)
        .where(inArray(questionFolders.id, [root.id, child.id]));
      expect(remaining).toEqual([]);
    });

    it("leaves CENTRAL questions completely untouched — they were never filed here", async () => {
      const topicFolders = await db
        .select({ id: questionFolders.id, topicId: questionFolders.topicId })
        .from(questionFolders)
        .where(eq(questionFolders.topicId, preTopicId));
      const seeded = topicFolders.find((row) => row.id !== undefined)!;

      const centralQuestionId = await insertQuestion({
        tenantId: null,
        topicId: preTopicId,
        folderId: null,
        createdBy: staffUserId,
      });

      const response = await deleteFolderRequest(tokenB, seeded.id).expect(200);
      expect(response.body.unfiledQuestions).toBe(0);

      const [central] = await db
        .select({ id: questions.id, topicId: questions.topicId, folderId: questions.folderId })
        .from(questions)
        .where(eq(questions.id, centralQuestionId));

      expect(central).toMatchObject({ topicId: preTopicId, folderId: null });
    });

    it("does not touch another tenant's folders", async () => {
      const [folderOfA] = await db
        .insert(questionFolders)
        .values({ tenantId: tenantAId, parentId: null, name: `Intacta ${randomUUID()}`, position: 0 })
        .returning({ id: questionFolders.id });
      createdFolderIds.push(folderOfA!.id);

      const mine = await makeFolder(tokenB, { name: `Propia ${randomUUID()}` });
      await deleteFolderRequest(tokenB, mine.id).expect(200);

      const [stillThere] = await db
        .select({ id: questionFolders.id })
        .from(questionFolders)
        .where(eq(questionFolders.id, folderOfA!.id));
      expect(stillThere).toBeDefined();
    });

    it("rejects another tenant's folder with 404 folder_not_found", async () => {
      const folderOfB = await makeFolder(tokenB, { name: `Ajena del A ${randomUUID()}` });

      const response = await deleteFolderRequest(tokenA, folderOfB.id).expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("rejects a second delete of the same folder with 404 — the two-tab case", async () => {
      const folder = await makeFolder(tokenB, { name: `Doble ${randomUUID()}` });
      await deleteFolderRequest(tokenB, folder.id).expect(200);

      const response = await deleteFolderRequest(tokenB, folder.id).expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts -t "DELETE /bank/folders"`
Expected: FAIL — 404 en cada DELETE; la ruta no existe.

- [ ] **Step 3: Agregar `deleteSubtree` al repositorio**

```ts
  /**
   * Unfiles then deletes, in ONE transaction. Order matters: the `folder_id` FK
   * is `ON DELETE SET NULL`, so Postgres would unfile the rows anyway — doing it
   * explicitly FIRST is what lets the response report `unfiledQuestions`, which
   * is the whole point of the post-delete banner ("12 preguntas quedaron en Sin
   * carpeta"). The DELETE then only names the subtree ROOT: the self-referencing
   * `ON DELETE CASCADE` removes the rest.
   */
  async deleteSubtree(
    tenantId: string,
    rootId: string,
    subtreeIds: readonly string[],
  ): Promise<number> {
    return this.db.transaction(async (tx) => {
      const unfiled = await tx
        .update(questions)
        .set({ folderId: null })
        .where(and(eq(questions.tenantId, tenantId), inArray(questions.folderId, [...subtreeIds])))
        .returning({ id: questions.id });

      await tx
        .delete(questionFolders)
        .where(and(eq(questionFolders.id, rootId), eq(questionFolders.tenantId, tenantId)));

      return unfiled.length;
    });
  }
```

- [ ] **Step 4: Agregar `remove` al servicio y la ruta**

```ts
  /**
   * Removes the folder and its whole subtree FROM THE TENANT'S TREE. It never
   * deletes a question: the tenant's own ones come back unfiled, and the central
   * ones were never filed here to begin with — they simply stop being reachable
   * through this branch. The returned counts are what the UI shows afterwards.
   */
  async remove(user: AuthTokenPayload, id: string): Promise<DeleteBankFolderResponse> {
    const tenantId = this.requireTenantId(user);

    const folder = await this.repository.findFolder(tenantId, id);
    if (!folder) {
      throw bankFolderError("folder_not_found");
    }

    const subtree = await this.repository.loadSubtree(tenantId, id);
    const unfiledQuestions = await this.repository.deleteSubtree(tenantId, id, subtree.ids);

    return { deletedFolders: subtree.ids.length, unfiledQuestions };
  }
```

```ts
// bank-folders.controller.ts
import { Delete } from "@nestjs/common";
import { DeleteBankFolderResponse } from "@exams-generator/shared";
```

```ts
  /** 200 with the counts, NOT 204: the UI's post-delete banner is built from this body. */
  @Delete(":id")
  async remove(
    @CurrentUser() user: AuthTokenPayload,
    @Param("id", ParseUUIDPipe) id: string,
  ): Promise<DeleteBankFolderResponse> {
    return this.service.remove(user, id);
  }
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts`
Expected: PASS — 31 tests.

- [ ] **Step 6: Formatear y commitear**

```bash
pnpm format
pnpm --filter @exams-generator/api typecheck
git add apps/api/src/modules/bank/folders
git commit -m "feat(api): add DELETE /bank/folders/:id unfiling questions instead of deleting them"
```

---

### Task 6: `GET /bank/questions?folderId=` — listar por carpeta, incluido `unfiled`

**Files:**
- Modify: `apps/api/src/modules/bank/domain/ports/bank-repository.port.ts`
- Modify: `apps/api/src/modules/bank/bank.repository.ts`
- Modify: `apps/api/src/modules/bank/bank.service.ts`
- Modify: `apps/api/src/modules/bank/bank.controller.ts`
- Test: `apps/api/src/modules/bank/folders/bank-folders.e2e.spec.ts`

**Interfaces:**
- Consumes: `BankFoldersService.resolveFolderScope` (nuevo aquí), `UNFILED_FOLDER_ID` (Task 2).
- Produces:
  ```ts
  // bank-repository.port.ts — QuestionListFilter gana dos campos
  readonly folderId?: string;
  readonly folderTopicId?: string | null;
  readonly unfiled?: boolean;

  // bank-folders.service.ts
  resolveFolderScope(user: AuthTokenPayload, raw: string): Promise<{ unfiled: true } | { unfiled: false; folderId: string; folderTopicId: string | null }>;
  ```

- [ ] **Step 1: Escribir el test que falla**

```ts
  describe("GET /bank/questions?folderId=", () => {
    function listRequest(token: string) {
      return request(app.getHttpServer()).get("/bank/questions").set("Authorization", `Bearer ${token}`);
    }

    it("mixes the folder's OWN questions with the CENTRAL ones of its topic", async () => {
      const [seeded] = await db
        .select({ id: questionFolders.id })
        .from(questionFolders)
        .where(
          and(eq(questionFolders.tenantId, tenantBId), eq(questionFolders.topicId, preTopicId)),
        );

      const own = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: seeded!.id,
        createdBy: teacherBId,
      });
      const central = await insertQuestion({
        tenantId: null,
        topicId: preTopicId,
        folderId: null,
        createdBy: staffUserId,
      });
      // Same tenant, same topic, but filed nowhere -> must NOT appear.
      const unrelated = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: null,
        createdBy: teacherBId,
      });

      const response = await listRequest(tokenB).query({ folderId: seeded!.id }).expect(200);
      const ids = response.body.map((row: any) => row.id);

      expect(ids).toEqual(expect.arrayContaining([own, central]));
      expect(ids).not.toContain(unrelated);
    });

    it("returns each row's folderId so the client can render where it lives", async () => {
      const folder = await makeFolder(tokenB, { name: `Con folderId ${randomUUID()}` });
      const own = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
      });

      const response = await listRequest(tokenB).query({ folderId: folder.id }).expect(200);
      expect(response.body.find((row: any) => row.id === own).folderId).toBe(folder.id);
    });

    it("folderId=unfiled returns ONLY the tenant's own questions with no folder — never central ones", async () => {
      const unfiled = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: null,
        createdBy: teacherBId,
      });
      const central = await insertQuestion({
        tenantId: null,
        topicId: preTopicId,
        folderId: null,
        createdBy: staffUserId,
      });

      const response = await listRequest(tokenB).query({ folderId: "unfiled" }).expect(200);
      const ids = response.body.map((row: any) => row.id);

      expect(ids).toContain(unfiled);
      expect(ids).not.toContain(central);
    });

    it("a folder with no topicId returns only its own questions", async () => {
      const folder = await makeFolder(tokenB, { name: `Sin tema ${randomUUID()}` });
      const own = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
      });
      const central = await insertQuestion({
        tenantId: null,
        topicId: preTopicId,
        folderId: null,
        createdBy: staffUserId,
      });

      const response = await listRequest(tokenB).query({ folderId: folder.id }).expect(200);
      const ids = response.body.map((row: any) => row.id);

      expect(ids).toEqual([own]);
      expect(ids).not.toContain(central);
    });

    it("rejects another tenant's folder with 404 folder_not_found", async () => {
      const folderOfB = await makeFolder(tokenB, { name: `Privada ${randomUUID()}` });

      const response = await listRequest(tokenA).query({ folderId: folderOfB.id }).expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("keeps working with pagination", async () => {
      const folder = await makeFolder(tokenB, { name: `Paginada ${randomUUID()}` });
      await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
      });

      const response = await listRequest(tokenB)
        .query({ folderId: folder.id, page: "1", pageSize: "10" })
        .expect(200);

      expect(response.body).toMatchObject({ total: 1 });
      expect(response.body.items).toHaveLength(1);
    });
  });
```

Agregar `and` al import de `drizzle-orm` en el spec.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts -t "GET /bank/questions"`
Expected: FAIL — el filtro se ignora, así que el primer test recibe también `unrelated` (`expect(ids).not.toContain(unrelated)` falla), y el de 404 recibe un 200.

- [ ] **Step 3: Extender `QuestionListFilter` y el WHERE compartido**

En `apps/api/src/modules/bank/domain/ports/bank-repository.port.ts`, dentro de `QuestionListFilter`:

```ts
  /**
   * Tenant folder scope (design doc "Listado de preguntas"). Resolved by the
   * service from the raw query param BEFORE it gets here — the repository never
   * looks a folder up, it just applies the condition.
   */
  readonly folderId?: string;
  /**
   * The `topic_id` of that folder, when it has one. Non-null is what pulls
   * CENTRAL-bank questions of the same topic into the folder's listing; they
   * have no `folder_id` of their own and never will.
   */
  readonly folderTopicId?: string | null;
  /** `?folderId=unfiled` — the tenant's OWN questions with no folder. Mutually exclusive with `folderId`. */
  readonly unfiled?: boolean;
```

Y en `apps/api/src/modules/bank/bank.repository.ts`, dentro de `buildQuestionListConditions`, justo después del bloque de `visibility` y antes de `if (filter.courseId)`:

```ts
  /**
   * "Sin carpeta" is the tenant's OWN unfiled questions only. Central rows all
   * have `folder_id IS NULL` (they can never carry one), so without the
   * `tenant_id = :current` half this bucket would swallow the entire 64k central
   * bank.
   */
  if (filter.unfiled) {
    conditions.push(
      and(
        filter.currentTenantId
          ? eq(questions.tenantId, filter.currentTenantId)
          : (isNull(questions.tenantId) as SQL),
        isNull(questions.folderId),
      ) as SQL,
    );
  } else if (filter.folderId) {
    /**
     * A folder shows two things at once: what the school filed INTO it, and the
     * central-bank questions of the topic it was seeded from. The second half is
     * an OR, not a second query, so paging and counting stay one statement.
     */
    conditions.push(
      (filter.folderTopicId
        ? or(
            eq(questions.folderId, filter.folderId),
            and(isNull(questions.tenantId), eq(questions.topicId, filter.folderTopicId)),
          )
        : eq(questions.folderId, filter.folderId)) as SQL,
    );
  }
```

En el mismo `bank.repository.ts`, agregar `folderId: questions.folderId` al objeto `selection` de `listQuestions`, y al `select` de `findQuestionById` (buscarlo con `rg -n "findQuestionById" -A 25 apps/api/src/modules/bank/bank.repository.ts` y añadir el campo a su lista de columnas), para que `BankQuestionDto.folderId` viaje en TODOS los reads.

- [ ] **Step 4: Resolver el scope en el servicio y pasarlo por el controlador**

En `bank-folders.service.ts`:

```ts
import { UNFILED_FOLDER_ID } from "@exams-generator/shared";

export type FolderScope =
  | { readonly unfiled: true }
  | { readonly unfiled: false; readonly folderId: string; readonly folderTopicId: string | null };
```

```ts
  /**
   * Turns the raw `?folderId=` value into the scope the questions repository
   * understands. `unfiled` is a sentinel, not an id; anything else must be a
   * folder of THIS tenant or the caller gets a 404 — the same
   * id-enumeration guard `BankService.getQuestionById` applies to questions.
   */
  async resolveFolderScope(user: AuthTokenPayload, raw: string): Promise<FolderScope> {
    const tenantId = this.requireTenantId(user);

    if (raw === UNFILED_FOLDER_ID) {
      return { unfiled: true };
    }

    const folder = await this.repository.findFolder(tenantId, raw);
    if (!folder) {
      throw bankFolderError("folder_not_found");
    }
    return { unfiled: false, folderId: folder.id, folderTopicId: folder.topicId };
  }
```

En `bank.service.ts`, inyectar `BankFoldersService` en el constructor y traducir el filtro. Añadir `folderId?: string` a `ListQuestionsQuery` (la interfaz que ya vive en ese archivo) y, al principio de `listQuestions`, resolver:

```ts
  /**
   * Folder scope is resolved HERE, not in the repository: it is a lookup plus an
   * authorization decision (404 for another tenant's folder), and the repository
   * layer only applies conditions.
   */
  private async resolveFolderFilter(
    user: AuthTokenPayload,
    folderId: string | undefined,
  ): Promise<{ folderId?: string; folderTopicId?: string | null; unfiled?: boolean }> {
    if (!folderId) {
      return {};
    }
    const scope = await this.folders.resolveFolderScope(user, folderId);
    return scope.unfiled
      ? { unfiled: true }
      : { folderId: scope.folderId, folderTopicId: scope.folderTopicId };
  }
```

…y en el cuerpo de `listQuestions`, antes de construir `filters`, hacer `const folderFilter = await this.resolveFolderFilter(user, query.folderId);` y esparcirlo dentro del objeto que se le pasa a `this.repository.listQuestions`.

En `bank.controller.ts`, agregar `readonly folderId?: string;` a `ListQuestionsQueryParams` y pasar `folderId: query.folderId` en el objeto `filters` de `listQuestions` (NO en `questionSummary`: `GET /bank/questions/summary` no cambia, lo siguen usando exam-builder y la IA).

**Ojo con el ciclo de dependencias:** `BankModule` provee `BankService` y `BankFoldersService`, y ahora el primero inyecta al segundo. `BankFoldersService` NO inyecta `BankService`, así que no hay ciclo — verificarlo con `rg -n "BankService" apps/api/src/modules/bank/folders/` antes de correr los tests (debe devolver cero líneas).

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts`
Expected: PASS — 37 tests.

- [ ] **Step 6: Correr la e2e vecina que este cambio toca**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/bank.e2e.spec.ts`
Expected: PASS, o el MISMO conjunto de fallos que ya tenía en el commit base (verificarlo con `git stash` si hay dudas). El WHERE compartido cambió: si aparece un fallo nuevo en el listado o el resumen, es de este cambio.

- [ ] **Step 7: Formatear y commitear**

```bash
pnpm format
pnpm --filter @exams-generator/api typecheck
git add apps/api/src/modules/bank
git commit -m "feat(api): filter GET /bank/questions by folderId, including the unfiled bucket"
```

---

### Task 7: `folderId` en la creación y en `PATCH /bank/questions/:id`

Última tarea del API. Con esto el backend queda usable de punta a punta: sembrar, navegar, crear, mover, borrar y archivar preguntas en carpetas.

**Files:**
- Modify: `apps/api/src/modules/bank/folders/bank-folders.service.ts`
- Modify: `apps/api/src/modules/bank/bank.service.ts`
- Modify: `apps/api/src/modules/bank/bank.controller.ts`
- Modify: `apps/api/src/modules/bank/bank.repository.ts`
- Modify: `apps/api/src/modules/bank/domain/ports/bank-repository.port.ts`
- Test: `apps/api/src/modules/bank/folders/bank-folders.e2e.spec.ts`

**Interfaces:**
- Consumes: `findFolder` (Task 3), `bankFolderError` (Task 2), `requireManageableQuestion` (ya existe en `bank.service.ts:358`).
- Produces:
  ```ts
  // bank-folders.service.ts
  assertAssignableFolder(user: AuthTokenPayload, questionTenantId: string | null, folderId: string | null): Promise<void>;
  // bank-repository.port.ts
  CreateImageQuestionRecord.folderId?: string | null;
  CreateStructuredQuestionRecord.folderId?: string | null;
  // bank.repository.ts
  setQuestionFolder(id: string, tenantId: string | null, folderId: string | null): Promise<QuestionListItem | undefined>;
  ```

- [ ] **Step 1: Escribir el test que falla**

```ts
  describe("folderId on question write paths", () => {
    function structuredRequest(token: string) {
      return request(app.getHttpServer())
        .post("/bank/questions/structured")
        .set("Authorization", `Bearer ${token}`);
    }

    function patchQuestionRequest(token: string, id: string) {
      return request(app.getHttpServer())
        .patch(`/bank/questions/${id}`)
        .set("Authorization", `Bearer ${token}`);
    }

    it("POST /bank/questions/structured stores the folderId", async () => {
      const folder = await makeFolder(tokenB, { name: `Destino nuevo ${randomUUID()}` });

      const created = await structuredRequest(tokenB)
        .send({
          courseId: coursePreId,
          topicId: preTopicId,
          difficulty: "medium",
          gradeLevel: "secundaria_4",
          bodyTypst: `Enunciado ${randomUUID()}`,
          alternatives: ["a", "b", "c", "d"],
          correctAnswer: "0",
          folderId: folder.id,
        })
        .expect(201);
      createdQuestionIds.push(created.body.id);

      const [row] = await db
        .select({ folderId: questions.folderId })
        .from(questions)
        .where(eq(questions.id, created.body.id));
      expect(row!.folderId).toBe(folder.id);
    });

    it("PATCH /bank/questions/:id moves a question into a folder", async () => {
      const folder = await makeFolder(tokenB, { name: `Mudanza ${randomUUID()}` });
      const questionId = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: null,
        createdBy: teacherBId,
      });

      const response = await patchQuestionRequest(tokenB, questionId)
        .send({ folderId: folder.id })
        .expect(200);
      expect(response.body.folderId).toBe(folder.id);
    });

    it("PATCH with folderId: null unfiles a question", async () => {
      const folder = await makeFolder(tokenB, { name: `Salida ${randomUUID()}` });
      const questionId = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
      });

      const response = await patchQuestionRequest(tokenB, questionId)
        .send({ folderId: null })
        .expect(200);
      expect(response.body.folderId).toBeNull();
    });

    it("rejects a folder from another tenant with 404 folder_not_found", async () => {
      const folderOfB = await makeFolder(tokenB, { name: `De B ${randomUUID()}` });
      const questionOfA = await insertQuestion({
        tenantId: tenantAId,
        topicId: preTopicId,
        folderId: null,
        createdBy: teacherAId,
      });

      const response = await patchQuestionRequest(tokenA, questionOfA)
        .send({ folderId: folderOfB.id })
        .expect(404);
      expect(response.body).toMatchObject({ code: "folder_not_found" });
    });

    it("rejects filing a CENTRAL question with 422 central_question_has_no_folder", async () => {
      const centralQuestionId = await insertQuestion({
        tenantId: null,
        topicId: preTopicId,
        folderId: null,
        createdBy: staffUserId,
      });

      const response = await patchQuestionRequest(staffToken, centralQuestionId)
        .send({ folderId: randomUUID() })
        .expect(422);
      expect(response.body).toMatchObject({ code: "central_question_has_no_folder" });
    });

    it("leaves folderId alone when the PATCH body does not mention it", async () => {
      const folder = await makeFolder(tokenB, { name: `Estable ${randomUUID()}` });
      const questionId = await insertQuestion({
        tenantId: tenantBId,
        topicId: preTopicId,
        folderId: folder.id,
        createdBy: teacherBId,
      });

      const response = await patchQuestionRequest(tokenB, questionId)
        .send({ difficulty: "hard" })
        .expect(200);
      expect(response.body.folderId).toBe(folder.id);
    });
  });
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts -t "folderId on question write paths"`
Expected: FAIL — el primer test lee `folderId: null` en la fila creada (el body se ignora); el de 404 recibe 200.

- [ ] **Step 3: Agregar el guard de asignación al servicio de carpetas**

```ts
  /**
   * The two rules that gate putting a question INTO a folder.
   *
   * 1. A central-bank question (`tenantId === null`) can never carry one:
   *    folders are per-tenant, the central bank is shared, and a shared row
   *    pointing at one school's cabinet is meaningless. 422, because the
   *    request is well-formed and the caller may well be allowed to edit the
   *    question — it is the COMBINATION that is impossible.
   * 2. The folder must belong to the caller's tenant. 404, not 403: a folder id
   *    must not be usable to probe another school's structure.
   */
  async assertAssignableFolder(
    user: AuthTokenPayload,
    questionTenantId: string | null,
    folderId: string | null,
  ): Promise<void> {
    if (folderId === null) {
      return;
    }
    if (questionTenantId === null) {
      throw bankFolderError("central_question_has_no_folder");
    }
    const tenantId = this.requireTenantId(user);
    const folder = await this.repository.findFolder(tenantId, folderId);
    if (!folder) {
      throw bankFolderError("folder_not_found");
    }
  }
```

- [ ] **Step 4: Aceptar `folderId` en las dos rutas de creación**

En `bank-repository.port.ts`, agregar a `CreateImageQuestionRecord` y a `CreateStructuredQuestionRecord`:

```ts
  /** Tenant folder this question is filed under, or `null`/absent for unfiled. Never set on a central question. */
  readonly folderId?: string | null;
```

En `bank.repository.ts`, incluir `folderId: record.folderId ?? null` en los `.values({...})` de `createImageQuestion` y `createStructuredQuestion`.

En `bank.service.ts`:
- agregar `readonly folderId?: string | null;` a `CreateImageQuestionDto` y a `CreateStructuredQuestionDto`;
- en `createImageQuestion` y en `createStructuredQuestion`, justo después de `assertCanManageTenant(user.role, user.tenantId)`:

```ts
    await this.folders.assertAssignableFolder(user, user.tenantId, dto.folderId ?? null);
```

- y pasar `folderId: dto.folderId ?? null` al `this.repository.create*` correspondiente.

En `bank.controller.ts`, agregar `readonly folderId?: string;` a `CreateImageQuestionBody` y a `CreateStructuredQuestionBody`, y reenviarlo en los dos `this.service.create*`. En la ruta multipart (`POST image`) el valor llega como string; `''` (campo vacío) debe tratarse como ausente:

```ts
      folderId: body.folderId?.trim() ? body.folderId.trim() : null,
```

- [ ] **Step 5: Aceptar `folderId` en `PATCH /bank/questions/:id`**

En `bank.repository.ts`:

```ts
  /**
   * Files/unfiles a question, tenant-scoped. Separate from
   * `updateStructuredQuestionAndTaxonomy` on purpose: filing applies to BOTH
   * question types (image and structured), while that method is the structured
   * content path and has a Typst compile in front of it.
   */
  async setQuestionFolder(
    id: string,
    tenantId: string | null,
    folderId: string | null,
  ): Promise<QuestionListItem | undefined> {
    const visibility = tenantId
      ? (or(isNull(questions.tenantId), eq(questions.tenantId, tenantId)) as SQL)
      : (isNull(questions.tenantId) as SQL);

    const [row] = await this.db
      .update(questions)
      .set({ folderId })
      .where(and(eq(questions.id, id), visibility))
      .returning({ id: questions.id });

    if (!row) {
      return undefined;
    }
    return this.findQuestionById(id, tenantId);
  }
```

En `bank.service.ts`, `EditQuestionDto` gana `readonly folderId?: string | null;`, y `editQuestion` aplica el cambio de carpeta ANTES de ramificar por tipo — así el guard de tenant/central corre una sola vez y vale para preguntas `image` y `structured`:

```ts
  async editQuestion(user: AuthTokenPayload, id: string, dto: EditQuestionDto): Promise<QuestionListItem> {
    const question = await this.requireManageableQuestion(user, id);

    /**
     * `folderId` is applied as its own UPDATE, before the type-specific branch,
     * for two reasons: it is the only field that applies to BOTH question types,
     * and its validation (404 for another tenant's folder, 422 for a central
     * question) has to run before a Typst compile spends time on a request that
     * is going to be rejected anyway. `undefined` means "not mentioned" and is
     * left untouched — only a present key moves the question.
     */
    const changingFolder = Object.prototype.hasOwnProperty.call(dto, "folderId");
    if (changingFolder) {
      const folderId = dto.folderId ?? null;
      await this.folders.assertAssignableFolder(user, question.tenantId, folderId);
      const filed = await this.repository.setQuestionFolder(id, user.tenantId, folderId);
      if (!filed) {
        throw new NotFoundException(`Question not found: ${id}`);
      }
      // A folder-only PATCH has nothing else to do — the type branches below
      // would re-validate content the caller never sent.
      if (Object.keys(dto).filter((key) => key !== "folderId").length === 0) {
        return filed;
      }
    }

    if (question.type === "image") {
      return this.editImageQuestion(user, id, dto);
    }
    // …resto del método, sin cambios
```

En `bank.controller.ts`, `EditDraftQuestionBody` gana `readonly folderId?: string | null;`, y `editDraftQuestion` lo reenvía **solo cuando la clave viene en el body**, para no convertir "no lo mencionaste" en "ponlo en null":

```ts
    return this.service.editQuestion(user, id, {
      bodyTypst: body.bodyTypst,
      alternatives: body.alternatives,
      correctAnswer: body.correctAnswer,
      figureCode: body.figureCode,
      topicId: body.topicId,
      difficulty: body.difficulty,
      gradeLevel: body.gradeLevel,
      ...(Object.prototype.hasOwnProperty.call(body ?? {}, "folderId")
        ? { folderId: body.folderId ?? null }
        : {}),
    });
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/folders/bank-folders.e2e.spec.ts`
Expected: PASS — 43 tests.

- [ ] **Step 7: Correr las e2e vecinas del bank**

Run: `cd apps/api && pnpm exec jest --selectProjects e2e --runInBand src/modules/bank/`
Expected: PASS, salvo los fallos que `bank.e2e.spec.ts` ya traía del commit base. `bank-edit-approved.e2e.spec.ts` es el que más ejercita `editQuestion` — si aparece rojo ahí, es de este cambio.

Run también los unit del bank, que tocan el mismo servicio:
`cd apps/api && pnpm exec jest --selectProjects non-e2e src/modules/bank/`
Expected: PASS. `bank.service.spec.ts` construye `BankService` a mano; hay que pasarle un `BankFoldersService` doble (`{ assertAssignableFolder: jest.fn(), resolveFolderScope: jest.fn() } as unknown as BankFoldersService`) en cada `new BankService(...)`.

- [ ] **Step 8: Formatear y commitear**

```bash
pnpm format
pnpm --filter @exams-generator/api typecheck
git add apps/api/src/modules/bank
git commit -m "feat(api): accept folderId on question create and edit routes"
```

---

### Task 8: `@angular/cdk` y la primitiva `ui-folder-tree`

Empieza la web. Primero la primitiva presentacional, sin store ni HTTP: es la pieza que bank-list y bank-new comparten, y la que carga toda la accesibilidad.

**Files:**
- Modify: `apps/web/package.json` (vía `pnpm add`)
- Create: `apps/web/src/app/ui/folder-tree/folder-tree.types.ts`
- Create: `apps/web/src/app/ui/folder-tree/folder-tree.component.ts`
- Test: `apps/web/src/app/ui/folder-tree/folder-tree.component.spec.ts`

**Interfaces:**
- Consumes: `CdkTreeModule` de `@angular/cdk/tree`; `ButtonComponent` (`ui-button`, `variant`/`clicked`), `InputComponent` (`ui-input`, `value`/`valueChange`), `LucideAngularModule`.
- Produces:
  ```ts
  // folder-tree.types.ts
  export interface FolderTreeNode {
    readonly id: string;
    readonly name: string;
    readonly topicId: string | null;
    readonly ownCount: number;
    readonly centralCount: number;
    /** Cumulative `ownCount + centralCount` over this node and its whole subtree. Computed by the caller. */
    readonly totalCount: number;
    /** `false` for the virtual "Sin carpeta" node — no menu, no rename, no delete. */
    readonly editable: boolean;
    readonly children: readonly FolderTreeNode[];
  }
  export type FolderTreeMode = 'browse' | 'pick';
  export interface FolderRenameEvent { readonly id: string; readonly name: string }
  export interface FolderCreateEvent { readonly parentId: string | null; readonly name: string }

  // folder-tree.component.ts
  export class FolderTreeComponent {
    nodes: InputSignal<readonly FolderTreeNode[]>;
    selectedId: InputSignal<string | null>;
    mode: InputSignal<FolderTreeMode>;      // default 'browse'
    select: OutputEmitterRef<string>;
    toggle: OutputEmitterRef<string>;
    create: OutputEmitterRef<FolderCreateEvent>;
    rename: OutputEmitterRef<FolderRenameEvent>;
    remove: OutputEmitterRef<string>;
  }
  ```

- [ ] **Step 1: Instalar el CDK y confirmar la superficie de API que el template va a usar**

```bash
pnpm --filter @exams-generator/web add @angular/cdk@^22
```

El nombre del paquete sale de `apps/web/package.json` (`"name": "@exams-generator/web"`). La major del CDK DEBE coincidir con la de `@angular/core` (`^22.0.0`) — con versiones cruzadas, `TreeKeyManager` y los atributos ARIA no se inicializan.

Confirmar contra los tipos instalados, no de memoria, qué expone `CdkTree` (el plan asume `isExpanded`, `expand`, `collapse`):

```bash
rg -n "isExpanded|expand\(|collapse\(|childrenAccessor|levelAccessor" apps/web/node_modules/@angular/cdk/tree/index.d.ts | head -30
```

Expected: `childrenAccessor`, `isExpanded(dataNode)`, `expand(dataNode)`, `collapse(dataNode)` presentes. **Si alguno no está**, ajustar el template y el componente a lo que sí exista antes de escribir el test — y decirlo en el commit.

- [ ] **Step 2: Escribir el test que falla**

```ts
// apps/web/src/app/ui/folder-tree/folder-tree.component.spec.ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { LucideAngularModule, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-angular';
import { FolderTreeComponent } from './folder-tree.component';
import { FolderTreeNode } from './folder-tree.types';

function node(partial: Partial<FolderTreeNode> & { id: string; name: string }): FolderTreeNode {
  return {
    topicId: partial.topicId ?? null,
    ownCount: partial.ownCount ?? 0,
    centralCount: partial.centralCount ?? 0,
    totalCount: partial.totalCount ?? 0,
    editable: partial.editable ?? true,
    children: partial.children ?? [],
    ...partial,
  };
}

const TREE: FolderTreeNode[] = [
  node({
    id: 'colegio',
    name: 'Colegio',
    totalCount: 42,
    children: [
      node({ id: 'mate', name: 'Matemática', totalCount: 42, ownCount: 2, centralCount: 40, topicId: 't-1' }),
    ],
  }),
  node({ id: 'unfiled', name: 'Sin carpeta', totalCount: 3, ownCount: 3, editable: false }),
];

@Component({
  standalone: true,
  imports: [FolderTreeComponent],
  template: `
    <ui-folder-tree
      [nodes]="nodes()"
      [selectedId]="selectedId()"
      [mode]="mode()"
      (select)="lastSelected = $event"
      (create)="lastCreated = $event"
      (rename)="lastRenamed = $event"
      (remove)="lastRemoved = $event"
    ></ui-folder-tree>
  `,
})
class HostComponent {
  readonly nodes = signal<readonly FolderTreeNode[]>(TREE);
  readonly selectedId = signal<string | null>(null);
  readonly mode = signal<'browse' | 'pick'>('browse');
  lastSelected: string | null = null;
  lastCreated: { parentId: string | null; name: string } | null = null;
  lastRenamed: { id: string; name: string } | null = null;
  lastRemoved: string | null = null;
}

describe('FolderTreeComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let host: HostComponent;
  let element: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        HostComponent,
        LucideAngularModule.pick({ ChevronDown, ChevronRight, MoreHorizontal }),
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  function rowFor(id: string): HTMLElement {
    return element.querySelector<HTMLElement>(`[data-testid="folder-row"][data-folder-id="${id}"]`)!;
  }

  it('renders the roots and the CDK tree role', () => {
    expect(element.querySelector('[role="tree"]')).not.toBeNull();
    expect(rowFor('colegio')).not.toBeNull();
    expect(rowFor('unfiled')).not.toBeNull();
  });

  it('hides children until the node is expanded, then shows them', () => {
    expect(rowFor('mate')).toBeNull();

    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-toggle"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();

    expect(rowFor('mate')).not.toBeNull();
  });

  it('labels the toggle for assistive tech', () => {
    const toggle = element.querySelector<HTMLButtonElement>(
      '[data-testid="folder-toggle"][data-folder-id="colegio"]',
    )!;
    expect(toggle.getAttribute('aria-label')).toBe('Expandir Colegio');
  });

  it('gives every row the CDK treeitem role and an aria-level', () => {
    const row = rowFor('colegio').closest('[role="treeitem"]');
    expect(row).not.toBeNull();
    expect(row!.getAttribute('aria-level')).toBe('1');
  });

  it('emits select with the folder id when a row is clicked', () => {
    rowFor('colegio').click();
    expect(host.lastSelected).toBe('colegio');
  });

  it('marks the selected row with aria-selected', () => {
    host.selectedId.set('colegio');
    fixture.detectChanges();
    expect(rowFor('colegio').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the cumulative count next to the name', () => {
    expect(rowFor('colegio').textContent).toContain('42');
  });

  it('renames inline: F2 opens the input, Enter emits rename', () => {
    const row = rowFor('colegio');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    const input = element.querySelector<HTMLInputElement>('[data-testid="folder-name-input"] input')!;
    input.value = 'Colegio renombrado';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastRenamed).toEqual({ id: 'colegio', name: 'Colegio renombrado' });
  });

  it('cancels the inline edit on Escape without emitting', () => {
    const row = rowFor('colegio');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    element
      .querySelector<HTMLInputElement>('[data-testid="folder-name-input"] input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastRenamed).toBeNull();
    expect(element.querySelector('[data-testid="folder-name-input"]')).toBeNull();
  });

  it('emits remove on the Delete key', () => {
    rowFor('colegio').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(host.lastRemoved).toBe('colegio');
  });

  it('never offers actions on a non-editable node', () => {
    const unfiled = rowFor('unfiled');
    expect(unfiled.querySelector('[data-testid="folder-menu"]')).toBeNull();

    unfiled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(host.lastRemoved).toBeNull();
  });

  it('in pick mode shows no actions and no central count', () => {
    host.mode.set('pick');
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="folder-menu"]')).toBeNull();
    rowFor('colegio').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(host.lastRemoved).toBeNull();
    // Selecting still works — picking a folder IS the point of this mode.
    rowFor('colegio').click();
    expect(host.lastSelected).toBe('colegio');
  });

  it('creates a subfolder: the menu action opens an input whose Enter emits create', () => {
    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-menu"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="folder-action-create"]')!.click();
    fixture.detectChanges();

    const input = element.querySelector<HTMLInputElement>('[data-testid="folder-new-input"] input')!;
    input.value = 'Subcarpeta';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastCreated).toEqual({ parentId: 'colegio', name: 'Subcarpeta' });
  });

  it('renders an empty tree without throwing', () => {
    host.nodes.set([]);
    fixture.detectChanges();
    expect(element.querySelectorAll('[data-testid="folder-row"]')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `cd apps/web && pnpm exec ng test --include='**/folder-tree/**' --watch=false`
Expected: FAIL — `Failed to resolve import "./folder-tree.component"`.

- [ ] **Step 4: Escribir los tipos**

```ts
// apps/web/src/app/ui/folder-tree/folder-tree.types.ts

/**
 * A node as the tree RENDERS it — not the wire shape. The API sends direct
 * counts (`ownCount`/`centralCount` of that folder only); `totalCount` is the
 * cumulative sum over the subtree, computed by whoever builds this view model
 * (`toFolderTreeNodes` in the bank feature). The primitive does no arithmetic
 * of its own: a presentational component that recomputes totals is a second
 * place for the number to be wrong.
 */
export interface FolderTreeNode {
  readonly id: string;
  readonly name: string;
  readonly topicId: string | null;
  readonly ownCount: number;
  readonly centralCount: number;
  readonly totalCount: number;
  /** `false` for the virtual "Sin carpeta" node: it is a view of unfiled questions, not a folder. */
  readonly editable: boolean;
  readonly children: readonly FolderTreeNode[];
}

/**
 * `browse` is the bank's own tree: counts, per-folder menu, inline rename,
 * delete. `pick` is the folder chooser embedded in a question form or the
 * upload page: selection only — no actions, no central counts, nothing that
 * could mutate the tree from inside a form.
 */
export type FolderTreeMode = 'browse' | 'pick';

export interface FolderRenameEvent {
  readonly id: string;
  readonly name: string;
}

export interface FolderCreateEvent {
  /** `null` creates a root folder. */
  readonly parentId: string | null;
  readonly name: string;
}
```

- [ ] **Step 5: Escribir el componente**

```ts
// apps/web/src/app/ui/folder-tree/folder-tree.component.ts
import { CdkTree, CdkTreeModule } from '@angular/cdk/tree';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { InputComponent } from '../input/input.component';
import {
  FolderCreateEvent,
  FolderRenameEvent,
  FolderTreeMode,
  FolderTreeNode,
} from './folder-tree.types';

/**
 * Design-system folder tree, built on `@angular/cdk/tree` with
 * `childrenAccessor` (the data already arrives nested, so there is nothing to
 * flatten). Presentational: it renders nodes and emits intent, it never calls
 * an HTTP service and never mutates the array it is given.
 *
 * ACCESSIBILITY COMES FROM THE CDK and must not be re-implemented here:
 * `role="tree"`/`role="treeitem"`, `aria-level`, `aria-expanded`, arrow-key
 * navigation, Home/End and — critically — `tabindex` management via
 * `TreeKeyManager`. Never set `tabindex` on a node by hand; the key manager
 * owns it and a manual value fights it. What this component adds on top is the
 * part the CDK cannot know: a Spanish `aria-label` on the toggle ("Expandir
 * Matemática"), `aria-selected` on the row, and F2/Delete as shortcuts for
 * rename/remove.
 *
 * Hierarchy is drawn with indentation plus one faint vertical guide per level —
 * no nested cards (design doc, "Dirección visual").
 */
@Component({
  selector: 'ui-folder-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkTreeModule, InputComponent, LucideAngularModule],
  template: `
    <cdk-tree #tree [dataSource]="nodes()" [childrenAccessor]="childrenAccessor" class="block">
      <cdk-tree-node *cdkTreeNodeDef="let node" class="block">
        <div
          data-testid="folder-row"
          [attr.data-folder-id]="node.id"
          [attr.aria-selected]="node.id === selectedId() ? 'true' : 'false'"
          class="group flex cursor-pointer items-center gap-1 rounded-field px-2 py-1.5 text-sm transition-colors hover:bg-n50"
          [class.bg-tint-active]="node.id === selectedId()"
          (click)="onSelect(node)"
          (keydown)="onRowKeydown($event, node)"
        >
          @if (node.children.length > 0) {
            <button
              type="button"
              cdkTreeNodeToggle
              data-testid="folder-toggle"
              [attr.data-folder-id]="node.id"
              [attr.aria-label]="(tree.isExpanded(node) ? 'Colapsar ' : 'Expandir ') + node.name"
              class="shrink-0 rounded p-0.5 text-n500 hover:text-n700 focus:outline-none focus:ring-2 focus:ring-primary-300"
              (click)="$event.stopPropagation()"
            >
              <lucide-angular
                [name]="tree.isExpanded(node) ? 'chevron-down' : 'chevron-right'"
                class="h-4 w-4"
              ></lucide-angular>
            </button>
          } @else {
            <span class="w-5 shrink-0" aria-hidden="true"></span>
          }

          @if (editingId() === node.id) {
            <div data-testid="folder-name-input" class="flex-1">
              <ui-input
                [value]="draftName()"
                (valueChange)="draftName.set($event)"
                (keydown.enter)="commitRename(node)"
                (keydown.escape)="cancelEditing()"
              ></ui-input>
            </div>
          } @else {
            <span class="flex-1 truncate text-n800">{{ node.name }}</span>
            <span class="shrink-0 text-xs text-n500">{{ node.totalCount }}</span>
          }

          @if (mode() === 'browse' && node.editable && editingId() !== node.id) {
            <button
              type="button"
              data-testid="folder-menu"
              [attr.data-folder-id]="node.id"
              aria-haspopup="menu"
              [attr.aria-expanded]="menuFor() === node.id"
              [attr.aria-label]="'Acciones de ' + node.name"
              class="shrink-0 rounded p-0.5 text-n400 opacity-0 transition-opacity hover:text-n700 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary-300 group-hover:opacity-100"
              (click)="toggleMenu($event, node)"
            >
              <lucide-angular name="more-horizontal" class="h-4 w-4"></lucide-angular>
            </button>
          }
        </div>

        @if (menuFor() === node.id) {
          <div role="menu" class="ml-8 flex gap-2 py-1 text-xs">
            <button type="button" role="menuitem" data-testid="folder-action-create" class="underline" (click)="startCreating(node)">
              Nueva subcarpeta
            </button>
            <button type="button" role="menuitem" data-testid="folder-action-rename" class="underline" (click)="startEditing(node)">
              Renombrar
            </button>
            <button type="button" role="menuitem" data-testid="folder-action-remove" class="underline text-hard-text" (click)="requestRemove(node)">
              Eliminar
            </button>
          </div>
        }

        @if (creatingUnder() === node.id) {
          <div data-testid="folder-new-input" class="ml-8 py-1">
            <ui-input
              placeholder="Nombre de la carpeta"
              [value]="draftName()"
              (valueChange)="draftName.set($event)"
              (keydown.enter)="commitCreate(node)"
              (keydown.escape)="cancelEditing()"
            ></ui-input>
          </div>
        }

        <!-- Children render here, and only while the node is expanded. -->
        <div class="ml-4 border-l border-n200 pl-1">
          <ng-container cdkTreeNodeOutlet></ng-container>
        </div>
      </cdk-tree-node>
    </cdk-tree>
  `,
})
export class FolderTreeComponent {
  readonly nodes = input<readonly FolderTreeNode[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly mode = input<FolderTreeMode>('browse');

  readonly select = output<string>();
  readonly toggle = output<string>();
  readonly create = output<FolderCreateEvent>();
  readonly rename = output<FolderRenameEvent>();
  readonly remove = output<string>();

  private readonly tree = viewChild.required(CdkTree);

  /** Which node is being renamed inline, and which is having a child created under it. Never both. */
  protected readonly editingId = signal<string | null>(null);
  protected readonly creatingUnder = signal<string | null>(null);
  protected readonly menuFor = signal<string | null>(null);
  protected readonly draftName = signal('');

  /** Actions are gone in `pick` mode and on the virtual "Sin carpeta" node. */
  protected readonly actionsEnabled = computed(() => this.mode() === 'browse');

  /** CdkTree requires exactly one accessor; the data is already nested, so it is this one. */
  protected readonly childrenAccessor = (node: FolderTreeNode): readonly FolderTreeNode[] =>
    node.children;

  protected onSelect(node: FolderTreeNode): void {
    this.select.emit(node.id);
  }

  /**
   * F2 renames, Delete removes — the two shortcuts the spec asks for on top of
   * the CDK's own arrow/Home/End navigation. Guarded by the same rule as the
   * menu: nothing mutating in `pick` mode, nothing at all on a non-editable node.
   */
  protected onRowKeydown(event: KeyboardEvent, node: FolderTreeNode): void {
    if (!this.actionsEnabled() || !node.editable) {
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      this.startEditing(node);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      this.requestRemove(node);
    }
  }

  protected toggleMenu(event: Event, node: FolderTreeNode): void {
    event.stopPropagation();
    this.menuFor.update((current) => (current === node.id ? null : node.id));
  }

  protected startEditing(node: FolderTreeNode): void {
    this.menuFor.set(null);
    this.creatingUnder.set(null);
    this.draftName.set(node.name);
    this.editingId.set(node.id);
  }

  protected startCreating(node: FolderTreeNode): void {
    this.menuFor.set(null);
    this.editingId.set(null);
    this.draftName.set('');
    this.creatingUnder.set(node.id);
  }

  protected cancelEditing(): void {
    this.editingId.set(null);
    this.creatingUnder.set(null);
    this.draftName.set('');
  }

  /** A blank name is a cancel, not a request — the server would 422 it anyway. */
  protected commitRename(node: FolderTreeNode): void {
    const name = this.draftName().trim();
    if (name && name !== node.name) {
      this.rename.emit({ id: node.id, name });
    }
    this.cancelEditing();
  }

  protected commitCreate(node: FolderTreeNode): void {
    const name = this.draftName().trim();
    if (name) {
      this.create.emit({ parentId: node.id, name });
    }
    this.cancelEditing();
  }

  protected requestRemove(node: FolderTreeNode): void {
    this.menuFor.set(null);
    this.remove.emit(node.id);
  }
}
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd apps/web && pnpm exec ng test --include='**/folder-tree/**' --watch=false`
Expected: PASS — 14 tests.

**Si `tree.isExpanded(node)` no existe** con la versión instalada del CDK: reemplazarlo por un `expandedIds` local (`signal<ReadonlySet<string>>`) que el propio `(click)` del `cdkTreeNodeToggle` actualiza, y ajustar los dos `aria-label`/`[name]` que lo leen. El test de "hides children until expanded" sigue siendo el que manda.

- [ ] **Step 7: Formatear y commitear**

```bash
pnpm format
pnpm --filter @exams-generator/web typecheck
git add apps/web/package.json pnpm-lock.yaml apps/web/src/app/ui/folder-tree
git commit -m "feat(web): add ui-folder-tree primitive on the Angular CDK tree"
```

---

### Task 9: `BankFoldersStore` — cliente HTTP, view model y optimista con rollback

**Files:**
- Modify: `apps/web/src/app/features/bank/bank.service.ts`
- Modify: `apps/web/src/app/features/bank/bank.models.ts`
- Create: `apps/web/src/app/features/bank/folders/folder-tree.model.ts`
- Create: `apps/web/src/app/features/bank/folders/bank-folders.store.ts`
- Test: `apps/web/src/app/features/bank/folders/folder-tree.model.spec.ts`
- Test: `apps/web/src/app/features/bank/folders/bank-folders.store.spec.ts`

**Interfaces:**
- Consumes: `FolderTreeNode` (Task 8); `BankFolderNode`, `BankFoldersResponse`, `DeleteBankFolderResponse`, `UNFILED_FOLDER_ID` de `@exams-generator/shared` (Task 2).
- Produces:
  ```ts
  // bank.service.ts
  getFolders(): Observable<BankFoldersResponse>;
  createFolder(body: { name: string; parentId: string | null }): Observable<BankFolderNode>;
  updateFolder(id: string, patch: { name?: string; parentId?: string | null }): Observable<BankFolderNode>;
  deleteFolder(id: string): Observable<DeleteBankFolderResponse>;

  // folder-tree.model.ts
  export const UNFILED_NODE_NAME = 'Sin carpeta';
  export function toFolderTreeNodes(folders: readonly BankFolderNode[], unfiledCount: number): FolderTreeNode[];
  export function filterFolderTree(nodes: readonly FolderTreeNode[], query: string): FolderTreeNode[];
  export function findFolderById(folders: readonly BankFolderNode[], id: string): BankFolderNode | null;

  // bank-folders.store.ts
  export class BankFoldersStore {
    readonly tree: Signal<readonly FolderTreeNode[]>;
    readonly folders: Signal<readonly BankFolderNode[]>;
    readonly unfiledCount: Signal<number>;
    readonly loading: Signal<boolean>;
    readonly error: Signal<string | null>;
    load(): void;
    create(parentId: string | null, name: string): Observable<BankFolderNode>;
    rename(id: string, name: string): Observable<BankFolderNode>;
    move(id: string, parentId: string | null): Observable<BankFolderNode>;
    remove(id: string): Observable<DeleteBankFolderResponse>;
    folderName(id: string): string | null;
    folderTopicId(id: string): string | null;
  }
  ```

- [ ] **Step 1: Escribir el test que falla — el view model puro**

```ts
// apps/web/src/app/features/bank/folders/folder-tree.model.spec.ts
import { describe, it, expect } from 'vitest';
import { BankFolderNode, UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { filterFolderTree, findFolderById, toFolderTreeNodes } from './folder-tree.model';

function wire(partial: Partial<BankFolderNode> & { id: string; name: string }): BankFolderNode {
  return {
    parentId: partial.parentId ?? null,
    topicId: partial.topicId ?? null,
    position: partial.position ?? 0,
    ownCount: partial.ownCount ?? 0,
    centralCount: partial.centralCount ?? 0,
    children: partial.children ?? [],
    ...partial,
  };
}

const FOLDERS: BankFolderNode[] = [
  wire({
    id: 'colegio',
    name: 'Colegio',
    children: [
      wire({
        id: 'mate',
        name: 'Matemática',
        parentId: 'colegio',
        children: [
          wire({ id: 'trigo', name: 'Trigonometría', parentId: 'mate', topicId: 't-1', ownCount: 2, centralCount: 40 }),
        ],
      }),
    ],
  }),
];

describe('toFolderTreeNodes', () => {
  it('rolls the counts up: a parent shows its whole subtree', () => {
    const [colegio] = toFolderTreeNodes(FOLDERS, 0);
    expect(colegio.totalCount).toBe(42);
    expect(colegio.children[0]!.totalCount).toBe(42);
    expect(colegio.children[0]!.children[0]!.totalCount).toBe(42);
  });

  it('keeps the direct counts untouched alongside the cumulative one', () => {
    const trigo = toFolderTreeNodes(FOLDERS, 0)[0]!.children[0]!.children[0]!;
    expect({ own: trigo.ownCount, central: trigo.centralCount }).toEqual({ own: 2, central: 40 });
  });

  it('appends the virtual "Sin carpeta" node LAST when there are unfiled questions', () => {
    const nodes = toFolderTreeNodes(FOLDERS, 7);
    const last = nodes[nodes.length - 1]!;

    expect(last).toMatchObject({
      id: UNFILED_FOLDER_ID,
      name: 'Sin carpeta',
      editable: false,
      totalCount: 7,
      ownCount: 7,
      centralCount: 0,
      topicId: null,
    });
  });

  it('omits the virtual node entirely when nothing is unfiled', () => {
    expect(toFolderTreeNodes(FOLDERS, 0).map((node) => node.id)).toEqual(['colegio']);
  });

  it('marks every real folder editable', () => {
    expect(toFolderTreeNodes(FOLDERS, 0)[0]!.editable).toBe(true);
  });
});

describe('filterFolderTree', () => {
  it('returns the tree unchanged for a blank query', () => {
    const nodes = toFolderTreeNodes(FOLDERS, 3);
    expect(filterFolderTree(nodes, '   ')).toEqual(nodes);
  });

  it('keeps a branch when a DESCENDANT matches, so the match stays reachable', () => {
    const result = filterFolderTree(toFolderTreeNodes(FOLDERS, 0), 'trigo');
    expect(result.map((node) => node.id)).toEqual(['colegio']);
    expect(result[0]!.children[0]!.children.map((node) => node.id)).toEqual(['trigo']);
  });

  it('keeps a whole subtree when the branch ITSELF matches', () => {
    const result = filterFolderTree(toFolderTreeNodes(FOLDERS, 0), 'matem');
    expect(result[0]!.children[0]!.children.map((node) => node.id)).toEqual(['trigo']);
  });

  it('is accent- and case-insensitive', () => {
    expect(filterFolderTree(toFolderTreeNodes(FOLDERS, 0), 'MATEMATICA')).toHaveLength(1);
  });

  it('drops everything when nothing matches', () => {
    expect(filterFolderTree(toFolderTreeNodes(FOLDERS, 0), 'zzz')).toEqual([]);
  });
});

describe('findFolderById', () => {
  it('finds a nested folder', () => {
    expect(findFolderById(FOLDERS, 'trigo')?.topicId).toBe('t-1');
  });

  it('returns null for an unknown id', () => {
    expect(findFolderById(FOLDERS, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/web && pnpm exec ng test --include='**/features/bank/folders/**' --watch=false`
Expected: FAIL — `Failed to resolve import "./folder-tree.model"`.

- [ ] **Step 3: Implementar `folder-tree.model.ts`**

```ts
// apps/web/src/app/features/bank/folders/folder-tree.model.ts
import { BankFolderNode, UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';

export const UNFILED_NODE_NAME = 'Sin carpeta';

/**
 * Wire shape -> what the tree renders.
 *
 * The server sends DIRECT counts per folder (two GROUP BY queries); the number
 * a teacher wants to see on a collapsed branch is the CUMULATIVE one, so the
 * roll-up happens here, once, instead of inside the presentational component.
 *
 * The virtual "Sin carpeta" node is appended last and only when there is
 * something in it: an always-present empty bucket is a permanent piece of
 * furniture for a state most schools never reach. It is `editable: false` — it
 * is a view over `folder_id IS NULL`, not a folder, so it has no menu, no
 * rename and no delete.
 */
export function toFolderTreeNodes(
  folders: readonly BankFolderNode[],
  unfiledCount: number,
): FolderTreeNode[] {
  const convert = (node: BankFolderNode): FolderTreeNode => {
    const children = node.children.map(convert);
    return {
      id: node.id,
      name: node.name,
      topicId: node.topicId,
      ownCount: node.ownCount,
      centralCount: node.centralCount,
      totalCount:
        node.ownCount +
        node.centralCount +
        children.reduce((sum, child) => sum + child.totalCount, 0),
      editable: true,
      children,
    };
  };

  const nodes = folders.map(convert);

  if (unfiledCount > 0) {
    nodes.push({
      id: UNFILED_FOLDER_ID,
      name: UNFILED_NODE_NAME,
      topicId: null,
      ownCount: unfiledCount,
      centralCount: 0,
      totalCount: unfiledCount,
      editable: false,
      children: [],
    });
  }

  return nodes;
}

/** Accent- and case-insensitive, so "matematica" finds "Matemática". */
function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Filters the tree by folder name. A branch survives when ITS name matches (with
 * its whole subtree intact) or when any DESCENDANT matches (keeping only the
 * matching path) — otherwise a match three levels down would be filtered out
 * along with the ancestors needed to reach it.
 *
 * Scope note: this searches FOLDER NAMES, not questions. Same honest-scope
 * decision `filterQuestionTree` documented — the questions of a collapsed
 * branch are not in the browser, so matching them here would silently mean
 * "the part you already opened".
 */
export function filterFolderTree(
  nodes: readonly FolderTreeNode[],
  query: string,
): FolderTreeNode[] {
  const needle = normalize(query);
  if (!needle) {
    return [...nodes];
  }

  const result: FolderTreeNode[] = [];
  for (const node of nodes) {
    if (normalize(node.name).includes(needle)) {
      result.push(node);
      continue;
    }
    const children = filterFolderTree(node.children, query);
    if (children.length > 0) {
      result.push({ ...node, children });
    }
  }
  return result;
}

/** Depth-first lookup over the WIRE tree — used to read a folder's `topicId`/name by id. */
export function findFolderById(
  folders: readonly BankFolderNode[],
  id: string,
): BankFolderNode | null {
  for (const folder of folders) {
    if (folder.id === id) {
      return folder;
    }
    const found = findFolderById(folder.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd apps/web && pnpm exec ng test --include='**/features/bank/folders/**' --watch=false`
Expected: PASS — 12 tests.

- [ ] **Step 5: Escribir el test que falla — el store**

```ts
// apps/web/src/app/features/bank/folders/bank-folders.store.spec.ts
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BankFolderNode } from '@exams-generator/shared';
import { BankFoldersStore } from './bank-folders.store';
import { environment } from '../../../../environments/environment';

function wire(partial: Partial<BankFolderNode> & { id: string; name: string }): BankFolderNode {
  return {
    parentId: partial.parentId ?? null,
    topicId: partial.topicId ?? null,
    position: partial.position ?? 0,
    ownCount: partial.ownCount ?? 0,
    centralCount: partial.centralCount ?? 0,
    children: partial.children ?? [],
    ...partial,
  };
}

const TREE: BankFolderNode[] = [
  wire({
    id: 'colegio',
    name: 'Colegio',
    children: [wire({ id: 'mate', name: 'Matemática', parentId: 'colegio', topicId: 't-1', ownCount: 3 })],
  }),
];

describe('BankFoldersStore', () => {
  let store: BankFoldersStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), BankFoldersStore],
    });
    store = TestBed.inject(BankFoldersStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushLoad(unfiledCount = 0): void {
    store.load();
    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders`)
      .flush({ folders: TREE, unfiledCount });
  }

  it('loads the tree and exposes it as the render view model', () => {
    flushLoad(4);

    expect(store.loading()).toBe(false);
    expect(store.tree().map((node) => node.id)).toEqual(['colegio', 'unfiled']);
    expect(store.tree()[0]!.totalCount).toBe(3);
    expect(store.unfiledCount()).toBe(4);
  });

  it('surfaces a load failure as an error message and leaves the tree empty', () => {
    store.load();
    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders`)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(store.error()).toBe('No se pudieron cargar las carpetas. Inténtalo de nuevo.');
    expect(store.tree()).toEqual([]);
  });

  it('creates optimistically: the node is in the tree BEFORE the response arrives', () => {
    flushLoad();

    store.create('colegio', 'Nueva').subscribe({ error: () => {} });
    const names = store.tree()[0]!.children.map((node) => node.name);
    expect(names).toContain('Nueva');

    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders`)
      .flush(wire({ id: 'real', name: 'Nueva', parentId: 'colegio' }));

    expect(store.tree()[0]!.children.map((node) => node.id)).toContain('real');
  });

  it('rolls a failed create back to the previous tree', () => {
    flushLoad();
    const before = store.tree();

    store.create('colegio', 'Nueva').subscribe({ error: () => {} });
    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders`)
      .flush({ code: 'folder_name_taken' }, { status: 409, statusText: 'Conflict' });

    expect(store.tree()).toEqual(before);
  });

  it('renames optimistically and rolls back on failure', () => {
    flushLoad();

    store.rename('mate', 'Matemáticas').subscribe({ error: () => {} });
    expect(store.tree()[0]!.children[0]!.name).toBe('Matemáticas');

    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders/mate`)
      .flush({ code: 'folder_name_taken' }, { status: 409, statusText: 'Conflict' });

    expect(store.tree()[0]!.children[0]!.name).toBe('Matemática');
  });

  it('moves a folder with a PATCH carrying parentId', () => {
    flushLoad();

    store.move('mate', null).subscribe({ error: () => {} });
    const request = httpMock.expectOne(`${environment.apiBaseUrl}/bank/folders/mate`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ parentId: null });
    request.flush(wire({ id: 'mate', name: 'Matemática', parentId: null }));

    expect(store.tree().map((node) => node.id)).toEqual(['colegio', 'mate']);
  });

  it('removes optimistically and returns the server counts', () => {
    flushLoad();
    let result: { deletedFolders: number; unfiledQuestions: number } | null = null;

    store.remove('mate').subscribe({ next: (value) => (result = value), error: () => {} });
    expect(store.tree()[0]!.children).toEqual([]);

    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders/mate`)
      .flush({ deletedFolders: 1, unfiledQuestions: 3 });

    expect(result).toEqual({ deletedFolders: 1, unfiledQuestions: 3 });
  });

  it('rolls a failed remove back — the folder reappears', () => {
    flushLoad();

    store.remove('mate').subscribe({ error: () => {} });
    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders/mate`)
      .flush({ code: 'folder_not_found' }, { status: 404, statusText: 'Not Found' });

    expect(store.tree()[0]!.children.map((node) => node.id)).toEqual(['mate']);
  });

  it('answers name and topic lookups by id', () => {
    flushLoad();
    expect(store.folderName('mate')).toBe('Matemática');
    expect(store.folderTopicId('mate')).toBe('t-1');
    expect(store.folderName('nope')).toBeNull();
  });
});
```

- [ ] **Step 6: Correr el test y verificar que falla**

Run: `cd apps/web && pnpm exec ng test --include='**/features/bank/folders/**' --watch=false`
Expected: FAIL — `Failed to resolve import "./bank-folders.store"`.

- [ ] **Step 7: Agregar los cuatro métodos HTTP a `BankService`**

```ts
// apps/web/src/app/features/bank/bank.service.ts — añadir imports
import {
  BankFolderNode,
  BankFoldersResponse,
  DeleteBankFolderResponse,
} from '@exams-generator/shared';
```

```ts
  /**
   * The tenant's folder tree with per-folder counts. The FIRST call by a tenant
   * that has never been seeded also triggers the server-side seeding, so this is
   * slower exactly once, ever — and never for anyone else.
   */
  getFolders(): Observable<BankFoldersResponse> {
    return this.http.get<BankFoldersResponse>(`${environment.apiBaseUrl}/bank/folders`);
  }

  createFolder(body: { name: string; parentId: string | null }): Observable<BankFolderNode> {
    return this.http.post<BankFolderNode>(`${environment.apiBaseUrl}/bank/folders`, body);
  }

  /** Renames and/or moves. Omit a key to leave it alone; `parentId: null` moves to the root. */
  updateFolder(
    id: string,
    patch: { name?: string; parentId?: string | null },
  ): Observable<BankFolderNode> {
    return this.http.patch<BankFolderNode>(`${environment.apiBaseUrl}/bank/folders/${id}`, patch);
  }

  /** Returns the counts the post-delete banner shows — the questions themselves are never deleted. */
  deleteFolder(id: string): Observable<DeleteBankFolderResponse> {
    return this.http.delete<DeleteBankFolderResponse>(
      `${environment.apiBaseUrl}/bank/folders/${id}`,
    );
  }
```

En `bank.models.ts`, agregar `folderId` al filtro y al payload de creación, y re-exportar los DTOs de carpeta para que la feature siga teniendo un solo sitio de import:

```ts
export type {
  BankFolderNode,
  BankFoldersResponse,
  DeleteBankFolderResponse,
} from '@exams-generator/shared';
export { UNFILED_FOLDER_ID } from '@exams-generator/shared';
```

…y dentro de las interfaces existentes:

```ts
// BankQuestionFilters
  /** Tenant folder scope. `UNFILED_FOLDER_ID` selects the tenant's own questions with no folder. */
  readonly folderId?: string;

// CreateImageQuestionPayload y CreateStructuredQuestionPayload
  readonly folderId?: string | null;

// UpdateQuestionPayload
  readonly folderId?: string | null;
```

Y en `buildFilterParams` (mismo archivo `bank.service.ts`), añadir:

```ts
  if (filters.folderId) {
    params = params.set('folderId', filters.folderId);
  }
```

En `uploadImageQuestion`, propagar el campo al `FormData` solo cuando existe (un `''` en multipart llegaría como cadena vacía y el backend ya la trata como ausente, pero no mandarlo es más limpio):

```ts
    if (payload.folderId) {
      formData.set('folderId', payload.folderId);
    }
```

- [ ] **Step 8: Implementar el store**

```ts
// apps/web/src/app/features/bank/folders/bank-folders.store.ts
import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BankFolderNode, DeleteBankFolderResponse } from '@exams-generator/shared';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { BankService } from '../bank.service';
import { findFolderById, toFolderTreeNodes } from './folder-tree.model';

const LOAD_ERROR = 'No se pudieron cargar las carpetas. Inténtalo de nuevo.';

/** Optimistic ids are prefixed so a `startsWith` check can tell a pending node from a real one. */
const OPTIMISTIC_PREFIX = 'optimistic:';

let optimisticCounter = 0;

/**
 * The bank's folder tree as client state.
 *
 * `providedIn: 'root'` on purpose: `bank-list` and `bank-new` both read it, and
 * a teacher who uploads a question and lands back on the bank should not pay a
 * second `GET /bank/folders` to see the folder she just picked.
 *
 * WRITES ARE OPTIMISTIC WITH ROLLBACK. Renaming a folder is a text change on a
 * node already on screen — waiting a round-trip to show it makes the app feel
 * broken on a school connection. Every mutation snapshots the current tree,
 * applies the change locally, fires the request, and on failure restores the
 * snapshot verbatim. The snapshot is the WHOLE tree, not a reverse patch:
 * cheaper to reason about, and it cannot drift.
 */
@Injectable({ providedIn: 'root' })
export class BankFoldersStore {
  private readonly bankService = inject(BankService);

  private readonly _folders = signal<readonly BankFolderNode[]>([]);
  private readonly _unfiledCount = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly folders = this._folders.asReadonly();
  readonly unfiledCount = this._unfiledCount.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** The render view model: cumulative counts plus the virtual "Sin carpeta" node. */
  readonly tree = computed<readonly FolderTreeNode[]>(() =>
    toFolderTreeNodes(this._folders(), this._unfiledCount()),
  );

  load(): void {
    this._loading.set(true);
    this._error.set(null);
    this.bankService.getFolders().subscribe({
      next: (response) => {
        this._folders.set(response.folders);
        this._unfiledCount.set(response.unfiledCount);
        this._loading.set(false);
      },
      error: () => {
        this._loading.set(false);
        this._error.set(LOAD_ERROR);
      },
    });
  }

  folderName(id: string): string | null {
    return findFolderById(this._folders(), id)?.name ?? null;
  }

  folderTopicId(id: string): string | null {
    return findFolderById(this._folders(), id)?.topicId ?? null;
  }

  create(parentId: string | null, name: string): Observable<BankFolderNode> {
    const snapshot = this._folders();
    const optimistic: BankFolderNode = {
      id: `${OPTIMISTIC_PREFIX}${(optimisticCounter += 1)}`,
      name,
      parentId,
      topicId: null,
      position: Number.MAX_SAFE_INTEGER,
      ownCount: 0,
      centralCount: 0,
      children: [],
    };
    this._folders.set(insertNode(snapshot, parentId, optimistic));

    return this.bankService.createFolder({ name, parentId }).pipe(
      tap((created) =>
        // Swap the placeholder for the real row so the next action addresses a
        // real id — an optimistic id would 400 on `ParseUUIDPipe`.
        this._folders.set(replaceNode(this._folders(), optimistic.id, created)),
      ),
      catchError((error: HttpErrorResponse) => this.rollback(snapshot, error)),
    );
  }

  rename(id: string, name: string): Observable<BankFolderNode> {
    const snapshot = this._folders();
    this._folders.set(patchNode(snapshot, id, (node) => ({ ...node, name })));

    return this.bankService.updateFolder(id, { name }).pipe(
      catchError((error: HttpErrorResponse) => this.rollback(snapshot, error)),
    );
  }

  move(id: string, parentId: string | null): Observable<BankFolderNode> {
    const snapshot = this._folders();
    const moving = findFolderById(snapshot, id);
    if (moving) {
      this._folders.set(insertNode(removeNode(snapshot, id), parentId, { ...moving, parentId }));
    }

    return this.bankService.updateFolder(id, { parentId }).pipe(
      catchError((error: HttpErrorResponse) => this.rollback(snapshot, error)),
    );
  }

  remove(id: string): Observable<DeleteBankFolderResponse> {
    const snapshot = this._folders();
    const snapshotUnfiled = this._unfiledCount();
    this._folders.set(removeNode(snapshot, id));

    return this.bankService.deleteFolder(id).pipe(
      tap((result) => this._unfiledCount.update((count) => count + result.unfiledQuestions)),
      catchError((error: HttpErrorResponse) => {
        this._unfiledCount.set(snapshotUnfiled);
        return this.rollback(snapshot, error);
      }),
    );
  }

  /**
   * Restores the snapshot and re-throws, so the CALLER decides what the teacher
   * sees: `bank-list` maps `folder_name_taken` to a red inline input and
   * `folder_not_found` to a full reload (another tab deleted it).
   */
  private rollback(snapshot: readonly BankFolderNode[], error: HttpErrorResponse): Observable<never> {
    this._folders.set(snapshot);
    return throwError(() => error);
  }
}

/** All four helpers rebuild the branch they touch and share the rest — no mutation, ever. */
function insertNode(
  nodes: readonly BankFolderNode[],
  parentId: string | null,
  node: BankFolderNode,
): BankFolderNode[] {
  if (parentId === null) {
    return [...nodes, node];
  }
  return nodes.map((current) =>
    current.id === parentId
      ? { ...current, children: [...current.children, node] }
      : { ...current, children: insertNode(current.children, parentId, node) },
  );
}

function removeNode(nodes: readonly BankFolderNode[], id: string): BankFolderNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => ({ ...node, children: removeNode(node.children, id) }));
}

function patchNode(
  nodes: readonly BankFolderNode[],
  id: string,
  patch: (node: BankFolderNode) => BankFolderNode,
): BankFolderNode[] {
  return nodes.map((node) =>
    node.id === id ? patch(node) : { ...node, children: patchNode(node.children, id, patch) },
  );
}

function replaceNode(
  nodes: readonly BankFolderNode[],
  id: string,
  replacement: BankFolderNode,
): BankFolderNode[] {
  return nodes.map((node) =>
    node.id === id
      ? { ...replacement, children: node.children }
      : { ...node, children: replaceNode(node.children, id, replacement) },
  );
}
```

- [ ] **Step 9: Correr el test y verificar que pasa**

Run: `cd apps/web && pnpm exec ng test --include='**/features/bank/folders/**' --watch=false`
Expected: PASS — 22 tests (12 del modelo + 10 del store).

- [ ] **Step 10: Correr el spec del cliente HTTP del banco, que este cambio toca**

Run: `cd apps/web && pnpm exec ng test --include='**/features/bank/bank.service.spec.ts' --watch=false`
Expected: PASS. Si el spec afirma el `FormData` exacto de `uploadImageQuestion`, ajustar la aserción para el caso sin `folderId` (el campo no debe aparecer).

- [ ] **Step 11: Formatear y commitear**

```bash
pnpm format
pnpm --filter @exams-generator/web typecheck
git add apps/web/src/app/features/bank
git commit -m "feat(web): add BankFoldersStore with optimistic writes and rollback"
```

---

### Task 10: `bank-list` — el árbol de carpetas reemplaza a Curso → Tema

La tarea más grande de la web. Reemplaza el árbol lazy por carpeta, con menú por nodo, edición en línea, modal de confirmación con el copy exacto del spec y banner post-borrado.

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-list/bank-list.component.ts`
- Modify: `apps/web/src/app/features/bank/bank-list/bank-list.component.html`
- Test: `apps/web/src/app/features/bank/bank-list/bank-list.component.spec.ts`

**Interfaces:**
- Consumes: `BankFoldersStore` (`tree`, `loading`, `error`, `load`, `create`, `rename`, `remove`, `folderName`) y `FolderTreeComponent` (`ui-folder-tree`, inputs `nodes`/`selectedId`/`mode`, outputs `select`/`create`/`rename`/`remove`) — Tasks 8 y 9; `filterFolderTree` (Task 9); `BankService.listQuestionsPaged(filters, page, pageSize)` con `filters.folderId` (Task 9); `ModalComponent` (`ui-modal`, `open` model + `title` input + slot `[actions]`), `BannerComponent` (`ui-banner`, inputs `variant`/`message`/`dismissible`, output `dismissed`).
- Produces: nada que otra tarea consuma. `selectedFolderId` y `pendingFolderDelete` son estado interno del componente.

- [ ] **Step 1: Escribir el test que falla**

Ampliar los dobles del spec existente. `TaxonomyService` sigue usándose (el formulario de edición lo necesita), pero `getQuestionCounts` deja de llamarse desde este componente. Agregar al fake de `BankService`:

```ts
  // …dentro de la clase/objeto que hace de BankService en bank-list.component.spec.ts
  getFolders = () => of({ folders: FOLDERS, unfiledCount: unfiledCount });
  createFolder = (body: { name: string; parentId: string | null }) =>
    of({
      id: `created-${body.name}`,
      name: body.name,
      parentId: body.parentId,
      topicId: null,
      position: 0,
      ownCount: 0,
      centralCount: 0,
      children: [],
    });
  updateFolder = (id: string, patch: { name?: string }) =>
    of({ id, name: patch.name ?? 'x', parentId: null, topicId: null, position: 0, ownCount: 0, centralCount: 0, children: [] });
  deleteFolder = () => of({ deletedFolders: 1, unfiledQuestions: 12 });
```

…con el fixture arriba del `describe`:

```ts
const FOLDERS = [
  {
    id: 'colegio',
    name: 'Colegio',
    parentId: null,
    topicId: null,
    position: 0,
    ownCount: 0,
    centralCount: 0,
    children: [
      {
        id: 'trigo',
        name: 'Trigonometría',
        parentId: 'colegio',
        topicId: 't1',
        position: 0,
        ownCount: 7,
        centralCount: 30,
        children: [],
      },
    ],
  },
];
let unfiledCount = 0;
```

Y los tests nuevos:

```ts
  describe('folder tree', () => {
    it('renders the tenant folder tree instead of the course/topic tree', () => {
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('ui-folder-tree')).not.toBeNull();
      expect(compiled.querySelector('[data-testid="course-header"]')).toBeNull();
      expect(
        compiled.querySelector('[data-testid="folder-row"][data-folder-id="colegio"]'),
      ).not.toBeNull();
    });

    it('lists a folder’s questions when the folder is selected', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      compiled
        .querySelector<HTMLElement>('[data-testid="folder-row"][data-folder-id="colegio"]')!
        .click();
      fixture.detectChanges();

      expect(lastListFilters).toMatchObject({ folderId: 'colegio' });
    });

    it('shows the exact confirmation copy before removing a folder', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expandTo('trigo');

      compiled
        .querySelector<HTMLElement>('[data-testid="folder-row"][data-folder-id="trigo"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      fixture.detectChanges();

      const text = compiled
        .querySelector<HTMLElement>('[data-testid="folder-delete-confirm"]')!
        .textContent!.replace(/\s+/g, ' ')
        .trim();

      expect(text).toBe(
        'Se quitará la carpeta «Trigonometría» y sus 37 preguntas dejarán de verse aquí. Las preguntas no se borran del banco.',
      );
      expect(
        compiled.querySelector('[data-testid="folder-delete-confirm-yes"]')!.textContent,
      ).toContain('Quitar carpeta');
    });

    it('does not call the API until the teacher confirms', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expandTo('trigo');
      compiled
        .querySelector<HTMLElement>('[data-testid="folder-row"][data-folder-id="trigo"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      fixture.detectChanges();

      expect(deletedFolderIds).toEqual([]);
    });

    it('shows the post-delete banner with the unfiled count', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expandTo('trigo');
      compiled
        .querySelector<HTMLElement>('[data-testid="folder-row"][data-folder-id="trigo"]')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      fixture.detectChanges();

      compiled.querySelector<HTMLElement>('[data-testid="folder-delete-confirm-yes"] button')!.click();
      fixture.detectChanges();

      expect(deletedFolderIds).toEqual(['trigo']);
      expect(compiled.querySelector('[data-testid="folder-removed-banner"]')!.textContent).toContain(
        'Carpeta quitada. 12 preguntas quedaron en Sin carpeta.',
      );
    });

    it('creates a subfolder through the tree’s create output', () => {
      component.onFolderCreate({ parentId: 'colegio', name: 'Nueva' });
      fixture.detectChanges();

      expect(createdFolders).toEqual([{ parentId: 'colegio', name: 'Nueva' }]);
    });

    it('marks the inline name as taken when the server answers 409 folder_name_taken', () => {
      failNextFolderWrite({ status: 409, code: 'folder_name_taken' });
      component.onFolderRename({ id: 'trigo', name: 'Colegio' });
      fixture.detectChanges();

      expect((fixture.nativeElement as HTMLElement).querySelector('[data-testid="folder-error"]')!.textContent)
        .toContain('Ya existe una carpeta con ese nombre');
    });

    it('reloads the tree when a write comes back 404 — another tab deleted the folder', () => {
      failNextFolderWrite({ status: 404, code: 'folder_not_found' });
      const loadsBefore = folderLoadCount;

      component.onFolderRename({ id: 'trigo', name: 'Otra' });
      fixture.detectChanges();

      expect(folderLoadCount).toBe(loadsBefore + 1);
    });

    it('filters the tree by folder name', () => {
      component.filterQuery.set('trigo');
      fixture.detectChanges();

      const ids = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('[data-testid="folder-row"]'),
      ).map((row) => row.getAttribute('data-folder-id'));

      expect(ids).toContain('colegio');
      expect(ids).not.toContain('unfiled');
    });
  });
```

Helpers del spec (`expandTo`, `lastListFilters`, `deletedFolderIds`, `createdFolders`, `folderLoadCount`, `failNextFolderWrite`) se implementan al lado de los dobles ya existentes: `expandTo(id)` hace click en el `[data-testid="folder-toggle"]` de cada ancestro; los contadores son variables del `describe` que los fakes incrementan; `failNextFolderWrite` empuja un `throwError(() => new HttpErrorResponse({ status, error: { code } }))` que el siguiente `createFolder`/`updateFolder`/`deleteFolder` devuelve.

**El `37` del copy no es magia**: es `ownCount + centralCount` de `trigo` (7 + 30), o sea el `totalCount` acumulado que ya calcula `toFolderTreeNodes`.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/web && pnpm exec ng test --include='**/bank-list/**' --watch=false`
Expected: FAIL — el primero rompe en `expect(compiled.querySelector('ui-folder-tree')).not.toBeNull()`; el componente sigue renderizando `course-header`.

- [ ] **Step 3: Cambiar el componente**

En `bank-list.component.ts`:

- Agregar a `imports` del decorador: `FolderTreeComponent`, `BannerComponent`. Quitar nada más de la lista (el resto sigue en uso por el panel de detalle y el formulario de edición).
- Quitar los imports de `buildQuestionTree`, `filterQuestionTree`, `QuestionTreeCourseNode`, `QuestionTreeTopicNode` y `BankTopicCount`; y con ellos `topicCounts`, `loadedPages`, `loadingTopics`, `failedTopics`, `expandedCourses`/`expandedTopics`, `toggleCourse`/`toggleTopic`, `expandAll`/`collapseAll`, `topicDisplayName`, `remainingIn`, `loadMoreQuestions`, `retryTopic`, `isTopicLoading`, `hasTopicFailed`. Borrar cada uno **sólo cuando el compilador confirme que nada más lo usa** (`pnpm --filter @exams-generator/web typecheck` es el juez).
- Inyectar el store y agregar el estado nuevo:

```ts
  private readonly foldersStore = inject(BankFoldersStore);

  /** The folder tree, already rolled-up and with the virtual "Sin carpeta" node. */
  protected readonly folderTree = this.foldersStore.tree;
  protected readonly foldersLoading = this.foldersStore.loading;
  protected readonly foldersError = this.foldersStore.error;

  protected readonly selectedFolderId = signal<string | null>(null);
  /** The folder awaiting confirmation in the removal modal — the node, so the copy can name it and count it. */
  protected readonly pendingFolderDelete = signal<FolderTreeNode | null>(null);
  /** Post-delete banner text, cleared by its own dismiss button. */
  protected readonly folderRemovedNotice = signal<string | null>(null);
  /** Inline error for a rejected create/rename (`folder_name_taken`, `folder_name_invalid`, …). */
  protected readonly folderError = signal<string | null>(null);

  /** Client-side name filter over the folder tree — see `filterFolderTree` for the honest scope. */
  protected readonly filteredFolderTree = computed(() =>
    filterFolderTree(this.folderTree(), this.filterQuery()),
  );
```

- Reemplazar la carga inicial: donde hoy se llama `getQuestionCounts`, llamar `this.foldersStore.load()`. La carga de taxonomía (`fetchTaxonomy`) se queda: el formulario de edición sigue necesitando cursos y temas.
- Los handlers:

```ts
  /**
   * Selecting a folder is what drives the question list now. `null` (nothing
   * selected) shows the bank's own empty prompt rather than an unscoped list —
   * an unfiltered `GET /bank/questions` over the 64k central bank is exactly the
   * request this screen exists to avoid.
   */
  protected onFolderSelect(folderId: string): void {
    this.selectedFolderId.set(folderId);
    this.folderError.set(null);
    this.loadQuestionsForFolder(folderId, 1);
  }

  protected onFolderCreate(event: FolderCreateEvent): void {
    this.folderError.set(null);
    this.foldersStore.create(event.parentId, event.name).subscribe({
      error: (error: HttpErrorResponse) => this.handleFolderWriteError(error),
    });
  }

  protected onFolderRename(event: FolderRenameEvent): void {
    this.folderError.set(null);
    this.foldersStore.rename(event.id, event.name).subscribe({
      error: (error: HttpErrorResponse) => this.handleFolderWriteError(error),
    });
  }

  /** Removal is ALWAYS confirmed — the tree only asks; this opens the modal. */
  protected onFolderRemoveRequested(folderId: string): void {
    this.pendingFolderDelete.set(findTreeNode(this.folderTree(), folderId));
  }

  protected cancelFolderDelete(): void {
    this.pendingFolderDelete.set(null);
  }

  protected confirmFolderDelete(): void {
    const folder = this.pendingFolderDelete();
    if (!folder) {
      return;
    }
    this.pendingFolderDelete.set(null);
    this.foldersStore.remove(folder.id).subscribe({
      next: (result) => {
        if (this.selectedFolderId() === folder.id) {
          this.selectedFolderId.set(null);
        }
        // The banner exists to answer "where did my questions go?". With nothing
        // unfiled there is no question to answer, so no banner.
        this.folderRemovedNotice.set(
          result.unfiledQuestions > 0
            ? `Carpeta quitada. ${result.unfiledQuestions} preguntas quedaron en Sin carpeta.`
            : null,
        );
        this.liveAnnouncer.announce('Carpeta quitada.');
      },
      error: (error: HttpErrorResponse) => this.handleFolderWriteError(error),
    });
  }

  /** Jumps to the virtual "Sin carpeta" node from the post-delete banner. */
  protected goToUnfiled(): void {
    this.folderRemovedNotice.set(null);
    this.onFolderSelect(UNFILED_FOLDER_ID);
  }

  /**
   * A 404 on a folder write means another tab already deleted it, so the local
   * tree is stale and no message would be actionable — reload it. Everything
   * else gets the server's own Spanish message inline next to the input.
   */
  private handleFolderWriteError(error: HttpErrorResponse): void {
    if (error.status === 404) {
      this.folderError.set('Esa carpeta ya no existe. Actualizamos el árbol.');
      this.foldersStore.load();
      return;
    }
    this.folderError.set(
      extractErrorMessage(error, 'No se pudo actualizar la carpeta. Inténtalo de nuevo.'),
    );
  }
```

Y la función pura auxiliar, al final del archivo (fuera de la clase):

```ts
/** Depth-first lookup over the RENDER tree — the modal needs the node's name and cumulative count. */
function findTreeNode(nodes: readonly FolderTreeNode[], id: string): FolderTreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    const found = findTreeNode(node.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}
```

- `loadQuestionsForFolder(folderId, page)` reemplaza a `loadTopicQuestions`: mismo `listQuestionsPaged`, con `{ ...this.activeFilters(), folderId }` en vez de `{ topicId }`, guardando el resultado en un `signal<readonly BankQuestion[]>` plano (`folderQuestions`) más `folderQuestionsTotal`. Ya no hay caché por rama: una carpeta es una sola lista.

- [ ] **Step 4: Cambiar el template**

En `bank-list.component.html`, reemplazar todo el bloque `<div data-testid="bank-tree">` (líneas ~136–300 del archivo actual, del `@if (isFiltering() && filteredTree()…)` hasta el cierre del `@for (course of filteredTree())`) por:

```html
        @if (folderRemovedNotice(); as notice) {
          <div data-testid="folder-removed-banner" class="flex items-center gap-2">
            <ui-banner
              variant="info"
              [message]="notice"
              [dismissible]="true"
              (dismissed)="folderRemovedNotice.set(null)"
            ></ui-banner>
            <ui-button variant="ghost" (clicked)="goToUnfiled()">Ver Sin carpeta</ui-button>
          </div>
        }

        @if (folderError(); as message) {
          <p data-testid="folder-error" role="alert" class="text-sm text-hard-text">{{ message }}</p>
        }

        <div data-testid="bank-tree" class="flex max-h-[70vh] flex-col gap-1 overflow-y-auto">
          @if (foldersLoading()) {
            <p class="p-4 text-sm text-n500">Cargando carpetas…</p>
          } @else if (foldersError(); as message) {
            <p role="alert" class="p-4 text-sm text-hard-text">{{ message }}</p>
          } @else if (filteredFolderTree().length === 0) {
            <div class="rounded-card border border-dashed border-n200 p-6 text-center text-sm text-n500">
              @if (filterQuery().trim()) {
                No se encontraron carpetas para tu búsqueda.
              } @else {
                Todavía no tienes carpetas.
              }
            </div>
          } @else {
            <ui-folder-tree
              [nodes]="filteredFolderTree()"
              [selectedId]="selectedFolderId()"
              mode="browse"
              (select)="onFolderSelect($event)"
              (create)="onFolderCreate($event)"
              (rename)="onFolderRename($event)"
              (remove)="onFolderRemoveRequested($event)"
            ></ui-folder-tree>
          }
        </div>
```

El placeholder del buscador pasa a `"Buscar carpeta…"`, y los botones "Expandir cursos"/"Colapsar todo" se eliminan (la expansión ahora la maneja el CDK por nodo).

La lista de preguntas de la carpeta seleccionada va debajo del árbol, reutilizando el `@for` de `bank-question` que ya existe hoy dentro de la rama del tema, apuntado a `folderQuestions()`.

Y el modal, junto a los dos que ya viven al final del archivo:

```html
  <ui-modal
    [open]="pendingFolderDelete() !== null"
    title="Quitar carpeta"
    (openChange)="cancelFolderDelete()"
  >
    @if (pendingFolderDelete(); as folder) {
      <p data-testid="folder-delete-confirm" class="text-sm text-n700">
        Se quitará la carpeta «{{ folder.name }}» y sus {{ folder.totalCount }} preguntas dejarán de
        verse aquí. Las preguntas no se borran del banco.
      </p>
    }
    <div actions class="flex justify-end gap-2">
      <ui-button variant="ghost" (clicked)="cancelFolderDelete()">Cancelar</ui-button>
      <div data-testid="folder-delete-confirm-yes">
        <ui-button variant="danger" (clicked)="confirmFolderDelete()">Quitar carpeta</ui-button>
      </div>
    </div>
  </ui-modal>
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd apps/web && pnpm exec ng test --include='**/bank-list/**' --watch=false`
Expected: PASS. Los tests VIEJOS del spec que ejercitaban `course-header`/`topic-header`/"Ver más"/"Expandir cursos" ya no describen la pantalla: borrarlos en el mismo commit (no comentarlos), y dejar los que sí siguen valiendo (panel de detalle, edición en línea, IA, archivar/borrar pregunta).

- [ ] **Step 6: Formatear y commitear**

```bash
pnpm format
pnpm --filter @exams-generator/web typecheck
git add apps/web/src/app/features/bank/bank-list
git commit -m "feat(web): replace the bank course/topic tree with the tenant folder tree"
```

---

### Task 11: Campo "Carpeta" en el detalle de la pregunta

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-list/bank-list.component.ts`
- Modify: `apps/web/src/app/features/bank/bank-list/bank-list.component.html`
- Test: `apps/web/src/app/features/bank/bank-list/bank-list.component.spec.ts`

**Interfaces:**
- Consumes: `FolderTreeComponent` en modo `pick` (Task 8), `BankFoldersStore.folderName` (Task 9), `BankService.updateQuestion(id, { folderId })` (Task 9), `questionOrigin` (ya existe en `bank.models.ts`).
- Produces: nada externo.

- [ ] **Step 1: Escribir el test que falla**

```ts
  describe('question folder picker', () => {
    it('shows the current folder name in the detail panel', () => {
      selectQuestion(makeQuestion({ id: 'q1', tenantId: 't1', folderId: 'trigo' }));
      const compiled = fixture.nativeElement as HTMLElement;

      expect(compiled.querySelector('[data-testid="question-folder"]')!.textContent).toContain(
        'Trigonometría',
      );
    });

    it('shows "Sin carpeta" for an unfiled own question', () => {
      selectQuestion(makeQuestion({ id: 'q1', tenantId: 't1', folderId: null }));
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-testid="question-folder"]')!
          .textContent,
      ).toContain('Sin carpeta');
    });

    it('hides the picker entirely for a CENTRAL question', () => {
      selectQuestion(makeQuestion({ id: 'q1', tenantId: null, folderId: null }));
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-testid="question-folder-edit"]'),
      ).toBeNull();
    });

    it('PATCHes the question with the picked folder', () => {
      selectQuestion(makeQuestion({ id: 'q1', tenantId: 't1', folderId: null }));
      const compiled = fixture.nativeElement as HTMLElement;

      compiled.querySelector<HTMLElement>('[data-testid="question-folder-edit"] button')!.click();
      fixture.detectChanges();

      compiled
        .querySelector<HTMLElement>(
          '[data-testid="question-folder-picker"] [data-folder-id="colegio"]',
        )!
        .click();
      fixture.detectChanges();

      compiled.querySelector<HTMLElement>('[data-testid="question-folder-save"] button')!.click();
      fixture.detectChanges();

      expect(lastQuestionPatch).toEqual({ id: 'q1', patch: { folderId: 'colegio' } });
    });

    it('closes the popover and refreshes the tree after saving', () => {
      selectQuestion(makeQuestion({ id: 'q1', tenantId: 't1', folderId: null }));
      const compiled = fixture.nativeElement as HTMLElement;
      const loadsBefore = folderLoadCount;

      compiled.querySelector<HTMLElement>('[data-testid="question-folder-edit"] button')!.click();
      fixture.detectChanges();
      compiled
        .querySelector<HTMLElement>('[data-testid="question-folder-picker"] [data-folder-id="colegio"]')!
        .click();
      fixture.detectChanges();
      compiled.querySelector<HTMLElement>('[data-testid="question-folder-save"] button')!.click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="question-folder-picker"]')).toBeNull();
      expect(folderLoadCount).toBe(loadsBefore + 1);
    });
  });
```

`selectQuestion(question)` es el helper que el spec ya tiene (o el equivalente: clic en la fila y `detectChanges`); `lastQuestionPatch` lo registra el fake de `updateQuestion`.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/web && pnpm exec ng test --include='**/bank-list/**' --watch=false`
Expected: FAIL — `[data-testid="question-folder"]` no existe.

- [ ] **Step 3: Implementar en el componente**

```ts
  /** Popover state for the detail panel's folder picker — open, and what has been picked but not saved. */
  protected readonly folderPickerOpen = signal(false);
  protected readonly folderPickerChoice = signal<string | null>(null);
  protected readonly folderPickerSaving = signal(false);

  /** The picker is `pick` mode: selection only, no actions — a form must never mutate the tree. */
  protected readonly pickerTree = this.foldersStore.tree;

  /**
   * The folder label for the selected question. Central questions never have
   * one — they surface inside a folder through its `topicId`, they do not
   * belong to it — so the picker is not rendered for them at all.
   */
  protected selectedQuestionFolderLabel(): string {
    const folderId = this.selected()?.folderId ?? null;
    if (!folderId) {
      return 'Sin carpeta';
    }
    return this.foldersStore.folderName(folderId) ?? 'Sin carpeta';
  }

  protected canPickFolder(question: BankQuestion): boolean {
    return questionOrigin(question) !== 'central';
  }

  protected openFolderPicker(): void {
    this.folderPickerChoice.set(this.selected()?.folderId ?? null);
    this.folderPickerOpen.set(true);
  }

  protected closeFolderPicker(): void {
    this.folderPickerOpen.set(false);
    this.folderPickerChoice.set(null);
  }

  protected saveQuestionFolder(): void {
    const question = this.selected();
    if (!question || this.folderPickerSaving()) {
      return;
    }
    // The virtual "Sin carpeta" node means "unfile it", which on the wire is null.
    const choice = this.folderPickerChoice();
    const folderId = choice === null || choice === UNFILED_FOLDER_ID ? null : choice;

    this.folderPickerSaving.set(true);
    this.bankService.updateQuestion(question.id, { folderId }).subscribe({
      next: (updated) => {
        this.folderPickerSaving.set(false);
        this.selected.set(updated);
        this.closeFolderPicker();
        // Counts moved between folders — reload rather than patch two numbers by hand.
        this.foldersStore.load();
        this.liveAnnouncer.announce('Carpeta actualizada.');
      },
      error: (error: HttpErrorResponse) => {
        this.folderPickerSaving.set(false);
        this.actionError.set(
          extractErrorMessage(error, 'No se pudo cambiar la carpeta de la pregunta.'),
        );
      },
    });
  }
```

- [ ] **Step 4: Implementar en el template**

Dentro del `<dl>` del panel de detalle (junto a `gradeLevelLabel(q.gradeLevel)`, línea ~503 hoy):

```html
                  <dt>Carpeta</dt>
                  <dd data-testid="question-folder" class="flex items-center gap-2">
                    <span>{{ selectedQuestionFolderLabel() }}</span>
                    @if (canPickFolder(q)) {
                      <span data-testid="question-folder-edit">
                        <ui-button variant="ghost" size="sm" (clicked)="openFolderPicker()">
                          Cambiar
                        </ui-button>
                      </span>
                    }
                  </dd>
```

Y el popover, justo después del `<dl>`:

```html
                @if (folderPickerOpen()) {
                  <div
                    data-testid="question-folder-picker"
                    class="mt-2 rounded-card border border-n200 bg-surface p-2 shadow-lg"
                  >
                    <ui-folder-tree
                      [nodes]="pickerTree()"
                      [selectedId]="folderPickerChoice()"
                      mode="pick"
                      (select)="folderPickerChoice.set($event)"
                    ></ui-folder-tree>
                    <div class="mt-2 flex justify-end gap-2">
                      <ui-button variant="ghost" (clicked)="closeFolderPicker()">Cancelar</ui-button>
                      <span data-testid="question-folder-save">
                        <ui-button
                          variant="primary"
                          [loading]="folderPickerSaving()"
                          (clicked)="saveQuestionFolder()"
                        >
                          Guardar
                        </ui-button>
                      </span>
                    </div>
                  </div>
                }
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `cd apps/web && pnpm exec ng test --include='**/bank-list/**' --watch=false`
Expected: PASS.

- [ ] **Step 6: Formatear y commitear**

```bash
pnpm format
pnpm --filter @exams-generator/web typecheck
git add apps/web/src/app/features/bank/bank-list
git commit -m "feat(web): add a folder picker to the bank question detail panel"
```

---

### Task 12: `bank-new` — campo Carpeta, prefill de Curso/Tema, hint de desajuste y memoria en `sessionStorage`

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-new/bank-new.component.ts`
- Modify: `apps/web/src/app/features/bank/bank-new/bank-new.component.html`
- Modify: `apps/web/src/app/features/bank/question-save-chain.service.ts`
- Test: `apps/web/src/app/features/bank/bank-new/bank-new.component.spec.ts`

**Interfaces:**
- Consumes: `BankFoldersStore` (Task 9), `FolderTreeComponent` en modo `pick` (Task 8), `TaxonomyService.getAllTopics()` (ya existe, devuelve `Topic[]` con `courseId`), `QuestionSaveChainService.uploadImage`/`submitStructured` (ya existen).
- Produces:
  ```ts
  // question-save-chain.service.ts
  SubmitStructuredParams.folderId: string | null;   // campo nuevo, requerido
  ```

- [ ] **Step 1: Escribir el test que falla**

```ts
  describe('folder field', () => {
    it('shows the folder picker above Curso/Tema on both tabs', () => {
      const compiled = fixture.nativeElement as HTMLElement;
      expect(compiled.querySelector('[data-testid="folder-field-photo"]')).not.toBeNull();

      component.setTab('structured');
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="folder-field-structured"]')).not.toBeNull();
    });

    it('prefills Curso and Tema when the picked folder carries a topicId', async () => {
      pickFolder('photo', 'trigo'); // topicId: 't1', course 'c1'
      await settleEffects(fixture);

      expect(component.pCourseId()).toBe('c1');
      expect(component.pTopicId()).toBe('t1');
    });

    it('keeps the folder and shows the mismatch hint when the teacher changes Tema by hand', async () => {
      pickFolder('photo', 'trigo');
      await settleEffects(fixture);

      component.pTopicId.set('t2');
      fixture.detectChanges();

      expect(component.pFolderId()).toBe('trigo');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-testid="folder-topic-mismatch"]')!
          .textContent,
      ).toContain('El Tema no coincide con la carpeta');
    });

    it('does not prefill anything when the folder has no topicId', async () => {
      pickFolder('photo', 'colegio'); // topicId: null
      await settleEffects(fixture);

      expect(component.pCourseId()).toBe('');
      expect(component.pTopicId()).toBe('');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[data-testid="folder-topic-mismatch"]'),
      ).toBeNull();
    });

    it('sends folderId when uploading a photo question', async () => {
      pickFolder('photo', 'trigo');
      await settleEffects(fixture);
      fillPhotoForm();

      component.submitPhoto();
      fixture.detectChanges();

      expect(lastUploadPayload).toMatchObject({ folderId: 'trigo' });
    });

    it('sends folderId when saving a structured question', async () => {
      component.setTab('structured');
      pickFolder('structured', 'trigo');
      await settleEffects(fixture);
      fillStructuredForm();

      component.submitStructured();
      fixture.detectChanges();

      expect(lastSubmitStructuredParams).toMatchObject({ folderId: 'trigo' });
    });

    it('remembers the last folder in sessionStorage', async () => {
      pickFolder('photo', 'trigo');
      await settleEffects(fixture);

      expect(sessionStorage.getItem('bank-new:last-folder-id')).toBe('trigo');
    });

    it('restores the remembered folder on a fresh visit', async () => {
      sessionStorage.setItem('bank-new:last-folder-id', 'trigo');

      const second = TestBed.createComponent(BankNewComponent);
      second.detectChanges();
      await settleEffects(second);

      expect(second.componentInstance.pFolderId()).toBe('trigo');
    });

    it('ignores a remembered folder that no longer exists', async () => {
      sessionStorage.setItem('bank-new:last-folder-id', 'deleted-folder');

      const second = TestBed.createComponent(BankNewComponent);
      second.detectChanges();
      await settleEffects(second);

      expect(second.componentInstance.pFolderId()).toBeNull();
    });
  });
```

`pickFolder(tab, id)` hace click en `[data-testid="folder-field-<tab>"] button` y luego en el nodo `[data-folder-id="<id>"]` del picker; `settleEffects(fixture)` es `await fixture.whenStable(); fixture.detectChanges();` (las cadenas de `effect` de grado→curso→tema del componente necesitan una vuelta). Agregar `afterEach(() => sessionStorage.clear())` al `describe`. El fake de `TaxonomyService` debe responder `getAllTopics()` con `[{ id: 't1', name: 'Trigonometría', courseId: 'c1' }, { id: 't2', name: 'Otro', courseId: 'c1' }]`.

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd apps/web && pnpm exec ng test --include='**/bank-new/**' --watch=false`
Expected: FAIL — `[data-testid="folder-field-photo"]` no existe.

- [ ] **Step 3: Implementar en el componente**

```ts
// imports nuevos
import { UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { FolderTreeComponent } from '../../../ui/folder-tree/folder-tree.component';
import { BankFoldersStore } from '../folders/bank-folders.store';

/** Survives a reload of `/app/bank/new` within the same tab — long enough to upload a batch, gone when the tab closes. */
const LAST_FOLDER_STORAGE_KEY = 'bank-new:last-folder-id';
```

Agregar `FolderTreeComponent` a `imports` del decorador, y dentro de la clase:

```ts
  private readonly foldersStore = inject(BankFoldersStore);

  protected readonly folderTree = this.foldersStore.tree;
  protected readonly pFolderId = signal<string | null>(null);
  protected readonly sFolderId = signal<string | null>(null);
  protected readonly folderPickerFor = signal<Tab | null>(null);
  /** Every topic in the catalog, loaded once — the picker needs `topicId -> courseId` to prefill Curso. */
  private readonly allTopics = signal<readonly Topic[]>([]);

  /**
   * Relay for the folder-driven topic preselect, mirroring
   * `BankNewExtractionService`'s pending mechanism: setting `pCourseId` fires the
   * course->topics effect, which BLANKS `pTopicId` before the new topics land.
   * Stashing the id here lets `loadTopicsFor` restore it on the way through
   * instead of racing the effect.
   */
  private pendingFolderTopicId: Partial<Record<Tab, string>> = {};

  protected folderName(tab: Tab): string {
    const id = tab === 'photo' ? this.pFolderId() : this.sFolderId();
    return (id && this.foldersStore.folderName(id)) ?? 'Sin carpeta';
  }

  /**
   * True when the folder is linked to a topic AND the teacher picked a different
   * one. NOT an error: a folder can legitimately hold mixed topics, so the
   * folder stays and the hint just says the two disagree.
   */
  protected folderTopicMismatch(tab: Tab): boolean {
    const folderId = tab === 'photo' ? this.pFolderId() : this.sFolderId();
    if (!folderId) {
      return false;
    }
    const folderTopicId = this.foldersStore.folderTopicId(folderId);
    const topicId = tab === 'photo' ? this.pTopicId() : this.sTopicId();
    return !!folderTopicId && !!topicId && folderTopicId !== topicId;
  }

  protected openFolderPicker(tab: Tab): void {
    this.folderPickerFor.set(tab);
  }

  protected onFolderPicked(tab: Tab, folderId: string): void {
    this.folderPickerFor.set(null);
    this.applyFolderSelection(tab, folderId === UNFILED_FOLDER_ID ? null : folderId);
  }

  /**
   * Applies a folder choice: remembers it, and — when the folder is linked to a
   * topic — preselects Curso and Tema from it. The teacher can still change
   * either by hand; the folder does not follow (`folderTopicMismatch` just says
   * so), because one folder grouping several topics is a legitimate way to file.
   */
  private applyFolderSelection(tab: Tab, folderId: string | null): void {
    (tab === 'photo' ? this.pFolderId : this.sFolderId).set(folderId);
    this.rememberFolder(folderId);

    const topicId = folderId ? this.foldersStore.folderTopicId(folderId) : null;
    if (!topicId) {
      return;
    }
    const topic = this.allTopics().find((candidate) => candidate.id === topicId);
    if (!topic) {
      return;
    }

    const courseSignal = tab === 'photo' ? this.pCourseId : this.sCourseId;
    const topicSignal = tab === 'photo' ? this.pTopicId : this.sTopicId;

    this.pendingFolderTopicId[tab] = topic.id;
    const courseChanged = courseSignal() !== topic.courseId;
    courseSignal.set(topic.courseId);
    if (!courseChanged) {
      // Same course -> the course->topics effect was a no-op and never consumed
      // the relay. Apply it directly, exactly as `resolveStructuredTaxonomy` does.
      delete this.pendingFolderTopicId[tab];
      topicSignal.set(topic.id);
    }
  }

  private consumePendingFolderTopicId(tab: Tab): string {
    const id = this.pendingFolderTopicId[tab] ?? '';
    delete this.pendingFolderTopicId[tab];
    return id;
  }

  private rememberFolder(folderId: string | null): void {
    try {
      if (folderId) {
        sessionStorage.setItem(LAST_FOLDER_STORAGE_KEY, folderId);
      } else {
        sessionStorage.removeItem(LAST_FOLDER_STORAGE_KEY);
      }
    } catch {
      // Private mode / storage disabled: remembering the folder is a convenience,
      // never a requirement. Losing it must not break the upload.
    }
  }

  /** Restores the remembered folder ONCE the tree is loaded — a folder deleted meanwhile is dropped silently. */
  private restoreRememberedFolder(): void {
    let remembered: string | null = null;
    try {
      remembered = sessionStorage.getItem(LAST_FOLDER_STORAGE_KEY);
    } catch {
      return;
    }
    if (!remembered || !this.foldersStore.folderName(remembered)) {
      return;
    }
    this.applyFolderSelection('photo', remembered);
    this.applyFolderSelection('structured', remembered);
  }
```

En el constructor, junto a los `effect` que ya están:

```ts
    this.foldersStore.load();
    this.taxonomyService.getAllTopics().subscribe({
      next: (topics) => this.allTopics.set(topics),
      error: () => this.allTopics.set([]),
    });

    /**
     * Restores the remembered folder the first time the tree has content — the
     * store loads asynchronously, so this cannot run inline in the constructor.
     * Guarded so it fires once and never fights a folder the teacher just picked.
     */
    let restored = false;
    effect(() => {
      if (!restored && this.folderTree().length > 0) {
        restored = true;
        this.restoreRememberedFolder();
      }
    });
```

En `loadTopicsFor`, consumir el relay en las DOS ramas:

```ts
    if (tab === 'photo') {
      this.pTopicId.set(this.consumePendingFolderTopicId('photo'));
      this.pTopics.set([]);
    } else {
      this.sTopicId.set(
        this.extraction.consumePendingTopicId() || this.consumePendingFolderTopicId('structured'),
      );
      this.sTopics.set([]);
    }
```

En `submitPhoto`, agregar `folderId: this.pFolderId(),` al objeto de `uploadImage`. En `submitStructured`, agregar `folderId: this.sFolderId(),` al objeto de `submitStructured`.

Y justo antes de `this.extraction.resolveStructuredTaxonomy({...})` (en `extractFromPhoto`), llevar la carpeta del tab foto al tab estructurado:

```ts
        // The folder the teacher chose on the photo tab follows the extraction
        // into the structured tab. Curso/Tema need no special casing: they were
        // already set from the folder, and `resolveStructuredTaxonomy` treats a
        // manual photo-tab pick as the winner over the AI's suggestion.
        this.sFolderId.set(this.pFolderId());
```

- [ ] **Step 4: Extender la cadena de guardado**

En `question-save-chain.service.ts`, agregar a `SubmitStructuredParams`:

```ts
  /** Tenant folder the question is filed under, or `null` for unfiled. */
  readonly folderId: string | null;
```

…y pasarlo en el `createStructuredQuestion` de `submitStructured`:

```ts
        folderId: params.folderId,
```

`uploadImage` no cambia: recibe un `CreateImageQuestionPayload` que ya ganó `folderId` en la Task 9, y `BankService.uploadImageQuestion` ya lo pone en el `FormData`.

- [ ] **Step 5: Implementar el template**

En `bank-new.component.html`, encima del grupo Curso/Tema de CADA tab (buscar los dos `<ui-select label="Curso"` con `rg -n 'label="Curso"' apps/web/src/app/features/bank/bank-new/bank-new.component.html`), insertar — cambiando `photo`/`pFolderId` por `structured`/`sFolderId` en la segunda copia:

```html
        <div data-testid="folder-field-photo" class="flex flex-col gap-1">
          <span class="text-sm font-medium text-n700">Carpeta</span>
          <ui-button variant="ghost" (clicked)="openFolderPicker('photo')">
            {{ folderName('photo') }}
          </ui-button>
          @if (folderPickerFor() === 'photo') {
            <div class="rounded-card border border-n200 bg-surface p-2 shadow-lg">
              <ui-folder-tree
                [nodes]="folderTree()"
                [selectedId]="pFolderId()"
                mode="pick"
                (select)="onFolderPicked('photo', $event)"
              ></ui-folder-tree>
            </div>
          }
          @if (folderTopicMismatch('photo')) {
            <p data-testid="folder-topic-mismatch" class="text-xs text-medium-text">
              El Tema no coincide con la carpeta
            </p>
          }
        </div>
```

- [ ] **Step 6: Correr el test y verificar que pasa**

Run: `cd apps/web && pnpm exec ng test --include='**/bank-new/**' --watch=false`
Expected: PASS.

- [ ] **Step 7: Correr toda la feature del banco**

Run: `cd apps/web && pnpm exec ng test --include='**/features/bank/**' --include='**/ui/folder-tree/**' --watch=false`
Expected: PASS. Los specs que instancian `QuestionSaveChainService` con un `SubmitStructuredParams` literal fallan a compilar hasta que se les agregue `folderId: null` — es el compilador cobrando el campo nuevo, no un bug.

- [ ] **Step 8: Formatear y commitear**

```bash
pnpm format
pnpm --filter @exams-generator/web typecheck
git add apps/web/src/app/features/bank
git commit -m "feat(web): add the folder field to bank-new with taxonomy prefill and session memory"
```

---

### Task 13: Limpieza del árbol viejo y pasada manual en el navegador

**Files:**
- Delete: `apps/web/src/app/features/bank/bank-list/bank-question-tree.ts`
- Delete: `apps/web/src/app/features/bank/bank-list/bank-question-tree.spec.ts`
- Modify: `apps/web/src/app/features/bank/bank.service.ts` (posible), `apps/web/src/app/features/bank/bank.models.ts` (posible)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Confirmar que nada más usa el árbol viejo**

```bash
rg -n "bank-question-tree|buildQuestionTree|filterQuestionTree|QuestionTreeCourseNode|QuestionTreeTopicNode" apps/web/src
```

Expected: solo los dos archivos a borrar. **Si aparece otro consumidor, NO borrar** — reportarlo y dejar los archivos donde están; `group-rows-by-course.ts` (exam-builder) es otra cosa y no se toca.

Verificar también si `getQuestionCounts`/`BankTopicCount` quedaron huérfanos:

```bash
rg -n "getQuestionCounts|BankTopicCount" apps/web/src apps/api/src
```

`GET /bank/questions/summary` **se queda en el API** (lo usan exam-builder y la IA — el spec lo dice explícitamente). En la web, si `getQuestionCounts` ya no tiene llamadores, borrar el método y su spec; si `BankTopicCount` tampoco, borrar el tipo.

- [ ] **Step 2: Borrar y correr toda la suite de la web**

```bash
rm apps/web/src/app/features/bank/bank-list/bank-question-tree.ts \
   apps/web/src/app/features/bank/bank-list/bank-question-tree.spec.ts
```

Run: `cd apps/web && pnpm exec ng test --include='**/features/bank/**' --include='**/ui/folder-tree/**' --watch=false`
Expected: PASS.

Run: `pnpm --filter @exams-generator/web typecheck`
Expected: sin errores. Un import colgando del archivo borrado sale acá.

- [ ] **Step 3: Levantar el entorno y hacer la pasada manual**

```bash
pnpm dev:infra
pnpm --filter @exams-generator/api db:migrate
```

Levantar API y web (`pnpm --filter @exams-generator/api dev` y `pnpm --filter @exams-generator/web dev`, en dos terminales) y entrar a `http://localhost:4201/app/bank` con un usuario de colegio (rol `teacher`, con `tenantId`). **No leer `.env` a mano**; si hace falta un valor, `envsafe show .env`.

Recorrido, con la skill `claude-in-chrome` o Playwright MCP:

1. **Siembra** — la primera carga del banco muestra el árbol sembrado: raíces por etapa, cursos, y los temas con su sufijo de grado donde dos comparten nombre. Recargar: el árbol es el mismo, sin duplicados.
2. **Crear** — menú "⋯" de un curso → "Nueva subcarpeta" → escribir un nombre → Enter. Aparece al instante (optimista) y sigue ahí tras recargar.
3. **Nombre repetido** — repetir el nombre de una hermana. Sale el error en línea y el árbol vuelve a como estaba.
4. **Subir dentro** — "Nueva pregunta" → el campo "Carpeta" arriba de Curso/Tema → elegir la subcarpeta recién creada → Curso y Tema se precargan si la carpeta tiene tema → subir una foto → guardar. Al volver al banco, la pregunta está en esa carpeta.
5. **Memoria** — entrar de nuevo a "Nueva pregunta": la carpeta aparece ya elegida.
6. **Desajuste** — cambiar el Tema a mano: la carpeta NO cambia y aparece "El Tema no coincide con la carpeta".
7. **Mover una pregunta** — abrir el detalle → "Carpeta" → "Cambiar" → elegir otra → Guardar. Los conteos del árbol se mueven.
8. **Borrar** — menú "⋯" → "Eliminar". El modal dice EXACTAMENTE: «Se quitará la carpeta «X» y sus N preguntas dejarán de verse aquí. Las preguntas no se borran del banco.» con "Cancelar" y "Quitar carpeta". Cancelar no hace nada. Confirmar muestra el banner "Carpeta quitada. N preguntas quedaron en Sin carpeta." y el enlace lleva a ese nodo, donde está la pregunta del paso 4.
9. **Teclado** — navegar el árbol solo con flechas, Home/End, F2 y Delete. El foco nunca se pierde y las acciones son las mismas que con mouse.
10. **Dos pestañas** — borrar una carpeta en la pestaña A y renombrarla en la B: la B avisa y recarga el árbol, no se queda en un estado imposible.

**Cualquier paso que falle es un bug de este trabajo: arreglarlo con un test que lo reproduzca primero**, no con un parche a mano.

- [ ] **Step 4: Formatear y commitear**

```bash
pnpm format
git add -A apps/web/src/app/features/bank
git commit -m "chore(web): drop the course/topic bank tree now that folders replaced it"
```

---

## Self-Review

**1. Cobertura del spec.** Sección por sección:

| Sección del spec | Tarea |
|---|---|
| Tabla `question_folders` + índices únicos parciales | Task 2 (Steps 1, 4) |
| `questions.folder_id` `ON DELETE SET NULL` | Task 2 (Step 2) |
| `tenants.folders_seeded_at` | Task 2 (Steps 2, 5) |
| Migración `0022_*` revisada a mano | Task 2 (Step 4) |
| Siembra al vuelo con `SELECT … FOR UPDATE` | Task 2 (Steps 5, 7) |
| Forma del árbol sembrado (raíces por stage, cursos, temas) | Task 1 (Steps 6-9), Task 2 (Step 5) |
| Sufijo de grado espejo de `buildQuestionTree` | Task 1 (Steps 2-4) |
| `subtopics` NO se siembran | Task 1 (Step 8, docstring) |
| `GET /bank/folders` con conteos + `unfiledCount` | Task 2 |
| `POST /bank/folders` | Task 3 |
| `PATCH /bank/folders/:id` (renombrar y mover) | Task 4 |
| `DELETE /bank/folders/:id` con `{deletedFolders, unfiledQuestions}` | Task 5 |
| Borrado en transacción con `WITH RECURSIVE` | Task 5 (Step 3) |
| `GET /bank/questions?folderId=` con centrales por `topicId` | Task 6 |
| `?folderId=unfiled` | Task 6 |
| `GET /bank/questions/summary` no cambia | Task 6 (Step 4), Task 13 (Step 1) |
| `folderId` en las dos rutas de creación y en `PATCH :id` | Task 7 |
| Los 7 códigos de error | Tasks 2-7 (definidos en Task 2 Step 7, ejercitados en 3/4/5/6/7) |
| DTOs compartidos en `bank-folder.dto.ts` | Task 2 (Step 3) |
| `@angular/cdk@^22` | Task 8 (Step 1) |
| `ui-folder-tree` con `mode: 'browse' \| 'pick'` | Task 8 |
| A11y del CDK + `aria-label` en el toggle + F2/Delete | Task 8 (Steps 2, 5) |
| Nodo virtual "Sin carpeta", no editable | Task 9 (Step 3), Task 8 (test) |
| Conteo acumulado a la derecha del nombre | Task 9 (Step 3), Task 8 (template) |
| `BankFoldersStore` optimista + rollback | Task 9 |
| bank-list reemplaza el árbol Curso → Tema | Task 10 |
| Menú por carpeta + edición en línea | Task 8 (primitiva) + Task 10 (handlers) |
| Copy EXACTO del modal + "Cancelar"/"Quitar carpeta" | Task 10 (Steps 1, 4) |
| Banner post-borrado con enlace a "Sin carpeta" | Task 10 |
| Búsqueda por texto | Task 9 (`filterFolderTree`) + Task 10 |
| Selector de carpeta en el detalle, solo para preguntas propias | Task 11 |
| Campo Carpeta en bank-new (ambos tabs) | Task 12 |
| Prefill Curso/Tema + hint de desajuste | Task 12 |
| IA solo rellena cuando la carpeta no fijó | Task 12 (Step 3, el `sFolderId.set(this.pFolderId())`) |
| `folderId` en el guardado | Task 12 (Steps 3, 4) |
| `sessionStorage` recuerda la carpeta | Task 12 |
| Borrar `bank-question-tree.ts` y su spec | Task 13 |
| Tests API e2e listados en el spec | Tasks 2-7 |
| Tests unit API (árbol, conteos, sufijo) | Task 1 |
| Tests web listados en el spec | Tasks 8-12 |
| Pasada manual en navegador | Task 13 (Step 3) |
| Fuera de alcance (drag&drop, carpetas centrales, subtopics, compartir) | No hay tarea, correctamente |

Sin huecos.

**2. Placeholders.** Revisado: no hay "TBD", ni "similar a la Task N", ni "agregar validación apropiada". Cada paso de código trae el código. Los tres puntos donde el plan dice "verificar antes de escribir" son verificaciones REALES con comando y resultado esperado, no huecos: la superficie de `CdkTree` (Task 8 Step 1), las cláusulas `WHERE` de la migración generada (Task 2 Step 4), y los consumidores del árbol viejo (Task 13 Step 1). Los sitios donde el plan dice "buscarlo con `rg`" apuntan a código EXISTENTE que hay que localizar, no a código por inventar.

**3. Consistencia de tipos.** Verificado cruzando tareas:
- `FolderTreeNode` se declara una sola vez (Task 8, `ui/folder-tree/folder-tree.types.ts`) y la consumen Task 9 (`toFolderTreeNodes` la devuelve), Task 10 (`findTreeNode`, `pendingFolderDelete`) y Task 11/12 (picker). Campos idénticos en todos lados: `id`, `name`, `topicId`, `ownCount`, `centralCount`, `totalCount`, `editable`, `children`.
- `BankFolderNode` (wire) vive solo en `packages/shared` (Task 2) y la usan `assembleFolderTree` (Task 1/2), el store (Task 9) y `findFolderById` (Task 9).
- `UNFILED_FOLDER_ID` se define una vez (Task 2) y se usa en Task 6 (`resolveFolderScope`), Task 9 (`toFolderTreeNodes`), Task 10 (`goToUnfiled`), Task 11 (`saveQuestionFolder`) y Task 12 (`onFolderPicked`).
- `MAX_FOLDER_DEPTH` aparece en `packages/shared` (Task 2) y en `check-folder-move.ts` (Task 1). Son dos constantes con el mismo valor y dueños distintos a propósito: la del API es la regla que se aplica, la de shared es el contrato que la web muestra. El test `expect(MAX_FOLDER_DEPTH).toBe(6)` de la Task 1 fija la del API; si divergieran, ese test no lo vería — por eso el spec del dominio la pinea explícitamente y la de shared se documenta como el mismo número.
- `checkFolderMove` recibe siempre los cinco campos (`folderId`, `targetParentId`, `descendantIds`, `targetParentDepth`, `subtreeHeight`) en Task 3 (create, con `subtreeHeight: 1`) y Task 4 (move, con los valores del CTE).
- `bankFolderError(code)` toma un solo argumento en todos los sitios donde se llama (Tasks 2-7).
- `assertAssignableFolder(user, questionTenantId, folderId)` — tres argumentos, misma firma en `createImageQuestion`, `createStructuredQuestion` y `editQuestion` (Task 7).
- `SubmitStructuredParams.folderId` es `string | null` (requerido) en Task 12 y en las llamadas de `submitStructured`; `CreateImageQuestionPayload.folderId` es `string | null` opcional (Task 9) — asimetría deliberada: la cadena estructurada siempre lo pasa, la de imagen puede omitirlo.

**Un arreglo aplicado durante esta revisión:** la Task 1 Step 13 depende de `BankFolderNode`, que se crea en la Task 2 Step 3. En vez de dejarlo implícito, el paso ahora dice explícitamente que ese test queda rojo hasta entonces y ofrece adelantar el Step 3 (son interfaces sin lógica). Sin eso, quien ejecute la Task 1 aislada concluiría que su implementación está mal.
