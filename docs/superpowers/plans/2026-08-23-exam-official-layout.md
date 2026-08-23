# Exam Official Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El PDF generado deja de ser una lista plana barajada y pasa a la maqueta de los exámenes de admisión reales: pruebas, bloques con encabezado, y numeración que reinicia por prueba.

**Architecture:** Se agregan dos niveles de agrupación —sección (la prueba) y bloque (el grupo impreso, que abarca varios cursos)— como datos de la fila de blueprint. El shuffler pasa a recibir esa estructura y devuelve, además del orden plano de siempre, un `sectionLayout` que la versión congela. La plantilla Typst renderiza sección por sección, con el título fuera de las columnas y numeración que reinicia.

**Tech Stack:** NestJS, TypeScript, Drizzle ORM + Postgres, Typst (CLI), Jest.

**Spec:** `docs/superpowers/specs/2026-08-23-exam-official-layout-design.md`
**Research de respaldo:** `docs/research-official-exam-layout.md`

## Global Constraints

- **Modo TDD estricto activo.** Cada tarea escribe el test primero, lo corre para verlo fallar, implementa lo mínimo, lo corre para verlo pasar, y commitea. Sin excepciones.
- **Nunca hacer build.** No correr `pnpm build` ni `tsc` como paso de verificación; los tests son el gate.
- **Commits convencionales, sin `Co-Authored-By` ni atribución a IA.**
- **Comandos de test** (desde `apps/api/`):
  - Un spec unitario: `npx jest --selectProjects non-e2e <ruta relativa a apps/api>`
  - Suite e2e: `npx jest --selectProjects e2e --maxWorkers=4` (requiere Postgres real Y el binario `typst` en PATH)
- **Migraciones**: se generan con `pnpm --filter @exams-generator/api db:generate` (drizzle-kit lee `src/db/schema/*.ts` y escribe en `apps/api/drizzle/`). La última existente es `0019_translate_exam_type_labels.sql`, así que la nueva será `0020_*`. Se aplican con `pnpm --filter @exams-generator/api db:migrate`.
- **Un bloque NO es un curso.** Abarca varios cursos (UNI imprime "MATEMÁTICA" como un solo bloque de 40 que cubre Aritmética, Álgebra, Geometría y Trigonometría). Nunca derivar el bloque del `courseId`.
- **`section_layout` guarda `count`, nunca `questionIds`.** `questionOrder` es la única fuente del orden.
- **Las secciones nunca se barajan. Los bloques sí, pero solo dentro de su sección padre.**
- **Etiqueta vacía = sin encabezado.** Un bloque o sección con `label` vacío/ausente no emite encabezado. Así el preview de una sola pregunta y los exámenes preexistentes rinden igual que hoy.

---

### Task 1: Columnas de sección, bloque y orden en el schema

**Files:**
- Modify: `apps/api/src/db/schema/exam-blueprint-template-rows.schema.ts`
- Modify: `apps/api/src/db/schema/exams.schema.ts` (tablas `examBlueprintRows` y `examVersions`)
- Create: `apps/api/drizzle/0020_exam_section_block_layout.sql` (generado por drizzle-kit)
- Test: `apps/api/src/db/schema/exam-section-columns.spec.ts`

**Interfaces:**
- Consumes: nada.
- Produces: las columnas `sortOrder`, `blockCode`, `blockLabel`, `sectionCode`, `sectionLabel` en `examBlueprintRows`; `sortOrder`, `blockCode`, `blockLabel`, `sectionLabel` en `examBlueprintTemplateRows`; `sectionLayout` en `examVersions`. Las tareas 6 y 7 leen y escriben estas columnas.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/api/src/db/schema/exam-section-columns.spec.ts`:

```ts
import { getTableColumns } from "drizzle-orm";
import { examBlueprintRows, examVersions } from "./exams.schema";
import { examBlueprintTemplateRows } from "./exam-blueprint-template-rows.schema";

describe("columnas de maqueta oficial (spec §4)", () => {
  it("exam_blueprint_rows lleva orden, bloque y sección", () => {
    const columns = getTableColumns(examBlueprintRows);

    expect(columns.sortOrder.name).toBe("sort_order");
    expect(columns.sortOrder.notNull).toBe(true);
    expect(columns.blockCode.name).toBe("block_code");
    expect(columns.blockLabel.name).toBe("block_label");
    expect(columns.sectionCode.name).toBe("section_code");
    expect(columns.sectionLabel.name).toBe("section_label");
  });

  it("exam_blueprint_template_rows lleva orden y bloque (exam_section ya guardaba el código)", () => {
    const columns = getTableColumns(examBlueprintTemplateRows);

    expect(columns.sortOrder.name).toBe("sort_order");
    expect(columns.sortOrder.notNull).toBe(true);
    expect(columns.blockCode.name).toBe("block_code");
    expect(columns.blockLabel.name).toBe("block_label");
    expect(columns.blockQuestionCount.name).toBe("block_question_count");
    expect(columns.sectionLabel.name).toBe("section_label");
    expect(columns.examSection.name).toBe("exam_section");
  });

  it("exam_versions congela su estructura en section_layout", () => {
    const columns = getTableColumns(examVersions);

    expect(columns.sectionLayout.name).toBe("section_layout");
    expect(columns.sectionLayout.notNull).toBe(true);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx jest --selectProjects non-e2e src/db/schema/exam-section-columns.spec.ts`
Expected: FAIL — `Cannot read properties of undefined (reading 'name')` sobre `columns.sortOrder`.

- [ ] **Step 3: Agregar las columnas**

En `apps/api/src/db/schema/exam-blueprint-template-rows.schema.ts`, dentro del objeto de columnas, después de `sourceLevel`:

```ts
    /**
     * Orden canónico de la fila dentro de su plantilla — el orden en que la
     * universidad imprime los bloques y, dentro de un bloque, el orden en que
     * la fuente lista los cursos. Sin esto el orden oficial no es reproducible.
     */
    sortOrder: integer("sort_order").notNull().default(0),
    /**
     * El bloque IMPRESO al que pertenece esta fila. NO es el curso: la UNI
     * imprime "MATEMÁTICA" como un único bloque de 40 preguntas que cubre
     * Aritmética, Álgebra, Geometría y Trigonometría (spec §2.2). Varias filas
     * de cursos distintos comparten `block_code`.
     */
    blockCode: text("block_code"),
    blockLabel: text("block_label"),
    /**
     * Total OFICIAL de preguntas del bloque, cuando la universidad lo publica
     * (la UNI publica "40 preguntas de Matemática" y nada más). Es el mismo
     * valor repetido en todas las filas del bloque; se repite porque el bloque
     * no tiene tabla propia y no la merece por tres filas.
     *
     * Es una INVARIANTE, no un dato editable: el reparto entre cursos sí lo
     * ajusta la academia, pero su suma tiene que dar este número (spec §3.9).
     * `null` cuando la fuente no publica total de bloque.
     */
    blockQuestionCount: integer("block_question_count"),
    /**
     * Rótulo legible de la sección/prueba ("SEGUNDA PRUEBA — MATEMÁTICA").
     * `exam_section` ya guardaba el código ("E2") y deja de ser decorativo.
     */
    sectionLabel: text("section_label"),
```

En `apps/api/src/db/schema/exams.schema.ts`, dentro de `examBlueprintRows`, después de `count`:

```ts
    /** Orden de la fila dentro del examen. Manual: el índice de la fila en el builder. */
    sortOrder: integer("sort_order").notNull().default(0),
    /** Bloque impreso — copiado de la plantilla, o el nombre del curso en un examen manual. */
    blockCode: text("block_code"),
    blockLabel: text("block_label"),
    /** Sección/prueba — `null` en un examen manual, que tiene una sola sección sin rótulo. */
    sectionCode: text("section_code"),
    sectionLabel: text("section_label"),
```

En el mismo archivo, dentro de `examVersions`, después de `answerKey`:

```ts
    /**
     * Estructura impresa congelada de ESTA forma (spec §3.5): las secciones en
     * su orden canónico y, dentro de cada una, los bloques en el orden barajado
     * que le tocó a esta versión. Guarda `count` y NUNCA `questionIds` —
     * `question_order` es la única fuente del orden, así no hay dos copias del
     * mismo dato que se puedan desincronizar (spec §3.6).
     *
     * `[]` en versiones generadas antes de esta feature: el renderizador lo
     * trata como una sección sin rótulo con un bloque sin rótulo, así que esas
     * versiones siguen produciendo el PDF idéntico.
     */
    sectionLayout: jsonb("section_layout").notNull().default([]),
```

`integer`, `text` y `jsonb` ya están importados en ambos archivos; verificar y agregar al `import` de `drizzle-orm/pg-core` lo que falte.

- [ ] **Step 4: Correr el test para verlo pasar**

Run: `npx jest --selectProjects non-e2e src/db/schema/exam-section-columns.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Generar la migración**

Run: `pnpm --filter @exams-generator/api db:generate`
Expected: aparece `apps/api/drizzle/0020_*.sql` con los `ALTER TABLE ... ADD COLUMN` de las tres tablas, y `apps/api/drizzle/meta/_journal.json` actualizado.

- [ ] **Step 6: Agregar el backfill de `sort_order` al final de la migración generada**

Abrir el `0020_*.sql` recién generado y anexar al final:

```sql
--> statement-breakpoint
-- Backfill: las filas preexistentes no tienen orden. Se les asigna uno estable
-- por `id` dentro de cada examen/plantilla. Es arbitrario pero determinista, y
-- preserva la agrupación (las filas del mismo examen quedan juntas y ordenadas).
UPDATE "exam_blueprint_rows" AS r
SET "sort_order" = numbered.rn
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "exam_id" ORDER BY "id") - 1) AS rn
  FROM "exam_blueprint_rows"
) AS numbered
WHERE r."id" = numbered."id";
--> statement-breakpoint
UPDATE "exam_blueprint_template_rows" AS r
SET "sort_order" = numbered.rn
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "template_id" ORDER BY "id") - 1) AS rn
  FROM "exam_blueprint_template_rows"
) AS numbered
WHERE r."id" = numbered."id";
```

No hace falta backfill de `section_layout`: su default `[]` ya es el valor correcto (ver el comentario de la columna).

- [ ] **Step 7: Aplicar la migración y confirmar que la suite sigue verde**

Run: `pnpm --filter @exams-generator/api db:migrate`
Expected: aplica `0020` sin error.

Run: `npx jest --selectProjects non-e2e src/db`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/schema apps/api/drizzle
git commit -m "feat(exams): add section, block and order columns to the blueprint schema"
```

---

### Task 2: Dominio puro — agrupar preguntas en secciones y bloques

**Files:**
- Create: `apps/api/src/modules/exams/domain/exam-sections.ts`
- Modify: `apps/api/src/modules/exams/domain/version-shuffler.ts` (solo agregar tipos exportados, sin tocar `buildVersions` todavía)
- Test: `apps/api/src/modules/exams/domain/exam-sections.spec.ts`

**Interfaces:**
- Consumes: `SelectedQuestion` de `version-shuffler.ts`.
- Produces:
  - En `version-shuffler.ts`: `SelectionBlock`, `SelectionSection`, `SectionBlockLayout`, `SectionLayoutEntry`, `SectionLayout`.
  - En `exam-sections.ts`: `QuestionPlacement` y `groupIntoSections(placements: readonly QuestionPlacement[]): SelectionSection[]`.
  - La Task 3 consume `SelectionSection` y produce `SectionLayout`; la Task 8 consume `groupIntoSections`.

- [ ] **Step 1: Escribir el test que falla**

Crear `apps/api/src/modules/exams/domain/exam-sections.spec.ts`:

```ts
import { groupIntoSections, QuestionPlacement } from "./exam-sections";
import { SelectedQuestion } from "./version-shuffler";

const question = (id: string): SelectedQuestion => ({ questionId: id, correctAnswer: "A" });

const placement = (
  id: string,
  sortOrder: number,
  blockLabel: string,
  sectionCode: string | null = null,
  sectionLabel: string | null = null,
): QuestionPlacement => ({
  question: question(id),
  sortOrder,
  blockLabel,
  sectionCode,
  sectionLabel,
});

describe("groupIntoSections", () => {
  it("agrupa por bloque respetando el orden de sortOrder", () => {
    const sections = groupIntoSections([
      placement("q3", 1, "ÁLGEBRA"),
      placement("q1", 0, "ARITMÉTICA"),
      placement("q2", 0, "ARITMÉTICA"),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].code).toBeNull();
    expect(sections[0].label).toBeNull();
    expect(sections[0].blocks.map((b) => b.label)).toEqual(["ARITMÉTICA", "ÁLGEBRA"]);
    expect(sections[0].blocks[0].questions.map((q) => q.questionId)).toEqual(["q1", "q2"]);
    expect(sections[0].blocks[1].questions.map((q) => q.questionId)).toEqual(["q3"]);
  });

  it("un bloque abarca varios cursos: filas distintas con el mismo blockLabel caen en el mismo bloque", () => {
    const sections = groupIntoSections([
      placement("q1", 0, "MATEMÁTICA", "E2", "SEGUNDA PRUEBA"),
      placement("q2", 1, "MATEMÁTICA", "E2", "SEGUNDA PRUEBA"),
      placement("q3", 2, "MATEMÁTICA", "E2", "SEGUNDA PRUEBA"),
    ]);

    expect(sections[0].blocks).toHaveLength(1);
    expect(sections[0].blocks[0].questions.map((q) => q.questionId)).toEqual(["q1", "q2", "q3"]);
  });

  it("separa secciones y las devuelve en orden canónico de sortOrder", () => {
    const sections = groupIntoSections([
      placement("q5", 10, "FÍSICA", "E3", "TERCERA PRUEBA"),
      placement("q1", 0, "RAZ. MATEMÁTICO", "E1", "PRIMERA PRUEBA"),
      placement("q3", 5, "MATEMÁTICA", "E2", "SEGUNDA PRUEBA"),
    ]);

    expect(sections.map((s) => s.code)).toEqual(["E1", "E2", "E3"]);
    expect(sections.map((s) => s.label)).toEqual([
      "PRIMERA PRUEBA",
      "SEGUNDA PRUEBA",
      "TERCERA PRUEBA",
    ]);
  });

  it("filas del mismo bloque que quedaron separadas por sortOrder se fusionan en un solo bloque", () => {
    const sections = groupIntoSections([
      placement("q1", 0, "ARITMÉTICA"),
      placement("q2", 1, "ÁLGEBRA"),
      placement("q3", 2, "ARITMÉTICA"),
    ]);

    expect(sections[0].blocks.map((b) => b.label)).toEqual(["ARITMÉTICA", "ÁLGEBRA"]);
    expect(sections[0].blocks[0].questions.map((q) => q.questionId)).toEqual(["q1", "q3"]);
  });

  it("devuelve lista vacía sin placements", () => {
    expect(groupIntoSections([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/domain/exam-sections.spec.ts`
Expected: FAIL — `Cannot find module './exam-sections'`.

- [ ] **Step 3: Agregar los tipos a `version-shuffler.ts`**

En `apps/api/src/modules/exams/domain/version-shuffler.ts`, justo antes de la interfaz `Version`, agregar:

```ts
/**
 * Un bloque IMPRESO del cuadernillo. `label` vacío significa "sin encabezado"
 * (el caso del preview de una sola pregunta y el de las versiones generadas
 * antes de esta feature).
 *
 * Un bloque NO es un curso: la UNI imprime "MATEMÁTICA" como un solo bloque de
 * 40 preguntas que cubre Aritmética, Álgebra, Geometría y Trigonometría
 * (spec §2.2). Las preguntas de los distintos cursos se mezclan libremente
 * dentro del bloque, que es lo que hace el cuadernillo real.
 */
export interface SelectionBlock {
  readonly label: string;
  readonly questions: readonly SelectedQuestion[];
}

/**
 * Una sección del cuadernillo — la "prueba" en el vocabulario de la UNI (E1/E2/E3),
 * el área curricular en el de la UNCP. `code`/`label` en `null` = examen manual,
 * que tiene una sola sección sin rótulo.
 *
 * La numeración impresa reinicia en cada sección.
 */
export interface SelectionSection {
  readonly code: string | null;
  readonly label: string | null;
  readonly blocks: readonly SelectionBlock[];
}

/** Un bloque dentro del layout congelado de una versión: rótulo + cuántas preguntas ocupa. */
export interface SectionBlockLayout {
  readonly label: string;
  readonly count: number;
}

export interface SectionLayoutEntry {
  readonly code: string | null;
  readonly label: string | null;
  readonly blocks: readonly SectionBlockLayout[];
}

/**
 * La estructura impresa congelada de una versión. Guarda `count` y NUNCA
 * `questionIds`: `questionOrder` es la única fuente del orden, y los `count`
 * solo aportan dónde cortar (spec §3.6).
 *
 * INVARIANTE: la suma de todos los `count` es igual al largo de `questionOrder`.
 */
export type SectionLayout = readonly SectionLayoutEntry[];
```

- [ ] **Step 4: Escribir `exam-sections.ts`**

Crear `apps/api/src/modules/exams/domain/exam-sections.ts`:

```ts
import { SelectedQuestion, SelectionBlock, SelectionSection } from "./version-shuffler";

/**
 * Una pregunta seleccionada junto con dónde le toca imprimirse. Sale de cruzar
 * `exam_questions` con su `exam_blueprint_rows` (Task 7).
 */
export interface QuestionPlacement {
  readonly question: SelectedQuestion;
  readonly sortOrder: number;
  readonly blockLabel: string;
  readonly sectionCode: string | null;
  readonly sectionLabel: string | null;
}

/**
 * Agrupa las preguntas seleccionadas en la estructura impresa: secciones en el
 * orden canónico que dicta `sortOrder`, y dentro de cada una, bloques en su
 * orden de primera aparición.
 *
 * Función pura, sin I/O — el orden de bloques que se IMPRIME lo decide después
 * `buildVersions`, que los baraja por versión (spec §3.4). Acá solo se
 * establece el orden canónico.
 *
 * Dos filas del mismo bloque separadas por una fila de otro bloque se FUSIONAN
 * en un solo bloque, en la posición de la primera. Que las filas de un bloque
 * queden contiguas es responsabilidad de quien arma el blueprint; acá se
 * prefiere fusionar antes que imprimir el mismo encabezado dos veces.
 */
export function groupIntoSections(placements: readonly QuestionPlacement[]): SelectionSection[] {
  const ordered = [...placements].sort((a, b) => a.sortOrder - b.sortOrder);

  const sectionsByKey = new Map<
    string,
    { code: string | null; label: string | null; blocks: Map<string, SelectedQuestion[]> }
  >();

  for (const placement of ordered) {
    const sectionKey = placement.sectionCode ?? "";
    let section = sectionsByKey.get(sectionKey);
    if (!section) {
      section = { code: placement.sectionCode, label: placement.sectionLabel, blocks: new Map() };
      sectionsByKey.set(sectionKey, section);
    }

    let block = section.blocks.get(placement.blockLabel);
    if (!block) {
      block = [];
      section.blocks.set(placement.blockLabel, block);
    }
    block.push(placement.question);
  }

  return [...sectionsByKey.values()].map((section) => ({
    code: section.code,
    label: section.label,
    blocks: [...section.blocks.entries()].map(
      ([label, questions]): SelectionBlock => ({ label, questions }),
    ),
  }));
}
```

`Map` preserva el orden de inserción, y la inserción va en orden de `sortOrder` — de ahí sale el orden canónico de secciones y bloques sin ordenamiento extra.

- [ ] **Step 5: Correr el test para verlo pasar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/domain/exam-sections.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/exams/domain/exam-sections.ts apps/api/src/modules/exams/domain/exam-sections.spec.ts apps/api/src/modules/exams/domain/version-shuffler.ts
git commit -m "feat(exams): group selected questions into printed sections and blocks"
```

---

### Task 3: Shuffler consciente de secciones

**Files:**
- Modify: `apps/api/src/modules/exams/domain/version-shuffler.ts:100-156` (`buildVersions`) y la interfaz `Version`
- Test: `apps/api/src/modules/exams/domain/version-shuffler.spec.ts`

**Interfaces:**
- Consumes: `SelectionSection`, `SelectionBlock`, `SectionLayout` (Task 2).
- Produces: `buildVersions(sections: readonly SelectionSection[], versionCount: number, rng: Rng): Version[]`, con `Version` ganando `readonly sectionLayout: SectionLayout`. La Task 8 lo llama; las Tasks 4 y 5 consumen el `sectionLayout` resultante.

- [ ] **Step 1: Adaptar los tests existentes a la nueva firma**

Los 13 tests de `version-shuffler.spec.ts` pasan `SelectedQuestion[]` plano. Agregar arriba del `describe` un helper que envuelve, y reemplazar cada llamada `buildVersions(selected, n, rng)` por `buildVersions(oneBlock(selected), n, rng)`:

```ts
import {
  buildVersions,
  SelectedQuestion,
  SelectedStructuredQuestion,
  SelectionSection,
} from "./version-shuffler";

/** Envuelve una selección plana en la forma mínima: una sección sin rótulo, un bloque sin rótulo. */
const oneBlock = (questions: readonly SelectedQuestion[]): SelectionSection[] => [
  { code: null, label: null, blocks: [{ label: "", questions }] },
];
```

No cambiar ninguna aserción de esos 13 tests: sus invariantes (la clave sigue al contenido, `questionOrder` es una biyección, etc.) tienen que seguir valiendo tal cual.

- [ ] **Step 2: Escribir los tests nuevos**

Agregar al final del `describe("buildVersions", ...)`:

```ts
  const q = (id: string): SelectedQuestion => ({ questionId: id, correctAnswer: "A" });

  const twoSections = (): SelectionSection[] => [
    {
      code: "E1",
      label: "PRIMERA PRUEBA",
      blocks: [
        { label: "RAZ. MATEMÁTICO", questions: [q("rm1"), q("rm2"), q("rm3")] },
        { label: "RAZ. VERBAL", questions: [q("rv1"), q("rv2")] },
      ],
    },
    {
      code: "E2",
      label: "SEGUNDA PRUEBA",
      blocks: [{ label: "MATEMÁTICA", questions: [q("m1"), q("m2")] }],
    },
  ];

  it("MUST: las preguntas de un mismo bloque quedan contiguas en questionOrder", () => {
    const versions = buildVersions(twoSections(), 5, createSeededRng(7));

    const blockOf = new Map<string, string>([
      ["rm1", "RM"], ["rm2", "RM"], ["rm3", "RM"],
      ["rv1", "RV"], ["rv2", "RV"],
      ["m1", "MAT"], ["m2", "MAT"],
    ]);

    for (const version of versions) {
      const labels = version.questionOrder.map((id) => blockOf.get(id)!);
      const runs = labels.filter((label, index) => label !== labels[index - 1]);
      expect(new Set(runs).size).toBe(runs.length); // ningún bloque aparece en dos tramos
    }
  });

  it("MUST: ninguna pregunta cruza de sección", () => {
    const versions = buildVersions(twoSections(), 5, createSeededRng(11));

    for (const version of versions) {
      const firstSectionCount = version.sectionLayout[0].blocks.reduce((sum, b) => sum + b.count, 0);
      const printedFirst = version.questionOrder.slice(0, firstSectionCount);
      const printedSecond = version.questionOrder.slice(firstSectionCount);

      expect(printedFirst.every((id) => id.startsWith("rm") || id.startsWith("rv"))).toBe(true);
      expect(printedSecond.every((id) => id.startsWith("m"))).toBe(true);
    }
  });

  it("MUST: las secciones se mantienen siempre en su orden canónico", () => {
    const versions = buildVersions(twoSections(), 8, createSeededRng(3));

    for (const version of versions) {
      expect(version.sectionLayout.map((s) => s.code)).toEqual(["E1", "E2"]);
      expect(version.sectionLayout.map((s) => s.label)).toEqual([
        "PRIMERA PRUEBA",
        "SEGUNDA PRUEBA",
      ]);
    }
  });

  it("el orden de los bloques varía entre versiones cuando la sección tiene dos o más", () => {
    const versions = buildVersions(twoSections(), 12, createSeededRng(5));

    const firstSectionBlockOrders = new Set(
      versions.map((v) => v.sectionLayout[0].blocks.map((b) => b.label).join("|")),
    );

    expect(firstSectionBlockOrders.size).toBeGreaterThan(1);
  });

  it("INVARIANTE: la suma de los count del layout es igual al largo de questionOrder", () => {
    const versions = buildVersions(twoSections(), 6, createSeededRng(9));

    for (const version of versions) {
      const total = version.sectionLayout.reduce(
        (sum, section) => sum + section.blocks.reduce((acc, block) => acc + block.count, 0),
        0,
      );
      expect(total).toBe(version.questionOrder.length);
    }
  });

  it("una sección sin rótulo con un bloque sin rótulo produce el layout mínimo", () => {
    const versions = buildVersions(oneBlock([q("a"), q("b")]), 1, createSeededRng(1));

    expect(versions[0].sectionLayout).toEqual([
      { code: null, label: null, blocks: [{ label: "", count: 2 }] },
    ]);
  });
```

- [ ] **Step 3: Correr los tests para verlos fallar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/domain/version-shuffler.spec.ts`
Expected: FAIL — errores de tipo por la firma nueva y `version.sectionLayout` indefinido.

- [ ] **Step 4: Agregar `sectionLayout` a `Version`**

En `apps/api/src/modules/exams/domain/version-shuffler.ts`, dentro de `export interface Version`, después de `shuffledAlternativeImages`:

```ts
  /**
   * La estructura impresa de ESTA forma: secciones en orden canónico, bloques
   * en el orden barajado que le tocó. Es dato de la versión y no del examen,
   * justamente porque el orden de bloques cambia por versión (spec §3.5).
   */
  readonly sectionLayout: SectionLayout;
```

- [ ] **Step 5: Reescribir `buildVersions`**

Reemplazar el cuerpo de `buildVersions` (líneas 100-156) por:

```ts
export function buildVersions(
  sections: readonly SelectionSection[],
  versionCount: number,
  rng: Rng,
): Version[] {
  const allQuestions = sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.questions),
  );
  if (allQuestions.length === 0) {
    return [];
  }

  const questionById = new Map(allQuestions.map((q) => [q.questionId, q]));
  const seenOrders = new Set<string>();
  const versions: Version[] = [];

  for (let versionIndex = 0; versionIndex < versionCount; versionIndex++) {
    let laidOut = layOutOneVersion(sections, rng);
    let attempts = 0;
    while (
      seenOrders.has(laidOut.questionOrder.join("|")) &&
      attempts < MAX_DISTINCTNESS_RETRIES
    ) {
      laidOut = layOutOneVersion(sections, rng);
      attempts++;
    }
    seenOrders.add(laidOut.questionOrder.join("|"));

    const answerKey: Record<number, string> = {};
    const shuffledAlternatives: Record<string, readonly string[]> = {};
    const shuffledAlternativeImages: Record<
      string,
      readonly ({ storageKey: string; mime: string } | null)[]
    > = {};

    laidOut.questionOrder.forEach((questionId, position) => {
      const question = questionById.get(questionId)!;
      if (question.type === "structured") {
        const { alternatives, answerLetter, alternativeImages } = shuffleStructuredAlternatives(
          question,
          rng,
        );
        shuffledAlternatives[questionId] = alternatives;
        answerKey[position] = answerLetter;
        if (alternativeImages) {
          shuffledAlternativeImages[questionId] = alternativeImages;
        }
      } else {
        answerKey[position] = question.correctAnswer;
      }
    });

    versions.push({
      code: versionCodeFor(versionIndex),
      questionOrder: laidOut.questionOrder,
      answerKey,
      shuffledAlternatives,
      shuffledAlternativeImages,
      sectionLayout: laidOut.sectionLayout,
    });
  }

  return versions;
}

/**
 * Una pasada de maquetación: las SECCIONES se recorren en su orden canónico y
 * NUNCA se permutan —una pregunta de Química no puede caer en la prueba de
 * Matemática—; dentro de cada sección se permuta el orden de los BLOQUES
 * (anti-copia, spec §3.4) y dentro de cada bloque se permutan sus preguntas,
 * mezclando cursos y niveles como hace el cuadernillo real.
 */
function layOutOneVersion(
  sections: readonly SelectionSection[],
  rng: Rng,
): { questionOrder: string[]; sectionLayout: SectionLayoutEntry[] } {
  const questionOrder: string[] = [];
  const sectionLayout: SectionLayoutEntry[] = [];

  for (const section of sections) {
    const blocks = shuffleArray([...section.blocks], rng);
    const blockLayout: SectionBlockLayout[] = [];

    for (const block of blocks) {
      const ids = shuffleArray(
        block.questions.map((question) => question.questionId),
        rng,
      );
      questionOrder.push(...ids);
      blockLayout.push({ label: block.label, count: ids.length });
    }

    sectionLayout.push({ code: section.code, label: section.label, blocks: blockLayout });
  }

  return { questionOrder, sectionLayout };
}
```

- [ ] **Step 6: Correr los tests para verlos pasar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/domain/version-shuffler.spec.ts`
Expected: PASS — los 13 originales más los 6 nuevos.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/exams/domain/version-shuffler.ts apps/api/src/modules/exams/domain/version-shuffler.spec.ts
git commit -m "feat(exams): shuffle blocks within their section instead of the whole exam"
```

---

### Task 4: Puerto del PDF y plantilla Typst del cuadernillo

**Files:**
- Modify: `apps/api/src/modules/exams/domain/ports/pdf-compiler.port.ts:37-42` (`ExamPdfDocumentInput`)
- Modify: `apps/api/src/modules/exams/adapters/pdf/typst-template.ts:16-31` (`renderExamTypst`)
- Test: `apps/api/src/modules/exams/adapters/pdf/typst-template.spec.ts`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: `ExamPdfBlock`, `ExamPdfSection`, y `ExamPdfDocumentInput` con `readonly sections: readonly ExamPdfSection[]` en lugar de `questions`. Las Tasks 8 y 9 arman ese input.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `apps/api/src/modules/exams/adapters/pdf/typst-template.spec.ts` un `describe` nuevo:

```ts
import { renderExamTypst } from "./typst-template";
import { ExamPdfDocumentInput } from "../../domain/ports/pdf-compiler.port";

describe("renderExamTypst — maqueta oficial", () => {
  const structured = (id: string, body: string) =>
    ({ id, type: "structured", bodyTypst: body, alternatives: ["uno", "dos"] }) as const;

  const twoSectionInput = (): ExamPdfDocumentInput => ({
    title: "ETA UNI",
    versionLabel: "Forma A",
    sections: [
      {
        code: "E1",
        label: "PRIMERA PRUEBA",
        blocks: [
          { label: "RAZ. MATEMÁTICO", questions: [structured("a", "ra"), structured("b", "rb")] },
          { label: "RAZ. VERBAL", questions: [structured("c", "rc")] },
        ],
      },
      {
        code: "E2",
        label: "SEGUNDA PRUEBA",
        blocks: [{ label: "MATEMÁTICA", questions: [structured("d", "rd")] }],
      },
    ],
  });

  it("emite el título de cada sección", () => {
    const source = renderExamTypst(twoSectionInput());

    expect(source).toContain("PRIMERA PRUEBA");
    expect(source).toContain("SEGUNDA PRUEBA");
  });

  it("emite el encabezado de cada bloque", () => {
    const source = renderExamTypst(twoSectionInput());

    expect(source).toContain("RAZ. MATEMÁTICO");
    expect(source).toContain("RAZ. VERBAL");
    expect(source).toContain("MATEMÁTICA");
  });

  it("el título de sección va FUERA de las columnas, para ocupar el ancho completo", () => {
    const source = renderExamTypst(twoSectionInput());

    const headingIndex = source.indexOf("PRIMERA PRUEBA");
    const columnsIndex = source.indexOf("#columns(2)");

    expect(headingIndex).toBeGreaterThan(-1);
    expect(columnsIndex).toBeGreaterThan(headingIndex);
    expect(source).not.toContain("columns: 2");
  });

  it("mete un salto de página entre secciones, pero no antes de la primera", () => {
    const source = renderExamTypst(twoSectionInput());

    expect(source.split("#pagebreak()")).toHaveLength(2);
    expect(source.indexOf("#pagebreak()")).toBeGreaterThan(source.indexOf("PRIMERA PRUEBA"));
  });

  it("MUST: la numeración reinicia en cada sección", () => {
    const source = renderExamTypst(twoSectionInput());

    // E1 numera 1,2,3 y E2 vuelve a empezar en 1.
    expect(source).toContain("*1.* ra");
    expect(source).toContain("*2.* rb");
    expect(source).toContain("*3.* rc");
    expect(source).toContain("*1.* rd");
  });

  it("una sección sin rótulo con un bloque sin rótulo no emite encabezados ni salto de página", () => {
    const source = renderExamTypst({
      title: "Vista previa",
      versionLabel: "preview",
      sections: [{ code: null, label: null, blocks: [{ label: "", questions: [structured("x", "rx")] }] }],
    });

    expect(source).not.toContain("#pagebreak()");
    expect(source).toContain("*1.* rx");
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/adapters/pdf/typst-template.spec.ts`
Expected: FAIL — error de tipo: `sections` no existe en `ExamPdfDocumentInput`.

- [ ] **Step 3: Cambiar el puerto**

En `apps/api/src/modules/exams/domain/ports/pdf-compiler.port.ts`, reemplazar `ExamPdfDocumentInput` por:

```ts
/**
 * Un bloque impreso del cuadernillo. `label` vacío = sin encabezado (el preview
 * de una sola pregunta, y las versiones generadas antes de la maqueta oficial).
 *
 * Un bloque abarca varios cursos por definición — la UNI imprime "MATEMÁTICA"
 * como un solo bloque de 40 preguntas (spec §2.2).
 */
export interface ExamPdfBlock {
  readonly label: string;
  readonly questions: readonly ExamPdfQuestion[];
}

/**
 * Una sección del cuadernillo — la "prueba" (E1/E2/E3) en la UNI, el área
 * curricular en la UNCP. `label` ausente/null = sin rótulo ni salto de página.
 * La numeración impresa reinicia en cada sección.
 */
export interface ExamPdfSection {
  readonly code?: string | null;
  readonly label?: string | null;
  readonly blocks: readonly ExamPdfBlock[];
}

export interface ExamPdfDocumentInput {
  readonly title: string;
  readonly versionLabel: string;
  readonly tenantLogoAbsolutePath?: string;
  readonly sections: readonly ExamPdfSection[];
}
```

- [ ] **Step 4: Reescribir `renderExamTypst`**

En `apps/api/src/modules/exams/adapters/pdf/typst-template.ts`, reemplazar `renderExamTypst` (líneas 16-31) por:

```ts
export function renderExamTypst(input: ExamPdfDocumentInput): string {
  const logoBlock = input.tenantLogoAbsolutePath
    ? `#image("${input.tenantLogoAbsolutePath}", width: 3cm)\n\n`
    : "";

  const sectionBlocks = input.sections
    .map((section, sectionIndex) => renderSection(section, sectionIndex))
    .join("\n\n");

  // `#set page(columns: 2)` haría que TODO el documento viva dentro de dos
  // columnas, y ahí un encabezado no puede ocupar el ancho completo de la
  // página. Con `#columns(2)[...]` por sección, el título de la prueba queda
  // afuera, a ancho completo, como en el cuadernillo real (spec §6.2).
  return `#set page(margin: 1.5cm)
#set text(size: 10pt)

${logoBlock}#align(center)[= ${input.title} --- ${input.versionLabel}]

${sectionBlocks}
`;
}

function renderSection(section: ExamPdfSection, sectionIndex: number): string {
  const pageBreak = sectionIndex > 0 ? "#pagebreak()\n\n" : "";
  const heading = section.label ? `#align(center)[== ${section.label}]\n\n` : "";

  // La numeración reinicia en cada sección: el contador vive acá adentro.
  let number = 0;
  const body = section.blocks
    .map((block) => {
      const blockHeading = block.label ? `*${block.label}*\n\n` : "";
      const questions = block.questions
        .map((question) => renderQuestionBlock(question, ++number))
        .join("\n\n");
      return `${blockHeading}${questions}`;
    })
    .join("\n\n");

  return `${pageBreak}${heading}#columns(2)[
${body}
]`;
}
```

Agregar `ExamPdfSection` al `import` de `../../domain/ports/pdf-compiler.port` que ya existe al principio del archivo.

- [ ] **Step 5: Correr los tests para verlos pasar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/adapters/pdf/typst-template.spec.ts`
Expected: FAIL todavía en los tests VIEJOS del archivo, que arman `questions` a nivel raíz.

- [ ] **Step 6: Adaptar los tests viejos del mismo archivo**

Cada input viejo con `questions: [...]` pasa a `sections: [{ code: null, label: null, blocks: [{ label: "", questions: [...] }] }]`. Ninguna aserción sobre el contenido de una pregunta cambia — solo el envoltorio del input.

- [ ] **Step 7: Correr los tests para verlos pasar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/adapters/pdf/typst-template.spec.ts`
Expected: PASS (los viejos adaptados más los 6 nuevos).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/exams/domain/ports/pdf-compiler.port.ts apps/api/src/modules/exams/adapters/pdf/typst-template.ts apps/api/src/modules/exams/adapters/pdf/typst-template.spec.ts
git commit -m "feat(exams): render the exam booklet as sections with block headings"
```

---

### Task 5: Clave de respuestas agrupada por sección

**Files:**
- Modify: `apps/api/src/modules/exams/domain/ports/pdf-compiler.port.ts` (`AnswerKeyDocumentInput`)
- Modify: `apps/api/src/modules/exams/adapters/pdf/typst-template.ts:79-99` (`renderAnswerKeyTypst`)
- Test: `apps/api/src/modules/exams/adapters/pdf/typst-template.spec.ts`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces: `AnswerKeySection` y `AnswerKeyDocumentInput` con `readonly sections: readonly AnswerKeySection[]` en lugar de `entries`. La Task 8 arma ese input.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `apps/api/src/modules/exams/adapters/pdf/typst-template.spec.ts`:

```ts
import { renderAnswerKeyTypst } from "./typst-template";
import { AnswerKeyDocumentInput } from "../../domain/ports/pdf-compiler.port";

describe("renderAnswerKeyTypst — numeración local por sección", () => {
  const input = (): AnswerKeyDocumentInput => ({
    title: "ETA UNI",
    versionLabel: "Forma A",
    sections: [
      {
        label: "PRIMERA PRUEBA",
        entries: [
          { questionId: "a", correctOption: "C" },
          { questionId: "b", correctOption: "A" },
        ],
      },
      {
        label: "SEGUNDA PRUEBA",
        entries: [{ questionId: "c", correctOption: "E" }],
      },
    ],
  });

  it("MUST: la numeración reinicia por sección, igual que en el cuadernillo", () => {
    const source = renderAnswerKeyTypst(input());

    expect(source).toContain("[1], [C],");
    expect(source).toContain("[2], [A],");
    // La tercera pregunta del examen es la 1 de la segunda prueba, no la 3.
    expect(source).toContain("[1], [E],");
    expect(source).not.toContain("[3], [E],");
  });

  it("rotula cada sección de la clave", () => {
    const source = renderAnswerKeyTypst(input());

    expect(source).toContain("PRIMERA PRUEBA");
    expect(source).toContain("SEGUNDA PRUEBA");
  });

  it("mantiene el marcador // q:{id} de cada entrada", () => {
    const source = renderAnswerKeyTypst(input());

    expect(source).toContain("// q:a");
    expect(source).toContain("// q:c");
  });

  it("una sección sin rótulo no emite encabezado", () => {
    const source = renderAnswerKeyTypst({
      title: "Repaso",
      versionLabel: "Forma A",
      sections: [{ label: null, entries: [{ questionId: "x", correctOption: "B" }] }],
    });

    expect(source).toContain("[1], [B],");
    expect(source).toContain("Clave de respuestas");
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/adapters/pdf/typst-template.spec.ts -t "numeración local"`
Expected: FAIL — error de tipo: `sections` no existe en `AnswerKeyDocumentInput`.

- [ ] **Step 3: Cambiar el puerto**

En `apps/api/src/modules/exams/domain/ports/pdf-compiler.port.ts`, reemplazar `AnswerKeyDocumentInput` por:

```ts
/**
 * Un tramo de la clave que corresponde a una sección del cuadernillo. Su
 * numeración es LOCAL: si el cuadernillo dice "14", la clave tiene que decir
 * "14", no la posición global de esa pregunta en el examen (spec §6.3).
 */
export interface AnswerKeySection {
  readonly label?: string | null;
  readonly entries: readonly AnswerKeyEntry[];
}

export interface AnswerKeyDocumentInput {
  readonly title: string;
  readonly versionLabel: string;
  readonly sections: readonly AnswerKeySection[];
}
```

- [ ] **Step 4: Reescribir `renderAnswerKeyTypst`**

Reemplazar la función entera (líneas 79-99 de `typst-template.ts`) por:

```ts
export function renderAnswerKeyTypst(input: AnswerKeyDocumentInput): string {
  // La celda impresa es la posición de la pregunta DENTRO DE SU SECCIÓN, que es
  // exactamente el `*N.*` que `renderSection` imprime en el cuadernillo — un
  // profesor corrige contra "14 -> C" y no puede hacer nada con un uuid ni con
  // una posición global que el cuadernillo nunca muestra. El id sigue viviendo
  // en el marcador `// q:`, que es lo que lee `typst-error-mapper.ts` y no se
  // ve en el PDF.
  const sections = input.sections
    .map((section) => {
      const heading = section.label ? `#align(center)[== ${section.label}]\n\n` : "";
      const rows = section.entries
        .map(
          (entry, index) => `// q:${entry.questionId}\n  [${index + 1}], [${entry.correctOption}],`,
        )
        .join("\n");

      return `${heading}#table(
  columns: 2,
  [Pregunta], [Respuesta],
${rows}
)`;
    })
    .join("\n\n");

  return `#align(center)[= ${input.title} --- ${input.versionLabel} --- Clave de respuestas]

${sections}
`;
}
```

Agregar `AnswerKeySection` al `import` del puerto.

- [ ] **Step 5: Correr los tests para verlos pasar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/adapters/pdf/typst-template.spec.ts`
Expected: PASS. Adaptar cualquier test viejo de `renderAnswerKeyTypst` que todavía pase `entries` a nivel raíz, envolviéndolo en `sections: [{ label: null, entries: [...] }]`.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/exams/domain/ports/pdf-compiler.port.ts apps/api/src/modules/exams/adapters/pdf/typst-template.ts apps/api/src/modules/exams/adapters/pdf/typst-template.spec.ts
git commit -m "feat(exams): number the answer key per section, matching the booklet"
```

---

### Task 6: El resolver propaga sección, bloque y orden

**Files:**
- Modify: `apps/api/src/modules/exams/domain/resolve-blueprint.ts:5-11` (`TemplateRow`) y el cuerpo de `resolveBlueprint`
- Modify: `apps/api/src/modules/exams/domain/blueprint-selector.ts:21-26` (`BlueprintRow`)
- Test: `apps/api/src/modules/exams/domain/resolve-blueprint.spec.ts`

**Interfaces:**
- Consumes: las columnas de la Task 1.
- Produces: `BlueprintRow` con `readonly sortOrder: number`, `readonly blockCode?: string | null`, `readonly blockLabel?: string | null`, `readonly sectionCode?: string | null`, `readonly sectionLabel?: string | null`. La Task 7 persiste esos campos y la Task 9 los pasa por el DTO.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `apps/api/src/modules/exams/domain/resolve-blueprint.spec.ts`:

```ts
describe("resolveBlueprint — propagación de la maqueta", () => {
  it("copia sección, bloque y orden de la plantilla a cada BlueprintRow", () => {
    const outcome = resolveBlueprint({
      courseScope: "all",
      weekScope: "none",
      templateRows: [
        {
          courseId: "aritmetica",
          questionCount: 10,
          sortOrder: 0,
          blockCode: "matematica",
          blockLabel: "MATEMÁTICA",
          sectionCode: "E2",
          sectionLabel: "SEGUNDA PRUEBA — MATEMÁTICA",
        },
        {
          courseId: "algebra",
          questionCount: 10,
          sortOrder: 1,
          blockCode: "matematica",
          blockLabel: "MATEMÁTICA",
          sectionCode: "E2",
          sectionLabel: "SEGUNDA PRUEBA — MATEMÁTICA",
        },
      ],
      syllabus: [],
    });

    expect(outcome.rows).toHaveLength(2);
    for (const row of outcome.rows) {
      expect(row.blockCode).toBe("matematica");
      expect(row.blockLabel).toBe("MATEMÁTICA");
      expect(row.sectionCode).toBe("E2");
      expect(row.sectionLabel).toBe("SEGUNDA PRUEBA — MATEMÁTICA");
    }
    expect(outcome.rows.map((r) => r.sortOrder)).toEqual([0, 1]);
  });

  it("un bloque abarca varios cursos: dos filas de cursos distintos comparten blockCode", () => {
    const outcome = resolveBlueprint({
      courseScope: "all",
      weekScope: "none",
      templateRows: [
        { courseId: "fisica", questionCount: 20, sortOrder: 0, blockCode: "fisica", blockLabel: "FÍSICA", sectionCode: "E3", sectionLabel: "TERCERA PRUEBA" },
        { courseId: "quimica", questionCount: 20, sortOrder: 1, blockCode: "quimica", blockLabel: "QUÍMICA", sectionCode: "E3", sectionLabel: "TERCERA PRUEBA" },
      ],
      syllabus: [],
    });

    expect(new Set(outcome.rows.map((r) => r.sectionCode))).toEqual(new Set(["E3"]));
    expect(new Set(outcome.rows.map((r) => r.blockCode))).toEqual(new Set(["fisica", "quimica"]));
  });

  it("una plantilla sin datos de maqueta produce filas sin sección ni bloque, con sortOrder por posición", () => {
    const outcome = resolveBlueprint({
      courseScope: "all",
      weekScope: "none",
      templateRows: [
        { courseId: "aritmetica", questionCount: 3 },
        { courseId: "algebra", questionCount: 2 },
      ],
      syllabus: [],
    });

    expect(outcome.rows.map((r) => r.sectionCode ?? null)).toEqual([null, null]);
    expect(outcome.rows.map((r) => r.sortOrder)).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/domain/resolve-blueprint.spec.ts -t "propagación de la maqueta"`
Expected: FAIL — `sortOrder` no existe en `TemplateRow` ni en `BlueprintRow`.

- [ ] **Step 3: Extender `BlueprintRow`**

En `apps/api/src/modules/exams/domain/blueprint-selector.ts`, dentro de `export interface BlueprintRow`, después de `count`:

```ts
  /**
   * Dónde le toca imprimirse a esta fila (spec §4). `sortOrder` fija el orden
   * canónico; `blockCode`/`blockLabel` el bloque impreso —que abarca varios
   * cursos, no es el curso—; `sectionCode`/`sectionLabel` la prueba.
   * Ausentes en un blueprint manual sin plantilla detrás.
   *
   * `matchesRow()` NO los mira: son metadatos de maqueta, no criterios de
   * selección de preguntas.
   */
  readonly sortOrder?: number;
  readonly blockCode?: string | null;
  readonly blockLabel?: string | null;
  readonly sectionCode?: string | null;
  readonly sectionLabel?: string | null;
```

- [ ] **Step 4: Extender `TemplateRow`**

En `apps/api/src/modules/exams/domain/resolve-blueprint.ts`, dentro de `export interface TemplateRow`, después de `sourceLevel`:

```ts
  readonly sortOrder?: number | null;
  readonly blockCode?: string | null;
  readonly blockLabel?: string | null;
  readonly sectionCode?: string | null;
  readonly sectionLabel?: string | null;
```

- [ ] **Step 5: Propagar en el cuerpo del resolver**

En `resolve-blueprint.ts`, agregar cerca de `resolveDifficultyFromSourceLevel` un helper:

```ts
/**
 * Metadatos de maqueta de una fila de plantilla. Cuando la plantilla no los
 * trae (una fuente que solo publica pesos), `sortOrder` cae al índice de la
 * fila: sin orden explícito, el orden de la fuente es lo mejor que hay.
 */
function layoutOf(row: TemplateRow, index: number) {
  return {
    sortOrder: row.sortOrder ?? index,
    blockCode: row.blockCode ?? null,
    blockLabel: row.blockLabel ?? null,
    sectionCode: row.sectionCode ?? null,
    sectionLabel: row.sectionLabel ?? null,
  };
}
```

En cada sitio donde el resolver hace `rows.push({ courseId: ..., topicId: ..., count, difficulty })`, agregar `...layoutOf(row, index)`. Son los tres pushes de la rama `weekScope === "none"` y los de las ramas de semana; el `index` ya está disponible en el `forEach((row, index) => ...)` de cada una.

- [ ] **Step 6: Correr los tests para verlos pasar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/domain/resolve-blueprint.spec.ts`
Expected: PASS — los existentes más los 3 nuevos.

- [ ] **Step 7: Escribir el test de la invariante de total de bloque**

El total oficial de un bloque es invariante (spec §3.9): la UNI publica 40 preguntas de Matemática, y el reparto editable entre sus cuatro cursos tiene que sumar 40. Cuando no suma, el resolver lo REPORTA en vez de corregirlo en silencio — mismo criterio que ya usa `usedCumulativeFallback`.

Agregar a `resolve-blueprint.spec.ts`:

```ts
  it("reporta el bloque cuyo reparto no alcanza su total oficial", () => {
    const outcome = resolveBlueprint({
      courseScope: "all",
      weekScope: "none",
      templateRows: [
        { courseId: "aritmetica", questionCount: 10, sortOrder: 0, blockCode: "matematica", blockLabel: "MATEMÁTICA", blockQuestionCount: 40 },
        { courseId: "algebra", questionCount: 10, sortOrder: 1, blockCode: "matematica", blockLabel: "MATEMÁTICA", blockQuestionCount: 40 },
      ],
      syllabus: [],
    });

    expect(outcome.blockCountMismatches).toEqual([
      { blockCode: "matematica", blockLabel: "MATEMÁTICA", expected: 40, actual: 20 },
    ]);
  });

  it("no reporta nada cuando el reparto suma exactamente el total oficial", () => {
    const outcome = resolveBlueprint({
      courseScope: "all",
      weekScope: "none",
      templateRows: [
        { courseId: "fisica", questionCount: 20, sortOrder: 0, blockCode: "e3-fisica", blockLabel: "FÍSICA", blockQuestionCount: 20 },
      ],
      syllabus: [],
    });

    expect(outcome.blockCountMismatches).toEqual([]);
  });

  it("un bloque sin total oficial publicado nunca se reporta", () => {
    const outcome = resolveBlueprint({
      courseScope: "all",
      weekScope: "none",
      templateRows: [{ courseId: "aritmetica", questionCount: 3, sortOrder: 0, blockCode: "mat", blockLabel: "MAT" }],
      syllabus: [],
    });

    expect(outcome.blockCountMismatches).toEqual([]);
  });
```

- [ ] **Step 8: Correr el test para verlo fallar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/domain/resolve-blueprint.spec.ts -t "total oficial"`
Expected: FAIL — `outcome.blockCountMismatches` es `undefined`.

- [ ] **Step 9: Implementar el reporte**

En `resolve-blueprint.ts`, agregar `blockQuestionCount` a `TemplateRow`:

```ts
  readonly blockQuestionCount?: number | null;
```

Agregar el tipo del reporte y el campo en el outcome:

```ts
/**
 * Un bloque cuyo reparto por curso no suma el total que la universidad publica.
 * Se reporta, nunca se corrige en silencio: el total es dato oficial y el
 * reparto es nuestro, así que la discrepancia es un error de la plantilla que
 * alguien tiene que ver (spec §3.9, §5.1).
 */
export interface BlockCountMismatch {
  readonly blockCode: string;
  readonly blockLabel: string | null;
  readonly expected: number;
  readonly actual: number;
}
```

En `ResolveBlueprintOutcome`, después de `usedCumulativeFallback`:

```ts
  readonly blockCountMismatches: readonly BlockCountMismatch[];
```

Agregar la función pura que lo calcula:

```ts
/**
 * Compara, por bloque, el total oficial publicado contra la suma del reparto
 * por curso. Solo mira bloques que declaran total: sin total publicado no hay
 * nada contra qué comparar.
 */
function findBlockCountMismatches(rows: readonly TemplateRow[]): BlockCountMismatch[] {
  const byBlock = new Map<
    string,
    { blockLabel: string | null; expected: number; actual: number }
  >();

  for (const row of rows) {
    if (!row.blockCode || row.blockQuestionCount == null) {
      continue;
    }
    const entry = byBlock.get(row.blockCode) ?? {
      blockLabel: row.blockLabel ?? null,
      expected: row.blockQuestionCount,
      actual: 0,
    };
    entry.actual += row.questionCount ?? 0;
    byBlock.set(row.blockCode, entry);
  }

  return [...byBlock.entries()]
    .filter(([, entry]) => entry.actual !== entry.expected)
    .map(([blockCode, entry]) => ({
      blockCode,
      blockLabel: entry.blockLabel,
      expected: entry.expected,
      actual: entry.actual,
    }));
}
```

En `resolveBlueprint`, calcular `const blockCountMismatches = findBlockCountMismatches(filteredRows);` y agregarlo a TODOS los `return` de la función — incluido el early return de `courseScope === "none"`, que devuelve `blockCountMismatches: []`.

- [ ] **Step 10: Correr los tests para verlos pasar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/domain/resolve-blueprint.spec.ts`
Expected: PASS. Los tests existentes que construyen un `ResolveBlueprintOutcome` esperado con `toEqual` necesitan `blockCountMismatches: []` agregado.

- [ ] **Step 11: Commit**

```bash
git add apps/api/src/modules/exams/domain/resolve-blueprint.ts apps/api/src/modules/exams/domain/resolve-blueprint.spec.ts apps/api/src/modules/exams/domain/blueprint-selector.ts
git commit -m "feat(exams): carry section, block and order from the template to the blueprint"
```

---

### Task 7: El repositorio expone la maqueta y persiste el layout

**Files:**
- Modify: `apps/api/src/modules/exams/domain/ports/exams-repository.port.ts:167-186` (`SelectedQuestionForGeneration`) y `:222-228` (`SaveVersionRecord`)
- Modify: `apps/api/src/modules/exams/exams.repository.ts:523-582` (`getExamForGeneration`) y `:716-725` (`saveVersion`)
- Test: `apps/api/src/modules/exams/exams-section-layout.e2e.spec.ts`

**Interfaces:**
- Consumes: las columnas de la Task 1; `SectionLayout` de la Task 2.
- Produces: `SelectedQuestionForGeneration` con `sortOrder`, `blockLabel`, `sectionCode`, `sectionLabel`; `SaveVersionRecord` con `sectionLayout`. La Task 8 los consume.

- [ ] **Step 1: Escribir el test e2e que falla**

Crear `apps/api/src/modules/exams/exams-section-layout.e2e.spec.ts`, siguiendo el patrón de arranque de app + seeding de `exams.e2e.spec.ts` (copiar de ahí el `beforeAll`/`afterAll` y los helpers de creación de tenant/usuario/preguntas). El cuerpo del test:

```ts
  it("getExamForGeneration expone el bloque y la sección de cada pregunta", async () => {
    const { examId } = await seedExamWithBlueprint([
      { courseId: aritmeticaId, count: 2, sortOrder: 0, blockLabel: "MATEMÁTICA", sectionCode: "E2", sectionLabel: "SEGUNDA PRUEBA" },
      { courseId: algebraId, count: 1, sortOrder: 1, blockLabel: "MATEMÁTICA", sectionCode: "E2", sectionLabel: "SEGUNDA PRUEBA" },
    ]);

    const exam = await repository.getExamForGeneration(examId, tenantId);

    expect(exam).toBeDefined();
    for (const question of exam!.selectedQuestions) {
      expect(question.blockLabel).toBe("MATEMÁTICA");
      expect(question.sectionCode).toBe("E2");
      expect(question.sectionLabel).toBe("SEGUNDA PRUEBA");
    }
    expect(exam!.selectedQuestions.map((q) => q.sortOrder).sort()).toEqual([0, 0, 1]);
  });

  it("una fila sin blockLabel cae al nombre del curso", async () => {
    const { examId } = await seedExamWithBlueprint([
      { courseId: aritmeticaId, count: 1, sortOrder: 0, blockLabel: null, sectionCode: null, sectionLabel: null },
    ]);

    const exam = await repository.getExamForGeneration(examId, tenantId);

    expect(exam!.selectedQuestions[0].blockLabel).toBe("Aritmética");
    expect(exam!.selectedQuestions[0].sectionCode).toBeNull();
  });

  it("saveVersion persiste el sectionLayout y clearVersions lo borra con la versión", async () => {
    const { examId, pdfAssetId, answerSheetAssetId } = await seedExamWithBlueprint([
      { courseId: aritmeticaId, count: 1, sortOrder: 0, blockLabel: "MATEMÁTICA", sectionCode: "E2", sectionLabel: "SEGUNDA PRUEBA" },
    ]);

    await repository.saveVersion(examId, {
      code: "A",
      questionOrder: ["q1"],
      answerKey: { 0: "C" },
      sectionLayout: [{ code: "E2", label: "SEGUNDA PRUEBA", blocks: [{ label: "MATEMÁTICA", count: 1 }] }],
      pdfAssetId,
      answerSheetAssetId,
    });

    const [row] = await db.select().from(examVersions).where(eq(examVersions.examId, examId));
    expect(row.sectionLayout).toEqual([
      { code: "E2", label: "SEGUNDA PRUEBA", blocks: [{ label: "MATEMÁTICA", count: 1 }] },
    ]);
  });
```

`seedExamWithBlueprint` es un helper local del archivo: inserta un examen `ready`, sus `exam_blueprint_rows` con los campos de maqueta dados, y un `exam_questions` por cada `count` apuntando a preguntas aprobadas del curso, con `blueprintRowId` seteado.

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx jest --selectProjects e2e src/modules/exams/exams-section-layout.e2e.spec.ts`
Expected: FAIL — `question.blockLabel` es `undefined`.

- [ ] **Step 3: Extender los tipos del puerto**

En `apps/api/src/modules/exams/domain/ports/exams-repository.port.ts`, dentro de `SelectedQuestionForGeneration`, después de `alternativeImages`:

```ts
  /**
   * Dónde le toca imprimirse a esta pregunta (spec §4). Sale de su
   * `exam_blueprint_rows` vía `exam_questions.blueprint_row_id`.
   *
   * `blockLabel` cae al nombre del curso cuando la fila no declara bloque —
   * el caso de un examen manual, donde cada curso es su propio bloque.
   */
  readonly sortOrder: number;
  readonly blockLabel: string;
  readonly sectionCode: string | null;
  readonly sectionLabel: string | null;
```

Y dentro de `SaveVersionRecord`, después de `answerKey`:

```ts
  /** Estructura impresa congelada de esta forma (spec §3.5). */
  readonly sectionLayout: SectionLayout;
```

Agregar `import { SectionLayout } from "../version-shuffler";` al principio del archivo.

- [ ] **Step 4: Extender la query de generación**

En `apps/api/src/modules/exams/exams.repository.ts`, en `getExamForGeneration`, agregar al `.select({...})` de `selectedRows`:

```ts
        sortOrder: examBlueprintRows.sortOrder,
        blockLabel: examBlueprintRows.blockLabel,
        sectionCode: examBlueprintRows.sectionCode,
        sectionLabel: examBlueprintRows.sectionLabel,
        courseName: courses.name,
```

y a los joins, después del `leftJoin(assets, ...)`:

```ts
      .leftJoin(examBlueprintRows, eq(examQuestions.blueprintRowId, examBlueprintRows.id))
      .leftJoin(courses, eq(examBlueprintRows.courseId, courses.id))
```

`leftJoin` y no `innerJoin`: `blueprintRowId` es nullable para inserciones legacy/manuales, y una pregunta sin fila no puede desaparecer del examen.

En el `.map(...)` que construye `selectedQuestions`, agregar:

```ts
        // `blockLabel` cae al nombre del curso: en un examen manual cada curso
        // es su propio bloque. Cadena vacía si tampoco hay curso (fila legacy
        // sin `blueprint_row_id`), que el renderizador trata como "sin encabezado".
        sortOrder: row.sortOrder ?? row.position,
        blockLabel: row.blockLabel ?? row.courseName ?? "",
        sectionCode: row.sectionCode ?? null,
        sectionLabel: row.sectionLabel ?? null,
```

Agregar `examBlueprintRows` y `courses` a los imports de schema del archivo si no están.

- [ ] **Step 5: Persistir el layout**

En `saveVersion`, agregar `sectionLayout: version.sectionLayout,` al objeto de `.values({...})`.

- [ ] **Step 6: Correr el test para verlo pasar**

Run: `npx jest --selectProjects e2e src/modules/exams/exams-section-layout.e2e.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/exams/domain/ports/exams-repository.port.ts apps/api/src/modules/exams/exams.repository.ts apps/api/src/modules/exams/exams-section-layout.e2e.spec.ts
git commit -m "feat(exams): expose the printed block per question and persist the version layout"
```

---

### Task 8: Cablear la generación y arreglar los call sites de preview

**Files:**
- Modify: `apps/api/src/modules/exams/exam-generation.service.ts:322-336` y `:441-485`
- Modify: `apps/api/src/modules/bank/domain/compile-preview-from-content.ts:18-39`
- Modify: `apps/api/src/modules/bank/bank.service.ts:504-516`
- Test: `apps/api/src/modules/exams/exam-generation.service.spec.ts`

**Interfaces:**
- Consumes: `groupIntoSections`/`QuestionPlacement` (Task 2), `buildVersions` con `SelectionSection[]` (Task 3), `ExamPdfSection`/`ExamPdfBlock` (Task 4), `AnswerKeySection` (Task 5), `SelectedQuestionForGeneration` extendido y `SaveVersionRecord.sectionLayout` (Task 7).
- Produces: nada nuevo — es la tarea de integración.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar a `apps/api/src/modules/exams/exam-generation.service.spec.ts`:

```ts
  it("MUST: el PDF recibe las secciones y bloques que declararon las filas de blueprint", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.examForGeneration = examWithQuestions([
      { questionId: "rm1", sortOrder: 0, blockLabel: "RAZ. MATEMÁTICO", sectionCode: "E1", sectionLabel: "PRIMERA PRUEBA" },
      { questionId: "rv1", sortOrder: 1, blockLabel: "RAZ. VERBAL", sectionCode: "E1", sectionLabel: "PRIMERA PRUEBA" },
      { questionId: "m1", sortOrder: 2, blockLabel: "MATEMÁTICA", sectionCode: "E2", sectionLabel: "SEGUNDA PRUEBA" },
    ]);

    await service.generateVersions(user, "exam-1", 1);

    const input = pdfCompiler.examInputs[0];
    expect(input.sections.map((s) => s.code)).toEqual(["E1", "E2"]);
    expect(input.sections[0].blocks.map((b) => b.label).sort()).toEqual([
      "RAZ. MATEMÁTICO",
      "RAZ. VERBAL",
    ]);
    expect(input.sections[1].blocks.map((b) => b.label)).toEqual(["MATEMÁTICA"]);
  });

  it("MUST: la clave se agrupa igual que el cuadernillo y con la misma numeración local", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.examForGeneration = examWithQuestions([
      { questionId: "rm1", sortOrder: 0, blockLabel: "RAZ. MATEMÁTICO", sectionCode: "E1", sectionLabel: "PRIMERA PRUEBA" },
      { questionId: "m1", sortOrder: 1, blockLabel: "MATEMÁTICA", sectionCode: "E2", sectionLabel: "SEGUNDA PRUEBA" },
    ]);

    await service.generateVersions(user, "exam-1", 1);

    const key = pdfCompiler.answerKeyInputs[0];
    const booklet = pdfCompiler.examInputs[0];

    expect(key.sections.map((s) => s.label)).toEqual(booklet.sections.map((s) => s.label));
    key.sections.forEach((section, index) => {
      const blockCount = booklet.sections[index].blocks.reduce((sum, b) => sum + b.questions.length, 0);
      expect(section.entries).toHaveLength(blockCount);
    });
  });

  it("el sectionLayout que se persiste coincide con el que se imprimió", async () => {
    const { service, repository, pdfCompiler } = buildDeps();
    repository.examForGeneration = examWithQuestions([
      { questionId: "a", sortOrder: 0, blockLabel: "MATEMÁTICA", sectionCode: "E2", sectionLabel: "SEGUNDA PRUEBA" },
      { questionId: "b", sortOrder: 1, blockLabel: "MATEMÁTICA", sectionCode: "E2", sectionLabel: "SEGUNDA PRUEBA" },
    ]);

    await service.generateVersions(user, "exam-1", 1);

    const saved = repository.savedVersions[0];
    const printed = pdfCompiler.examInputs[0];

    expect(saved.sectionLayout).toEqual([
      { code: "E2", label: "SEGUNDA PRUEBA", blocks: [{ label: "MATEMÁTICA", count: 2 }] },
    ]);
    expect(printed.sections[0].blocks[0].questions).toHaveLength(2);
  });
```

`examWithQuestions` es un helper local que construye un `ExamForGenerationRecord` con esos campos de maqueta, reutilizando el `buildDeps()` que ya existe en el archivo; el doble de `pdfCompiler` tiene que ir acumulando `examInputs` y `answerKeyInputs` (extenderlo si hoy solo guarda el último).

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/exam-generation.service.spec.ts`
Expected: FAIL — `input.sections` es `undefined`.

- [ ] **Step 3: Armar las secciones antes de barajar**

En `apps/api/src/modules/exams/exam-generation.service.ts`, reemplazar el bloque de líneas 322-336 por:

```ts
    const placements: QuestionPlacement[] = exam.selectedQuestions.map((q): QuestionPlacement => ({
      question:
        q.type === "structured"
          ? {
              type: "structured",
              questionId: q.questionId,
              alternatives: q.alternatives ?? [],
              correctAnswer: q.correctAnswer,
              alternativeImages: q.alternativeImages,
            }
          : {
              questionId: q.questionId,
              correctAnswer: q.correctAnswer,
            },
      sortOrder: q.sortOrder,
      blockLabel: q.blockLabel,
      sectionCode: q.sectionCode,
      sectionLabel: q.sectionLabel,
    }));

    const versions = buildVersions(groupIntoSections(placements), versionCount, this.rngFactory());
```

Actualizar el import de la línea 14 y agregar el de `exam-sections`:

```ts
import { Version, buildVersions } from "./domain/version-shuffler";
import { QuestionPlacement, groupIntoSections } from "./domain/exam-sections";
```

(`SelectedQuestion` deja de usarse directamente acá; quitarlo del import si el linter lo marca.)

- [ ] **Step 4: Armar los inputs del PDF desde el layout**

En `generateOneVersion` (líneas 451-473), reemplazar la construcción de `examInput` y `answerKeyInput` por:

```ts
    // `version.sectionLayout` dice dónde cortar `version.questionOrder`: cada
    // bloque se lleva `count` preguntas consecutivas. Es la razón por la que el
    // layout guarda `count` y no ids — un solo recorrido reconstruye la maqueta
    // sin que exista una segunda copia del orden (spec §3.6).
    let cursor = 0;
    const sections: ExamPdfSection[] = [];
    const answerKeySections: AnswerKeySection[] = [];

    for (const section of version.sectionLayout) {
      const blocks: ExamPdfBlock[] = [];
      const entries: AnswerKeyEntry[] = [];

      for (const block of section.blocks) {
        const ids = version.questionOrder.slice(cursor, cursor + block.count);
        blocks.push({
          label: block.label,
          questions: ids.map((questionId) =>
            this.buildPdfQuestion(
              questionId,
              questionById,
              imagePathByQuestionId,
              altImagePathsByQuestionId,
              version,
            ),
          ),
        });
        ids.forEach((questionId, offset) => {
          entries.push({ questionId, correctOption: version.answerKey[cursor + offset]! });
        });
        cursor += block.count;
      }

      sections.push({ code: section.code, label: section.label, blocks });
      answerKeySections.push({ label: section.label, entries });
    }

    const examInput: ExamPdfDocumentInput = {
      title: exam.title,
      versionLabel,
      tenantLogoAbsolutePath: logoPath,
      sections,
    };

    const answerKeyInput: AnswerKeyDocumentInput = {
      title: exam.title,
      versionLabel,
      sections: answerKeySections,
    };
```

Agregar `ExamPdfSection`, `ExamPdfBlock`, `AnswerKeySection` y `AnswerKeyEntry` al import del puerto (líneas 17-23).

- [ ] **Step 5: Persistir el layout junto con la versión**

En el sitio donde el servicio llama a `this.repository.saveVersion(...)` (justo después de los `createAsset`), agregar `sectionLayout: version.sectionLayout,` al objeto que se pasa.

- [ ] **Step 6: Arreglar los dos call sites de preview**

En `apps/api/src/modules/bank/domain/compile-preview-from-content.ts`, reemplazar el `input`:

```ts
  const input: ExamPdfDocumentInput = {
    title: "Vista previa",
    versionLabel: "preview",
    // Una pregunta suelta: una sección sin rótulo con un bloque sin rótulo, o
    // sea cero encabezados. El preview sale igual que antes de la maqueta.
    sections: [
      {
        code: null,
        label: null,
        blocks: [
          {
            label: "",
            questions: [{ id, type: "structured", bodyTypst, alternatives, figureCode }],
          },
        ],
      },
    ],
  };
```

En `apps/api/src/modules/bank/bank.service.ts:504`, el mismo envoltorio:

```ts
      await this.pdfCompiler.compileExam({
        title: "Draft preview",
        versionLabel: "preview",
        sections: [
          {
            code: null,
            label: null,
            blocks: [
              {
                label: "",
                questions: [
                  {
                    id,
                    type: "structured",
                    bodyTypst: merged.bodyTypst,
                    alternatives: merged.alternatives,
                    figureCode: merged.figureCode,
                  },
                ],
              },
            ],
          },
        ],
      });
```

- [ ] **Step 7: Correr los tests para verlos pasar**

Run: `npx jest --selectProjects non-e2e src/modules/exams src/modules/bank`
Expected: PASS. Adaptar los dobles de `pdfCompiler` y los fixtures de `SelectedQuestionForGeneration` de los specs existentes que ahora no compilan (les faltan `sortOrder`/`blockLabel`/`sectionCode`/`sectionLabel`).

- [ ] **Step 8: Correr la suite e2e completa**

Run: `npx jest --selectProjects e2e --maxWorkers=4`
Expected: PASS. Requiere Postgres migrado y el binario `typst` en PATH.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/exams apps/api/src/modules/bank
git commit -m "feat(exams): generate the booklet from its section layout"
```

---

### Task 9: La maqueta sobrevive el ida y vuelta resolve → create

**Files:**
- Modify: `apps/api/src/modules/exams/exams.controller.ts:51-65` (`CreateExamBody`)
- Modify: `apps/api/src/modules/exams/exams.service.ts` (el tipo de fila que consume `createExam` y su insert de `exam_blueprint_rows`)
- Modify: `apps/web/src/app/features/exams/exams.models.ts` (`ResolvedBlueprintRow`)
- Test: `apps/api/src/modules/exams/exams.controller.spec.ts`

**Interfaces:**
- Consumes: `BlueprintRow` extendido (Task 6), columnas de `exam_blueprint_rows` (Task 1).
- Produces: nada nuevo.

**Por qué existe esta tarea:** `POST /exams/blueprint/resolve` devuelve las filas al frontend, y el builder las reenvía en `POST /exams`. Si `CreateExamBody` no acepta los campos de maqueta, todo lo que resolvió la plantilla se pierde en el viaje y el examen sale sin secciones.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `apps/api/src/modules/exams/exams.controller.spec.ts`:

```ts
  it("MUST: los campos de maqueta que devolvió resolve sobreviven el POST /exams", async () => {
    const { controller, service } = buildDeps();

    await controller.create(user, {
      title: "ETA UNI",
      gradeLevel: "preuni",
      blueprint: [
        {
          courseId: "aritmetica",
          count: 10,
          sortOrder: 0,
          blockCode: "matematica",
          blockLabel: "MATEMÁTICA",
          sectionCode: "E2",
          sectionLabel: "SEGUNDA PRUEBA — MATEMÁTICA",
        },
      ],
    });

    const [row] = service.createExamCalls[0].blueprint;
    expect(row.sortOrder).toBe(0);
    expect(row.blockCode).toBe("matematica");
    expect(row.blockLabel).toBe("MATEMÁTICA");
    expect(row.sectionCode).toBe("E2");
    expect(row.sectionLabel).toBe("SEGUNDA PRUEBA — MATEMÁTICA");
  });

  it("un blueprint manual sin campos de maqueta recibe sortOrder por posición y sin sección", async () => {
    const { controller, service } = buildDeps();

    await controller.create(user, {
      title: "Repaso",
      gradeLevel: "secundaria_3",
      blueprint: [
        { courseId: "comunicacion", count: 5 },
        { courseId: "matematica", count: 5 },
      ],
    });

    const rows = service.createExamCalls[0].blueprint;
    expect(rows.map((r) => r.sortOrder)).toEqual([0, 1]);
    expect(rows.every((r) => r.sectionCode === null)).toBe(true);
  });
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/exams.controller.spec.ts`
Expected: FAIL — `row.sortOrder` es `undefined`.

- [ ] **Step 3: Extender `CreateExamBody`**

En `apps/api/src/modules/exams/exams.controller.ts`, dentro del array `blueprint`, después de `count`:

```ts
    /**
     * Metadatos de maqueta que `POST /exams/blueprint/resolve` ya calculó. El
     * builder los reenvía tal cual: sin esto, todo lo que resolvió la plantilla
     * se pierde en el viaje y el examen sale sin secciones (spec §4).
     * Ausentes en un blueprint manual.
     */
    readonly sortOrder?: number;
    readonly blockCode?: string;
    readonly blockLabel?: string;
    readonly sectionCode?: string;
    readonly sectionLabel?: string;
```

- [ ] **Step 4: Normalizar en el controller y persistir en el service**

En el método `create` del controller, donde hoy mapea `body.blueprint` a las filas que pasa al service, agregar la normalización:

```ts
      blueprint: (body.blueprint ?? []).map((row, index) => ({
        ...row,
        sortOrder: row.sortOrder ?? index,
        blockCode: row.blockCode ?? null,
        blockLabel: row.blockLabel ?? null,
        sectionCode: row.sectionCode ?? null,
        sectionLabel: row.sectionLabel ?? null,
      })),
```

En `exams.service.ts`, donde se insertan las `exam_blueprint_rows` al crear el examen, agregar los cinco campos al objeto insertado, y al tipo de fila que declara el service.

- [ ] **Step 5: Agregar los campos al modelo del frontend**

En `apps/web/src/app/features/exams/exams.models.ts`, dentro de `ResolvedBlueprintRow`:

```ts
  /**
   * Maqueta oficial resuelta por la plantilla — se reenvía sin tocar en
   * `POST /exams`. El builder no las muestra ni las deja editar (el orden de
   * bloques no se edita desde la UI, spec §9); solo las transporta.
   */
  readonly sortOrder?: number;
  readonly blockCode?: string | null;
  readonly blockLabel?: string | null;
  readonly sectionCode?: string | null;
  readonly sectionLabel?: string | null;
```

Y en el componente del builder, incluir esos campos en el payload de creación (hoy mapea explícitamente `courseId`/`topicId`/`difficulty`/`count` — agregar los cinco).

- [ ] **Step 6: Correr los tests para verlos pasar**

Run: `npx jest --selectProjects non-e2e src/modules/exams/exams.controller.spec.ts`
Expected: PASS.

Run (desde `apps/web/`): `npx ng test --watch=false`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/exams/exams.controller.ts apps/api/src/modules/exams/exams.service.ts apps/api/src/modules/exams/exams.controller.spec.ts apps/web/src/app/features/exams
git commit -m "feat(exams): keep the resolved layout across the resolve-create round trip"
```

---

### Task 10: Medir el reparto real de la UNI (entregable de datos, independiente)

**Files:**
- Create: `tools/harvest/measure_uni_distribution.py`
- Create: `docs/uni-distribution-measured.md`
- Test: verificación manual contra los solucionarios (no hay assertions automáticas: la salida es un informe, no código de producción)

**Interfaces:**
- Consumes: `tools/harvest/parse_uni_solucionario.py` y `tools/harvest/classify_topics.py`, que ya existen.
- Produces: `docs/uni-distribution-measured.md`. **Nadie siembra estos números hasta que el dueño del producto los revise.**

**Por qué existe:** la UNI publica 40 preguntas de "Matemática" pero no cómo se reparten entre Aritmética, Álgebra, Geometría y Trigonometría, ni las 36 de Humanidades entre sus cursos, ni nada de dificultad (spec §2.4). El reparto se mide de exámenes reales.

- [ ] **Step 1: Descargar los solucionarios oficiales**

```bash
mkdir -p /tmp/uni-solucionarios && cd /tmp/uni-solucionarios
for y in 2013 2015 20152 20162 20171 20172 2018 20182 2019 20192 2020 2021; do
  curl -sfL -o "solucionario$y.pdf" "https://admision.uni.edu.pe/wp-content/uploads/2022/11/solucionario$y.pdf" \
    && echo "OK $y" || echo "MISS $y"
done
```

- [ ] **Step 2: Escribir el script de medición**

Crear `tools/harvest/measure_uni_distribution.py`. Recorre los PDFs, llama a `parse_uni_solucionario.parse` sobre cada uno, clasifica cada enunciado con `classify_topics`, y agrega los conteos por (bloque, curso). Emite una tabla Markdown con conteo absoluto, porcentaje, y el número de preguntas que la clasificación no pudo resolver.

Excluir explícitamente `solucionario2021.pdf` del agregado: es el año COVID con examen reducido (35/20/20) y sus proporciones no representan un examen normal. El script lo reporta aparte, rotulado.

- [ ] **Step 3: Correr la medición**

```bash
python3 tools/harvest/measure_uni_distribution.py /tmp/uni-solucionarios --out docs/uni-distribution-measured.md
```

- [ ] **Step 4: Revisar a mano la clasificación**

Muestrear al menos 20 preguntas del informe y verificar contra el PDF que el curso asignado es correcto. Aritmética y Álgebra se confunden con frecuencia. Anotar la tasa de error observada en el propio informe — un número medido con 30% de error mal clasificado no sirve para sembrar nada, y el informe tiene que decirlo.

- [ ] **Step 5: Presentar el informe y ESPERAR aprobación**

No sembrar ningún número en `apps/api/src/db/`. El informe se presenta, se revisa, y recién después se decide qué entra como default de plantilla.

- [ ] **Step 6: Commit**

```bash
git add tools/harvest/measure_uni_distribution.py docs/uni-distribution-measured.md
git commit -m "chore(harvest): measure the real per-course distribution of UNI exams"
```

---

## Orden de ejecución y paralelismo

```
Ola 1 (en paralelo, sin dependencias entre sí):
  Task 1  — schema + migración
  Task 2  — dominio de agrupación
  Task 4  — puerto PDF + plantilla del cuadernillo
  Task 5  — clave de respuestas
  Task 10 — medición (independiente de todo el código)

Ola 2:
  Task 3  — shuffler          (necesita 2)
  Task 6  — resolver          (necesita 1)
  Task 7  — repositorio       (necesita 1 y 2)
  Task 9  — round trip DTO    (necesita 1 y 6)

Ola 3:
  Task 8  — integración       (necesita 3, 4, 5, 7)
```

Las Tasks 4 y 5 tocan los mismos dos archivos (`pdf-compiler.port.ts` y `typst-template.ts`). Si se despachan en paralelo hay conflicto: correrlas en secuencia (4 y después 5) o en el mismo agente.
