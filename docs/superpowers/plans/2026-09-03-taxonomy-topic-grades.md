# Un tema por concepto, grados como atributo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que un tema del currículo sea UNA fila (`topics` único por `(course_id, name)`) y que los grados en que se dicta vivan en una tabla nueva `topic_grades` — 953 temas colapsan a 626, el árbol de carpetas pierde sus ~510 copias con sufijo "· N° grado", y los selects de Tema dejan de mostrar el mismo concepto repetido.

**Architecture:** `topics.grade_level` desaparece; nace `topic_grades(topic_id, grade_level)` con PK compuesta y `ON DELETE CASCADE`. Una sola migración Drizzle `0023` — generada por `drizzle-kit` y editada a mano — crea la tabla, rellena los grados, re-apunta las seis FKs a `topics.id` hacia la fila canónica de cada grupo, fusiona las carpetas duplicadas por tenant, borra las copias y recién ahí tumba la columna y los índices viejos. Todo eso corre dentro de UNA transacción (el migrador de Drizzle envuelve todas las migraciones pendientes en `session.transaction`, verificado en `drizzle-orm/pg-core/dialect.js:54`), y una sola vez en el pipeline de prod (`migrate && seed && main`). Del lado del API, `TopicListItem.gradeLevel: string | null` pasa a `gradeLevels: readonly string[]` (un `array_agg` con `left join`, sin N+1) y el filtro `?gradeLevel=` pasa a un `EXISTS (topic_grades)`. La web solo cambia el tipo y una regla de prefill.

**Tech Stack:** NestJS 10 + Drizzle 0.33 / Postgres 17 (`apps/api`), Angular 22 standalone + signals (`apps/web`), DTOs compartidos en `packages/shared`. Tests: Jest (proyectos `non-e2e`, `db-serial`, `e2e`) en el API, Vitest vía `ng test` (`@angular/build:unit-test`) en la web.

**Spec:** `docs/superpowers/specs/2026-09-03-taxonomy-topic-grades-design.md`
**Auditoría base:** `docs/audits/2026-09-03-taxonomy-data-audit.md`

## Global Constraints

- **Strict TDD, y el test rojo es un test de FEATURE.** En el API eso es un `*.e2e.spec.ts` con supertest contra el Nest real y el Postgres real, o un spec de repositorio/migración contra el Postgres real; en la web, un spec de componente que maneja el flujo del usuario por TestBed. Los tests unitarios quedan SOLO para funciones puras (`build-seed-folder-plan`, `folder-name`).
- **Cada tarea: escribir el test que falla → correrlo y decir en voz alta por qué falla → implementar → correr → commit.** Conventional Commits, en inglés, **sin `Co-Authored-By` ni atribución de IA**.
- **La migración es UN SOLO archivo `0023` en `apps/api/drizzle/` y una sola entrada en `meta/_journal.json`.** El cambio de esquema y la migración de datos viajan juntos: el pipeline de prod (`infra/docker-compose.dokploy.yml`, `migrate && seed && main`) la corre exactamente una vez y no hay paso manual.
- **Nunca correr un build de producción** (`pnpm build`, `ng build`, `turbo run build`). La única excepción sería `pnpm --filter @exams-generator/shared build`, y **hay que pedirle permiso al usuario antes de correrlo**. En este plan `packages/shared` NO cambia (verificado en la Task 7, Step 1), así que ese build no debería hacer falta; si algún paso lo necesitara, se PIDE primero.
- **Nunca leer `.env` directamente.** Si hace falta un valor, `envsafe show .env`.
- **Shell: `bat`/`rg`/`fd`/`sd`/`eza`.** Nada de `cat`/`grep`/`find`/`sed`/`ls`.
- **E2E siempre con `--runInBand`.** En paralelo produce fallos rotativos falsos por contención sobre el Postgres local.
- **El filtro de ruta va ANTES de `--selectProjects`.** `jest src/modules/taxonomy --selectProjects e2e --runInBand`, nunca al revés: jest trata lo que sigue a `--selectProjects` como más nombres de proyecto.
- **Postgres local en `localhost:5439`** (`infra/docker-compose.yml`, usuario `exams`, base `exams_generator`). `resolveDatabaseUrl()` cae a `postgres://exams:exams@localhost:5439/exams_generator` cuando `DATABASE_URL` no está exportado, así que los tests corren sin sourcear nada. Levantarlo con `pnpm dev:infra`.
- **`pnpm format` antes de cada commit, PERO nunca commitear los cuatro archivos con deriva de Prettier preexistente:** `apps/api/src/common/compression.filter.spec.ts`, `apps/api/src/modules/assets/asset-cache.spec.ts`, `apps/api/src/modules/assets/assets.service.spec.ts`, `apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts`. Los tres primeros no se tocan en este plan: después de `pnpm format`, `git checkout -- <los tres>`. El cuarto SÍ se edita (Task 7), y su deriva está en dos hunks concretos (las líneas `httpMock.expectOne((request) => request.url === ...)` cerca de las líneas 131 y 140), lejos de los fixtures que hay que cambiar — se stagea con `git add -p` eligiendo solo los hunks de fixtures, o se revierte la deriva con `git checkout -p` antes de commitear.
- **Copy de UI en español**; comentarios y documentación del código en inglés.
- **La API no compila entre la Task 1 y la Task 8, a propósito.** Un `0023` único que tumba `topics.grade_level` no puede convivir con los lectores de esa columna, y el spec prohíbe partir la migración en dos. `ts-jest` corre con `isolatedModules: true` en los tres proyectos (`apps/api/jest.config.js`), o sea transpila sin typecheck: **los tests filtrados por ruta de cada tarea SÍ corren y SÍ pasan**. Lo único rojo es `pnpm --filter @exams-generator/api typecheck`, y se pone verde al cerrar la Task 8. Cada tarea dice qué archivos saca de la lista roja.
- **Fuera de alcance (no hay tarea, y está bien):** borrar `subtopics`, fusionar cursos entre etapas o los 27 cursos de preuni, cambiar el eje de grado de las preguntas.

---

## File Structure

**API — esquema y migración**
- `apps/api/src/db/schema/topic-grades.schema.ts` (nuevo) — la tabla `topic_grades`.
- `apps/api/src/db/schema/topics.schema.ts` — pierde `gradeLevel`, cambia sus dos índices únicos.
- `apps/api/src/db/schema/index.ts` — export nuevo.
- `apps/api/drizzle/0023_topic_grades.sql` (generado + editado a mano) y `apps/api/drizzle/meta/{0023_snapshot.json,_journal.json}` (generados, NO se editan).
- `apps/api/src/db/topic-grades-migration.spec.ts` (nuevo, proyecto `db-serial`).
- `apps/api/jest.config.js` — el `testRegex` de `db-serial` pasa a cubrir dos archivos.

**API — seed**
- `apps/api/src/db/seed.ts` — `seed()`, `seedStage`, `seedCanonicalTaxonomy`, `reconcileLegacyTopics`.
- `apps/api/src/db/seed-collected-questions.ts`, `apps/api/src/db/seed-lot-questions.ts`.
- `apps/api/src/db/seed-idempotency.spec.ts`.
- `apps/api/src/scripts/{seed-image-question.ts,seed-gap-topic-with-image.ts,seed-preuni-course.ts,refile-round-solid-questions.ts}` + `refile-round-solid-questions.spec.ts`.

**API — lectura de taxonomía**
- `apps/api/src/modules/taxonomy/taxonomy.repository.ts` (+ `taxonomy.repository.spec.ts`, `taxonomy.e2e.spec.ts`).
- `apps/api/src/modules/exams/exams.repository.ts` (+ `exams.repository.spec.ts`).

**API — banco (borrado del summary)**
- `apps/api/src/modules/bank/bank.controller.ts`, `bank.service.ts`, `bank.repository.ts`, `domain/ports/bank-repository.port.ts`.
- `apps/api/src/modules/bank/bank.e2e.spec.ts`, `bank.service.spec.ts`, `bank.repository.spec.ts`, `apps/api/src/modules/auth/cross-tenant.e2e.spec.ts`.

**API — carpetas**
- `apps/api/src/modules/bank/folders/domain/folder-name.ts` (+ spec), `domain/build-seed-folder-plan.ts` (+ spec), `bank-folders.repository.ts`, `bank-folders.e2e.spec.ts`.

**Web**
- `apps/web/src/app/features/taxonomy/taxonomy.models.ts`, `taxonomy.service.spec.ts`, `grade-level-labels.ts`.
- `apps/web/src/app/features/bank/bank-new/bank-new.component.ts` (+ spec).
- Fixtures `Topic` en: `apps/web/src/app/features/exams/exam-builder/exam-builder.component.spec.ts`, `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts`, `apps/web/src/app/features/ai/ai-generate/ai-generate.component.spec.ts`, `apps/web/src/app/features/bank/taxonomy-matcher.spec.ts`, `apps/web/src/app/features/bank/bank-list/bank-list.component.spec.ts`.

**`packages/shared`: sin cambios.** Ver la Task 7, Step 1.

---

## Ambigüedades del spec resueltas en este plan

Están explicadas donde aplican, pero van juntas para que nadie las descubra a mitad de una tarea:

1. **`BankTopicQuestionCount` NO vive en `packages/shared`.** El spec dice "sale de `packages/shared`"; el tipo está declarado en `apps/api/src/modules/bank/domain/ports/bank-repository.port.ts:178` y re-exportado por `bank.repository.ts`. Se borra de ahí. `rg -n "BankTopicQuestionCount" packages/shared/src` no devuelve nada — comprobado.
2. **`TopicListItem` tampoco tiene DTO compartido.** Existe dos veces, a mano: `apps/api/src/modules/taxonomy/taxonomy.repository.ts:33` (API) y `apps/web/src/app/features/taxonomy/taxonomy.models.ts` (`Topic`, web). Los dos cambian; `packages/shared` no.
3. **El desempate de la fila canónica.** El spec dice "menor `created_at`/`id`" para los grupos sin grado; `topics` **no tiene** `created_at` (ver `topics.schema.ts`). El desempate es por `id`, siempre: `ORDER BY COALESCE(grade_levels.sort_order, 2147483647), topics.id`.
4. **Cómo se prueba la migración.** El spec deja abierta la puerta a "extraer el SQL a un helper". No hace falta: el spec de migración crea una BASE DE DATOS nueva (el usuario `exams` del contenedor es superusuario — verificado: `select usesuper from pg_user where usename=current_user` → `true`, y `create database`/`drop database` funcionan), la lleva al estado `0022` con una copia recortada de `drizzle/`, mete los fixtures, y recién ahí corre el `0023` REAL. Se prueba el archivo committeado, no una copia que puede derivar. `readMigrationFiles` (`drizzle-orm/migrator.js`) solo lee `meta/_journal.json` y los `.sql` que el journal nombra, así que recortar el journal a `idx <= 22` es todo lo que hace falta.
5. **Quitar `dedupeSiblingNames` es seguro.** Existía para dos temas del mismo curso con el mismo nombre y grado NULL; después del colapso `(course_id, name)` es único, así que ese caso desaparece. El otro riesgo teórico —dos nombres distintos que colisionan DESPUÉS del clamp a 80— no existe hoy: el nombre de tema más largo del seed mide 66 caracteres y el más largo de `canonical-taxonomy.json` mide 63 (comprobado con el script de la Task 6, Step 1). El clamp se queda; el dedupe se va.
6. **El sufijo se quita comparándolo con el nombre del tema, no con una lista de etiquetas.** `UPDATE ... WHERE starts_with(f.name, t.name || ' · ')` renombra SOLO las carpetas cuyo nombre es exactamente "`<nombre del tema>` · `<algo>`" — o sea las que sembró `folderNameForTopic`. Una carpeta que la profesora renombró a mano no coincide con ese patrón y se queda como está. Más robusto que enumerar las 12 etiquetas de `GRADE_LEVEL_LABELS`, y no hay que escapar `%`/`_` como con `LIKE`.
7. **"exams e2e: el selector de temas por grado del constructor".** Son dos cosas distintas y este plan las separa. (a) El select de Tema del constructor de exámenes en la web pide `GET /topics?courseId=…&gradeLevel=…` — eso es la Task 3 (`taxonomy.e2e.spec.ts`). (b) `exams.repository.getTopicsForCourses` solo lo usa `resolveBlueprint` con `TEMPLATE_GRADE_LEVEL = "pre"` (`exams.service.ts:261,778`) y **ningún e2e cubre `POST /exams/blueprint/resolve`** — montar uno pide universidad + track + tipo de examen + ciclo + plantilla. Se cubre en `exams.repository.spec.ts`, que ya es una integración contra el Postgres real (`runMigrations()` en su `beforeAll`), no un test con mocks. Eso es la Task 4.
8. **La API queda sin compilar entre las tasks 1 y 8.** Ver Global Constraints. No es un descuido: es la consecuencia directa de exigir un solo `0023`.

---

### Task 1: `topic_grades`, esquema, migración `0023` y su spec

La tarea que mueve la base. Trae adentro el esquema, la migración y el spec de la migración porque son una sola cosa: `migration-snapshot.spec.ts` exige que el SQL committeado sea byte-idéntico a lo que `drizzle-kit generate` produce desde el esquema actual, así que esquema y migración no se pueden separar en dos commits.

**Files:**
- Create: `apps/api/src/db/schema/topic-grades.schema.ts`
- Modify: `apps/api/src/db/schema/topics.schema.ts`
- Modify: `apps/api/src/db/schema/index.ts`
- Create: `apps/api/drizzle/0023_topic_grades.sql` (generado y luego editado a mano)
- Modify: `apps/api/jest.config.js` (el `testRegex` de `db-serial`)
- Test: `apps/api/src/db/topic-grades-migration.spec.ts`

**Interfaces:**
- Consumes: `topics`, `gradeLevels` de `./topics.schema` / `./grade-levels.schema`; `runMigrations` de `../db/migrate` (solo como referencia — el spec llama a `migrate()` directo con su propia `Pool`).
- Produces:
  ```ts
  // apps/api/src/db/schema/topic-grades.schema.ts
  export const topicGrades: PgTableWithColumns<{
    topicId: uuid;      // FK topics.id ON DELETE CASCADE, notNull
    gradeLevel: text;   // FK grade_levels.code, notNull
  }>;                   // PK (topic_id, grade_level), index topic_grades_grade_level_idx

  // apps/api/src/db/schema/topics.schema.ts — `topics` YA NO tiene `gradeLevel`.
  // Índices: topics_course_id_name_idx (unique), topics_course_id_slug_idx (unique parcial, slug IS NOT NULL)
  ```

- [ ] **Step 1: Escribir el spec de la migración (test rojo)**

Este es el test de feature de toda la tarea: crea una base nueva, la lleva al estado `0022`, mete los fixtures que el spec del diseño describe (dos copias por grado con preguntas, carpetas y una fila de syllabus), corre `0023` y afirma el colapso.

```ts
// apps/api/src/db/topic-grades-migration.spec.ts
import { randomUUID } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client, Pool } from "pg";
import { resolveDatabaseUrl } from "./env";

/**
 * Runs the COMMITTED `0023_topic_grades.sql` against a throwaway database
 * that has been brought to the `0022` state first — the only way to test a
 * one-way data migration, since the shared dev database is already past it.
 *
 * Why a whole database and not a schema: every generated migration writes
 * `REFERENCES "public"."…"` (see `0022_question_folders.sql`), so a second
 * Postgres schema would still point its foreign keys at `public`.
 *
 * Why this works: `readMigrationFiles` (drizzle-orm/migrator.js) is driven
 * ENTIRELY by `meta/_journal.json` — it reads only the `.sql` files the
 * journal names. Copying `drizzle/` to a temp dir and trimming the journal to
 * `idx <= 22` therefore yields a migrator that stops exactly at `0022`. The
 * second `migrate()` call, with the real folder, applies only `0023`, because
 * the migrator compares each entry's `when` against the last applied one
 * (`drizzle-orm/pg-core/dialect.js:56`).
 *
 * Lives in the `db-serial` jest project: it creates and drops a database, and
 * it must not race the parallel `non-e2e` workers.
 */
describe("0023_topic_grades migration", () => {
  const apiRoot = resolve(__dirname, "../..");
  const migrationsDir = join(apiRoot, "drizzle");
  const dbName = `topic_grades_migration_${randomUUID().replace(/-/g, "")}`;

  let adminClient: Client;
  let pool: Pool;
  let tmpMigrationsDir: string;

  /** The throwaway database's URL — same host/credentials, different database name. */
  function scratchUrl(): string {
    const url = new URL(resolveDatabaseUrl());
    url.pathname = `/${dbName}`;
    return url.toString();
  }

  beforeAll(async () => {
    adminClient = new Client({ connectionString: resolveDatabaseUrl() });
    await adminClient.connect();
    await adminClient.query(`create database "${dbName}"`);

    // A copy of `drizzle/` whose journal stops at 0022.
    tmpMigrationsDir = mkdtempSync(join(tmpdir(), "drizzle-0022-"));
    cpSync(migrationsDir, tmpMigrationsDir, { recursive: true });
    const journalPath = join(tmpMigrationsDir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
      entries: Array<{ idx: number }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 22);
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));

    pool = new Pool({ connectionString: scratchUrl() });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    rmSync(tmpMigrationsDir, { recursive: true, force: true });
    await adminClient.query(`drop database if exists "${dbName}"`);
    await adminClient.end();
  }, 60_000);

  it("collapses per-grade topic copies, repoints every FK, merges folders and strips the grade suffix", async () => {
    const db = drizzle(pool);

    // --- state 0022 -------------------------------------------------------
    await migrate(db, { migrationsFolder: tmpMigrationsDir });

    // `grade_levels` is a seeded catalog, and the collapse orders by its
    // `sort_order` — insert the two rows the fixture needs by hand.
    await pool.query(
      `insert into grade_levels (code, sort_order) values ('secundaria_4', 9), ('secundaria_5', 10)`,
    );

    const suffix = randomUUID();
    const { rows: [course] } = await pool.query<{ id: string }>(
      `insert into courses (name, stage) values ($1, 'colegio') returning id`,
      [`Mig Course ${suffix}`],
    );
    // Two copies of ONE concept, one row per grade — the shape being retired.
    // `secundaria_4` has the lower sort_order, so IT is the canonical row.
    const { rows: [topic4] } = await pool.query<{ id: string }>(
      `insert into topics (course_id, name, grade_level) values ($1, $2, 'secundaria_4') returning id`,
      [course.id, `Trigo ${suffix}`],
    );
    const { rows: [topic5] } = await pool.query<{ id: string }>(
      `insert into topics (course_id, name, grade_level) values ($1, $2, 'secundaria_5') returning id`,
      [course.id, `Trigo ${suffix}`],
    );

    const { rows: [tenant] } = await pool.query<{ id: string }>(
      `insert into tenants (name, slug) values ($1, $2) returning id`,
      [`Mig Tenant ${suffix}`, `mig-tenant-${suffix}`],
    );
    const { rows: [user] } = await pool.query<{ id: string }>(
      `insert into users (tenant_id, email, password_hash, role) values ($1, $2, 'x', 'teacher') returning id`,
      [tenant.id, `mig-${suffix}@exams-generator.test`],
    );

    // A question on the NON-canonical copy: it must end up on the canonical
    // topic with its OWN grade_level untouched.
    const { rows: [question] } = await pool.query<{ id: string }>(
      `insert into questions
         (tenant_id, topic_id, difficulty, grade_level, status, type, body_typst, body_hash, alternatives, correct_answer, created_by)
       values ($1, $2, 'medium', 'secundaria_5', 'approved', 'structured', 'Enunciado', $3, $4, '0', $5)
       returning id`,
      [tenant.id, topic5.id, randomUUID(), JSON.stringify(["a", "b", "c", "d"]), user.id],
    );

    // Two seeded folders, one per copy, with the grade suffix the seeder wrote.
    const { rows: [folder4] } = await pool.query<{ id: string }>(
      `insert into question_folders (tenant_id, parent_id, name, topic_id, position)
       values ($1, null, $2, $3, 0) returning id`,
      [tenant.id, `Trigo ${suffix} · 4° secundaria`, topic4.id],
    );
    const { rows: [folder5] } = await pool.query<{ id: string }>(
      `insert into question_folders (tenant_id, parent_id, name, topic_id, position)
       values ($1, null, $2, $3, 1) returning id`,
      [tenant.id, `Trigo ${suffix} · 5° secundaria`, topic5.id],
    );
    // A child of the folder that will LOSE the merge — it must be re-parented.
    const { rows: [child] } = await pool.query<{ id: string }>(
      `insert into question_folders (tenant_id, parent_id, name, topic_id, position)
       values ($1, $2, $3, null, 0) returning id`,
      [tenant.id, folder5.id, `Sub ${suffix}`],
    );
    // The question is filed under the loser folder.
    await pool.query(`update questions set folder_id = $1 where id = $2`, [folder5.id, question.id]);

    // A syllabus row on EACH copy for the same template — the collapse must
    // delete the redundant one instead of violating (template_id, topic_id).
    const { rows: [university] } = await pool.query<{ id: string }>(
      `insert into universities (code, name) values ($1, $2) returning id`,
      [`mig-uni-${suffix}`, `Mig University ${suffix}`],
    );
    const { rows: [examType] } = await pool.query<{ code: string }>(
      `insert into exam_types (code, label, course_scope, week_scope, sort_order)
       values ($1, 'Mig', 'all', 'none', 900000) returning code`,
      [`mig-type-${suffix}`],
    );
    const { rows: [template] } = await pool.query<{ id: string }>(
      `insert into exam_blueprint_templates (university_id, exam_type_code, name)
       values ($1, $2, $3) returning id`,
      [university.id, examType.code, `Mig Template ${suffix}`],
    );
    await pool.query(
      `insert into syllabus_week_maps (template_id, course_id, topic_id, week_number)
       values ($1, $2, $3, 1), ($1, $2, $4, 2)`,
      [template.id, course.id, topic4.id, topic5.id],
    );

    // --- run 0023 ---------------------------------------------------------
    await migrate(db, { migrationsFolder: migrationsDir });

    // 1. One topic left, and it is the lower-sort_order copy.
    const { rows: remaining } = await pool.query<{ id: string; name: string }>(
      `select id, name from topics where course_id = $1`,
      [course.id],
    );
    expect(remaining.map((row) => row.id)).toEqual([topic4.id]);

    // 2. Both grades survive as topic_grades rows on the canonical topic.
    const { rows: grades } = await pool.query<{ grade_level: string }>(
      `select grade_level from topic_grades where topic_id = $1 order by grade_level`,
      [topic4.id],
    );
    expect(grades.map((row) => row.grade_level)).toEqual(["secundaria_4", "secundaria_5"]);

    // 3. The question moved to the canonical topic and KEPT its own grade.
    const { rows: [movedQuestion] } = await pool.query<{ topic_id: string; grade_level: string; folder_id: string }>(
      `select topic_id, grade_level, folder_id from questions where id = $1`,
      [question.id],
    );
    expect(movedQuestion.topic_id).toBe(topic4.id);
    expect(movedQuestion.grade_level).toBe("secundaria_5");

    // 4. Folders merged into the lowest-position one, which kept the child and
    //    the question, and lost the grade suffix.
    const { rows: folders } = await pool.query<{ id: string; name: string; parent_id: string | null }>(
      `select id, name, parent_id from question_folders where tenant_id = $1 order by position, id`,
      [tenant.id],
    );
    expect(folders.map((row) => row.id).sort()).toEqual([folder4.id, child.id].sort());
    expect(folders.find((row) => row.id === folder4.id)!.name).toBe(`Trigo ${suffix}`);
    expect(folders.find((row) => row.id === child.id)!.parent_id).toBe(folder4.id);
    expect(movedQuestion.folder_id).toBe(folder4.id);

    // 5. The duplicate syllabus row is gone; the survivor points at the canonical topic.
    const { rows: weekMaps } = await pool.query<{ topic_id: string; week_number: number }>(
      `select topic_id, week_number from syllabus_week_maps where template_id = $1`,
      [template.id],
    );
    expect(weekMaps).toEqual([{ topic_id: topic4.id, week_number: 1 }]);

    // 6. The column and the two old indexes are gone; the new ones are there.
    const { rows: columns } = await pool.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'topics' and column_name = 'grade_level'`,
    );
    expect(columns).toEqual([]);

    const { rows: indexes } = await pool.query<{ indexname: string }>(
      `select indexname from pg_indexes where tablename = 'topics' order by indexname`,
    );
    const names = indexes.map((row) => row.indexname);
    expect(names).toContain("topics_course_id_name_idx");
    expect(names).toContain("topics_course_id_slug_idx");
    expect(names).not.toContain("topics_course_id_name_grade_idx");
    expect(names).not.toContain("topics_course_id_slug_grade_idx");

    // 7. The new unique index actually bites.
    await expect(
      pool.query(`insert into topics (course_id, name) values ($1, $2)`, [course.id, `Trigo ${suffix}`]),
    ).rejects.toThrow(/topics_course_id_name_idx/);
  }, 180_000);
});
```

- [ ] **Step 2: Enseñarle a jest el archivo nuevo**

`db-serial` hoy apunta a un solo archivo. Cambiar SOLO el `testRegex` de ese proyecto en `apps/api/jest.config.js`:

```js
      testRegex: "db/(seed-idempotency|topic-grades-migration)\\.spec\\.ts$",
```

…y el `testPathIgnorePatterns` del proyecto `non-e2e`, para que el spec nuevo no corra también en paralelo:

```js
      testPathIgnorePatterns: [
        "<rootDir>/db/seed-idempotency\\.spec\\.ts$",
        "<rootDir>/db/topic-grades-migration\\.spec\\.ts$",
      ],
```

- [ ] **Step 3: Correr el test y verificar que falla**

```bash
pnpm dev:infra
cd apps/api && pnpm exec jest src/db/topic-grades-migration --selectProjects db-serial --runInBand
```

Expected: FAIL. El primer `migrate()` llega a `0022` y los fixtures entran, pero el segundo no aplica nada (todavía no existe `0023`), así que la primera afirmación revienta: `expect(remaining.map(...)).toEqual([topic4.id])` recibe los DOS ids.

- [ ] **Step 4: Escribir el esquema de `topic_grades`**

```ts
// apps/api/src/db/schema/topic-grades.schema.ts
import { index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { gradeLevels } from "./grade-levels.schema";
import { topics } from "./topics.schema";

/**
 * The grades a topic is taught at. Replaces `topics.grade_level`, which forced
 * one ROW per grade and made a single curriculum concept ("Fracciones,
 * decimales y porcentajes") exist twice — 953 rows for 626 names, and ~510
 * duplicate folders per school (audit 2026-09-03).
 *
 * This is the taxonomy axis only. `questions.grade_level` and
 * `generation_jobs.grade_level` are NOT derived from it and do not change: a
 * question carries the grade it was written for, which is allowed to differ
 * from the grades its topic is taught at (86 of 67,029 rows already do).
 *
 * A topic with NO rows here is taught across its whole stage. That state does
 * not exist today — the migration writes at least one row for every topic that
 * had a grade — but the readers (`EXISTS (topic_grades …)`) treat it as
 * "matches no grade filter", which is the conservative reading.
 *
 * `ON DELETE CASCADE` on `topic_id`: retiring a topic must not leave orphan
 * grade rows behind. `grade_level` references the seeded `grade_levels`
 * catalog, same as `questions.grade_level`.
 */
export const topicGrades = pgTable(
  "topic_grades",
  {
    topicId: uuid("topic_id")
      .notNull()
      .references(() => topics.id, { onDelete: "cascade" }),
    gradeLevel: text("grade_level")
      .notNull()
      .references(() => gradeLevels.code),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.topicId, table.gradeLevel] }),
    /** `GET /topics?gradeLevel=` filters on this side, across every course. */
    gradeLevelIdx: index("topic_grades_grade_level_idx").on(table.gradeLevel),
  }),
);
```

- [ ] **Step 5: Quitar `gradeLevel` de `topics` y cambiar sus índices**

Reemplazar el archivo completo `apps/api/src/db/schema/topics.schema.ts`:

```ts
import { sql } from "drizzle-orm";
import { pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { courses } from "./courses.schema";

/**
 * Global taxonomy (e.g. fracciones, ecuaciones): ONE row per curriculum
 * concept per course. The grades it is taught at live in `topic_grades`
 * (design doc 2026-09-03) — this table used to carry a `grade_level` column
 * and be unique by `(course_id, name, grade_level)`, which duplicated every
 * concept once per grade and multiplied selects, trees and seeded folders.
 */
export const topics = pgTable(
  "topics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    courseId: uuid("course_id")
      .notNull()
      .references(() => courses.id),
    name: text("name").notNull(),
    /**
     * Canonical slug (design doc: two-level topic taxonomy). NULL on legacy/
     * variant rows created on demand from raw syllabus labels before the
     * reconciliation pass (`reconcileLegacyTopics` in `db/seed.ts`) folds
     * them into their canonical counterpart and deletes them. A fully
     * reconciled catalog has no `slug IS NULL` row left for the stages the
     * canonical taxonomy covers (currently preuniversitario only).
     */
    slug: text("slug"),
  },
  (table) => ({
    /** One concept, one row. This is the rule the whole 0023 migration exists to establish. */
    courseIdNameIdx: uniqueIndex("topics_course_id_name_idx").on(table.courseId, table.name),
    /**
     * Partial rather than relying on Postgres' NULL-distinct behaviour: it says
     * out loud that only canonical rows (slug set) are deduped, and legacy rows
     * (slug NULL) are exempt by design, not by accident.
     */
    courseIdSlugIdx: uniqueIndex("topics_course_id_slug_idx")
      .on(table.courseId, table.slug)
      .where(sql`${table.slug} is not null`),
  }),
);
```

Nota: `gradeLevels` deja de importarse aquí. En `apps/api/src/db/schema/index.ts`, agregar el export **después** de `topics.schema` (`topic-grades.schema` importa `topics`):

```ts
export * from "./topics.schema";
export * from "./topic-grades.schema";
```

- [ ] **Step 6: Generar la migración**

```bash
cd apps/api && pnpm db:generate
```

Expected: aparecen `drizzle/0023_<adjetivo>_<sustantivo>.sql`, `drizzle/meta/0023_snapshot.json` y una entrada `idx: 23` en `drizzle/meta/_journal.json`.

Renombrar el `.sql` a `0023_topic_grades.sql` **y actualizar el `tag` de esa entrada del journal a `"0023_topic_grades"`** (el journal es lo único que el migrador lee; `meta/0023_snapshot.json` NO se toca, y su nombre no depende del tag).

Revisar el SQL generado antes de tocarlo:

```bash
bat --plain apps/api/drizzle/0023_topic_grades.sql
```

Expected: un `CREATE TABLE "topic_grades"` con su PK, dos `ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` envueltos en `DO $$ … EXCEPTION WHEN duplicate_object …`, un `CREATE INDEX … topic_grades_grade_level_idx`, un `DROP INDEX … topics_course_id_name_grade_idx`, un `DROP INDEX … topics_course_id_slug_grade_idx`, un `ALTER TABLE "topics" DROP COLUMN "grade_level"` y los dos `CREATE UNIQUE INDEX` nuevos. Si el orden difiere, no importa: el paso siguiente lo reordena a mano.

- [ ] **Step 7: Editar el `0023` a mano — la migración de datos**

Reescribir `apps/api/drizzle/0023_topic_grades.sql` así, **conservando textualmente los bloques generados** (create table, FKs, índices, drop column, drop index) y metiendo la migración de datos entre la creación de la tabla y el drop de la columna. `migration-snapshot.spec.ts` sigue pasando: regenera contra `meta/0023_snapshot.json`, no encuentra deriva de esquema, no escribe ningún `.sql` nuevo, y compara el contenido de los archivos existentes contra sí mismos.

```sql
-- 0023_topic_grades
--
-- One topic per curriculum concept; the grades it is taught at move to
-- `topic_grades` (design doc 2026-09-03-taxonomy-topic-grades-design.md,
-- audit 2026-09-03-taxonomy-data-audit.md).
--
-- Schema change AND data collapse in ONE file on purpose: prod runs
-- `migrate && seed && main` (infra/docker-compose.dokploy.yml), the drizzle
-- migrator wraps every pending migration in a single transaction
-- (drizzle-orm/pg-core/dialect.js), and there is no manual step to forget.
-- Irreversible except from the `pg_dump` taken before deploy.

CREATE TABLE IF NOT EXISTS "topic_grades" (
	"topic_id" uuid NOT NULL,
	"grade_level" text NOT NULL,
	CONSTRAINT "topic_grades_topic_id_grade_level_pk" PRIMARY KEY("topic_id","grade_level")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topic_grades" ADD CONSTRAINT "topic_grades_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topic_grades" ADD CONSTRAINT "topic_grades_grade_level_grade_levels_code_fk" FOREIGN KEY ("grade_level") REFERENCES "public"."grade_levels"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "topic_grades_grade_level_idx" ON "topic_grades" USING btree ("grade_level");
--> statement-breakpoint

-- The canonical row of every `(course_id, name)` group: the copy whose grade
-- has the lowest `grade_levels.sort_order`, id as the tie-break. `topics` has
-- no `created_at`, so id IS the tie-break (the design doc's "created_at/id"
-- collapses to id). Grade-less rows sort last via the COALESCE sentinel.
-- TEMP + ON COMMIT DROP: the migrator holds one connection for the whole
-- transaction, and the table must not survive it.
CREATE TEMP TABLE "topic_collapse_map" ON COMMIT DROP AS
SELECT
  t."id" AS copy_id,
  first_value(t."id") OVER (
    PARTITION BY t."course_id", t."name"
    ORDER BY COALESCE(g."sort_order", 2147483647), t."id"
  ) AS canonical_id
FROM "topics" t
LEFT JOIN "grade_levels" g ON g."code" = t."grade_level";
--> statement-breakpoint
CREATE UNIQUE INDEX ON "topic_collapse_map" (copy_id);
--> statement-breakpoint

-- Every grade any copy of the group carried becomes a row on the canonical
-- topic. A topic with NULL grade contributes nothing and ends up with no rows
-- — "taught across the whole stage" (2 preuni topics today).
INSERT INTO "topic_grades" ("topic_id", "grade_level")
SELECT DISTINCT m.canonical_id, t."grade_level"
FROM "topics" t
JOIN "topic_collapse_map" m ON m.copy_id = t."id"
WHERE t."grade_level" IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint

-- Repoint every FK to `topics.id` off the copies. `questions.grade_level` is
-- deliberately untouched: it is the question's OWN axis, not the topic's.
UPDATE "questions" q
SET "topic_id" = m.canonical_id
FROM "topic_collapse_map" m
WHERE m.copy_id = q."topic_id" AND m.canonical_id <> q."topic_id";
--> statement-breakpoint
UPDATE "generation_jobs" j
SET "topic_id" = m.canonical_id
FROM "topic_collapse_map" m
WHERE m.copy_id = j."topic_id" AND m.canonical_id <> j."topic_id";
--> statement-breakpoint
UPDATE "exam_blueprint_rows" r
SET "topic_id" = m.canonical_id
FROM "topic_collapse_map" m
WHERE m.copy_id = r."topic_id" AND m.canonical_id <> r."topic_id";
--> statement-breakpoint
UPDATE "exam_blueprint_template_rows" r
SET "topic_id" = m.canonical_id
FROM "topic_collapse_map" m
WHERE m.copy_id = r."topic_id" AND m.canonical_id <> r."topic_id";
--> statement-breakpoint

-- `subtopics` is unique by (topic_id, slug): drop the copy's row when the
-- canonical topic already owns that slug, then repoint the rest. Nothing uses
-- subtopics today (0 of 67,029 questions carry one), but the FK still blocks
-- the delete below if a row is left pointing at a copy.
DELETE FROM "subtopics" s
USING "topic_collapse_map" m, "subtopics" keep
WHERE m.copy_id = s."topic_id"
  AND m.canonical_id <> s."topic_id"
  AND keep."topic_id" = m.canonical_id
  AND keep."slug" = s."slug";
--> statement-breakpoint
UPDATE "subtopics" s
SET "topic_id" = m.canonical_id
FROM "topic_collapse_map" m
WHERE m.copy_id = s."topic_id" AND m.canonical_id <> s."topic_id";
--> statement-breakpoint

-- `syllabus_week_maps` is unique by (template_id, topic_id): a copy's row is
-- redundant when the canonical topic is already mapped for that template.
DELETE FROM "syllabus_week_maps" w
USING "topic_collapse_map" m, "syllabus_week_maps" keep
WHERE m.copy_id = w."topic_id"
  AND m.canonical_id <> w."topic_id"
  AND keep."template_id" = w."template_id"
  AND keep."topic_id" = m.canonical_id;
--> statement-breakpoint
UPDATE "syllabus_week_maps" w
SET "topic_id" = m.canonical_id
FROM "topic_collapse_map" m
WHERE m.copy_id = w."topic_id" AND m.canonical_id <> w."topic_id";
--> statement-breakpoint

-- Folders. Per tenant, several seeded folders can point at copies of one
-- group; the survivor is the lowest `position` (id as tie-break), and the
-- others hand it their questions and their children before being deleted.
-- `question_folders_tenant_topic_idx` (partial unique on tenant_id, topic_id)
-- is why they cannot simply be repointed.
CREATE TEMP TABLE "folder_merge_map" ON COMMIT DROP AS
SELECT
  f."id" AS loser_id,
  first_value(f."id") OVER (
    PARTITION BY f."tenant_id", m.canonical_id
    ORDER BY f."position", f."id"
  ) AS keeper_id
FROM "question_folders" f
JOIN "topic_collapse_map" m ON m.copy_id = f."topic_id";
--> statement-breakpoint
CREATE UNIQUE INDEX ON "folder_merge_map" (loser_id);
--> statement-breakpoint
UPDATE "questions" q
SET "folder_id" = fm.keeper_id
FROM "folder_merge_map" fm
WHERE fm.loser_id = q."folder_id" AND fm.keeper_id <> q."folder_id";
--> statement-breakpoint
UPDATE "question_folders" f
SET "parent_id" = fm.keeper_id
FROM "folder_merge_map" fm
WHERE fm.loser_id = f."parent_id" AND fm.keeper_id <> f."parent_id";
--> statement-breakpoint
DELETE FROM "question_folders" f
USING "folder_merge_map" fm
WHERE fm.loser_id = f."id" AND fm.keeper_id <> f."id";
--> statement-breakpoint
UPDATE "question_folders" f
SET "topic_id" = m.canonical_id
FROM "topic_collapse_map" m
WHERE m.copy_id = f."topic_id" AND m.canonical_id <> f."topic_id";
--> statement-breakpoint

-- Strip the seeded ` · <grade label>` suffix. Matched against the TOPIC's own
-- name rather than a list of the 12 labels: a folder named exactly
-- "<topic name> · <anything>" is one the seeder wrote, and a folder the
-- teacher renamed by hand never matches, so her name survives.
UPDATE "question_folders" f
SET "name" = left(t."name", 80)
FROM "topics" t
WHERE f."topic_id" = t."id"
  AND f."name" <> left(t."name", 80)
  AND starts_with(f."name", t."name" || ' · ');
--> statement-breakpoint

-- Stripping a suffix (or re-parenting a child above) can land two siblings on
-- the same name, which `question_folders_sibling_name_idx` /
-- `question_folders_root_name_idx` forbid. Same rule the seeder used to apply
-- (`dedupeSiblingNames`): first one keeps the bare name, the rest get " (2)",
-- " (3)", … clamped to 80 characters.
WITH ranked AS (
  SELECT
    "id",
    row_number() OVER (
      PARTITION BY "tenant_id", COALESCE("parent_id", '00000000-0000-0000-0000-000000000000'::uuid), "name"
      ORDER BY "position", "id"
    ) AS rn,
    "name"
  FROM "question_folders"
)
UPDATE "question_folders" f
SET "name" = left(ranked."name", 80 - length(' (' || ranked.rn || ')')) || ' (' || ranked.rn || ')'
FROM ranked
WHERE ranked."id" = f."id" AND ranked.rn > 1;
--> statement-breakpoint

-- Nothing references the copies any more.
DELETE FROM "topics" t
USING "topic_collapse_map" m
WHERE m.copy_id = t."id" AND m.canonical_id <> t."id";
--> statement-breakpoint

DROP INDEX IF EXISTS "topics_course_id_name_grade_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "topics_course_id_slug_grade_idx";--> statement-breakpoint
ALTER TABLE "topics" DROP COLUMN IF EXISTS "grade_level";--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topics_course_id_name_idx" ON "topics" USING btree ("course_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topics_course_id_slug_idx" ON "topics" USING btree ("course_id","slug") WHERE "topics"."slug" is not null;
```

- [ ] **Step 8: Correr el spec de la migración y verificar que pasa**

```bash
cd apps/api && pnpm exec jest src/db/topic-grades-migration --selectProjects db-serial --runInBand
```

Expected: PASS, 1 test.

Si falla en el `DELETE FROM "topics"` con una violación de FK, hay otra tabla apuntando a `topics.id` que este plan no listó:

```bash
rg -n "references\(\(\) => topics.id\)|references\(\(\) => topics\.id" apps/api/src/db/schema
```

Expected hoy: `questions`, `generation_jobs`, `exam_blueprint_rows` (en `exams.schema.ts`), `exam_blueprint_template_rows`, `subtopics`, `syllabus_week_maps`, `question_folders`. Si aparece una octava, se agrega su `UPDATE` antes del `DELETE`.

- [ ] **Step 9: Verificar que no hay deriva de esquema**

```bash
cd apps/api && pnpm exec jest src/db/migration-snapshot --selectProjects non-e2e
```

Expected: PASS. Es la prueba de que el `.sql` editado a mano sigue casando con `meta/0023_snapshot.json`.

- [ ] **Step 10: Aplicar la migración en la base local de desarrollo**

```bash
cd apps/api && pnpm db:migrate
```

Expected: `Migrations applied.` Desde aquí la base local ya está en la forma nueva y el resto de las tareas trabaja sobre ella.

- [ ] **Step 11: Formatear y commitear**

```bash
pnpm format
git checkout -- apps/api/src/common/compression.filter.spec.ts \
                apps/api/src/modules/assets/asset-cache.spec.ts \
                apps/api/src/modules/assets/assets.service.spec.ts \
                apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts
git add apps/api/src/db/schema apps/api/drizzle apps/api/src/db/topic-grades-migration.spec.ts apps/api/jest.config.js
git commit -m "feat(api): collapse topics to one row per concept with a topic_grades table"
```

**Estado al cerrar la tarea:** `pnpm --filter @exams-generator/api typecheck` está ROJO. Los archivos que quedan rotos y quién los arregla: `db/seed.ts`, `db/seed-collected-questions.ts`, `db/seed-lot-questions.ts`, `scripts/{seed-image-question,seed-gap-topic-with-image,seed-preuni-course,refile-round-solid-questions}.ts` (Task 2); `modules/taxonomy/taxonomy.repository.ts` (Task 3); `modules/exams/exams.repository.ts` (Task 4); `modules/bank/bank.repository.ts` (Task 5); `modules/bank/folders/{domain/folder-name.ts,domain/build-seed-folder-plan.ts,bank-folders.repository.ts}` (Task 6).

---

### Task 2: Seed, sembradores y scripts sobre la forma nueva

**Files:**
- Modify: `apps/api/src/db/seed.ts`
- Modify: `apps/api/src/db/seed-collected-questions.ts`
- Modify: `apps/api/src/db/seed-lot-questions.ts`
- Modify: `apps/api/src/scripts/seed-image-question.ts`
- Modify: `apps/api/src/scripts/seed-gap-topic-with-image.ts`
- Modify: `apps/api/src/scripts/seed-preuni-course.ts`
- Modify: `apps/api/src/scripts/refile-round-solid-questions.ts`
- Modify: `apps/api/src/scripts/refile-round-solid-questions.spec.ts`
- Test: `apps/api/src/db/seed-idempotency.spec.ts`

**Interfaces:**
- Consumes: `topics`, `topicGrades` de `./schema` (Task 1); `SyllabusTopic.grades?: readonly GradeLevel[]` (sin cambios de forma en los arreglos del seed).
- Produces: nada nuevo hacia afuera. `seedStage` sigue con la misma firma `(stage: Stage, courseList: readonly SyllabusCourse[]): Promise<void>`.

- [ ] **Step 1: Escribir el test rojo — idempotencia sobre la forma nueva**

En `apps/api/src/db/seed-idempotency.spec.ts`, agregar `topicGrades` al import de `./schema` y reemplazar el bloque final del test (el bucle sobre `SYLLABUS_COURSES`):

```ts
    for (const { stage, name } of SYLLABUS_COURSES) {
      const courseRows = await db
        .select()
        .from(courses)
        .where(and(eq(courses.stage, stage), eq(courses.name, name)));
      expect(courseRows).toHaveLength(1);

      const topicRows = await db.select().from(topics).where(eq(topics.courseId, courseRows[0]!.id));
      // One row per CONCEPT now: the key is the name alone, and a second seed
      // run must not add a copy (it used to be `name:gradeLevel`, back when a
      // topic existed once per grade).
      expect(topicRows.length).toBeGreaterThan(0);
      const names = topicRows.map((row) => row.name);
      expect(new Set(names).size).toBe(topicRows.length);

      // The grades moved to `topic_grades`, and that table must not grow on
      // the second run either — `onConflictDoNothing` on its composite PK.
      const gradeRows = await db
        .select()
        .from(topicGrades)
        .where(
          inArray(
            topicGrades.topicId,
            topicRows.map((row) => row.id),
          ),
        );
      expect(gradeRows.length).toBeGreaterThan(0);
      const gradeKeys = gradeRows.map((row) => `${row.topicId}:${row.gradeLevel}`);
      expect(new Set(gradeKeys).size).toBe(gradeRows.length);
    }
```

…y agregar `inArray` al import de `drizzle-orm` (hoy importa `and, eq`).

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
cd apps/api && pnpm exec jest src/db/seed-idempotency --selectProjects db-serial --runInBand
```

Expected: FAIL dentro de `seed()`, en `seedStage`: `column "grade_level" of relation "topics" does not exist`. Ese es el fallo correcto — el seed todavía escribe la columna que la Task 1 borró.

- [ ] **Step 3: Reescribir `seedStage`**

En `apps/api/src/db/seed.ts`, reemplazar la función y su docstring (hoy en ~2158-2189):

```ts
/**
 * Seeds one stage's courses and topics. A course is unique by `(stage, name)`;
 * a topic is ONE row per `(course_id, name)`, and the grades it lists
 * (`grades`) become rows in `topic_grades` — or the single `pre` grade when it
 * lists none (whole-stage / preuniversitario). Every insert is
 * `onConflictDoNothing`, so reseeding is a no-op.
 */
async function seedStage(stage: Stage, courseList: readonly SyllabusCourse[]): Promise<void> {
  for (const course of courseList) {
    await db
      .insert(courses)
      .values({ name: course.name, stage })
      .onConflictDoNothing({ target: [courses.stage, courses.name] });

    const [courseRow] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.stage, stage), eq(courses.name, course.name)));

    if (!courseRow) {
      throw new Error(`Seed invariant violated: course '${course.name}' (${stage}) missing after insert`);
    }

    for (const topic of course.topics) {
      await db
        .insert(topics)
        .values({ courseId: courseRow.id, name: topic.name })
        .onConflictDoNothing({ target: [topics.courseId, topics.name] });

      // Read back rather than `.returning()`: `onConflictDoNothing` returns no
      // row when the topic already existed, which is the steady state.
      const [topicRow] = await db
        .select({ id: topics.id })
        .from(topics)
        .where(and(eq(topics.courseId, courseRow.id), eq(topics.name, topic.name)));

      if (!topicRow) {
        throw new Error(
          `Seed invariant violated: topic '${topic.name}' (${course.name}/${stage}) missing after insert`,
        );
      }

      const topicGradeList: readonly GradeLevel[] = topic.grades ?? (["pre"] as const);
      await db
        .insert(topicGrades)
        .values(topicGradeList.map((gradeLevel) => ({ topicId: topicRow.id, gradeLevel })))
        .onConflictDoNothing({ target: [topicGrades.topicId, topicGrades.gradeLevel] });
    }
  }
}
```

Agregar `topicGrades` al import de `./schema` al tope de `seed.ts`.

- [ ] **Step 4: Sacar la convergencia de grados nulos y arreglar `seedCanonicalTaxonomy`**

En `seed()` (~1761), **borrar** estas dos líneas, que ya no aplican — la migración `0023` hizo ese trabajo una vez y para siempre:

```ts
  // Converge any legacy null-grade topics (seeded before the stage migration)
  // to preuniversitario's single grade so the unique index dedupes on reseed.
  await db.update(topics).set({ gradeLevel: "pre" }).where(isNull(topics.gradeLevel));
```

En `seedCanonicalTaxonomy` (~1841), quitar el filtro por grado de la lectura:

```ts
    const existingRows = await db
      .select({ id: topics.id, name: topics.name, slug: topics.slug })
      .from(topics)
      .where(eq(topics.courseId, courseId));
```

…y en el insert (~1871), quitar `gradeLevel` y escribir el grado en `topic_grades`:

```ts
      const [inserted] = await db
        .insert(topics)
        .values({ courseId, name: topic.name, slug: topic.slug })
        .returning({ id: topics.id });
      if (!inserted) {
        throw new Error(
          `Seed invariant violated: insert into topics returned no row for '${topic.slug}' (${courseEntry.course})`,
        );
      }
      topicIdBySlug.set(topic.slug, inserted.id);
```

…y justo después del bucle `for (const topic of courseEntry.topics) { … }` que resuelve `topicIdBySlug`, agregar la escritura de grados para TODOS los temas canónicos del curso (los adoptados por slug/nombre también):

```ts
    // Every canonical topic is preuniversitario, i.e. taught at the single
    // `pre` grade. Written here rather than inside the branches above so an
    // ADOPTED legacy row (slug set on an existing topic) gets its grade too.
    if (topicIdBySlug.size > 0) {
      await db
        .insert(topicGrades)
        .values([...topicIdBySlug.values()].map((topicId) => ({ topicId, gradeLevel: "pre" as GradeLevel })))
        .onConflictDoNothing({ target: [topicGrades.topicId, topicGrades.gradeLevel] });
    }
```

Actualizar el docstring de `seedCanonicalTaxonomy`: la razón de resolver los temas a mano ya no es `topics_course_id_name_grade_idx` sino `topics_course_id_name_idx` — el mecanismo es el mismo (un tema canónico puede tener el nombre exacto de una fila legacy del mismo curso), solo cambió el nombre del índice.

Si `isNull` queda sin usar en `seed.ts` tras borrar la convergencia, quitarlo del import de `drizzle-orm`; comprobarlo con `rg -n "isNull\(" apps/api/src/db/seed.ts`.

- [ ] **Step 5: `reconcileLegacyTopics` — indexado sin grado**

Ya está indexado por `${courseName} ${name}` (`index.set` en `seedCanonicalTaxonomy`) y no lee `topics.gradeLevel` en ningún lado — comprobarlo:

```bash
rg -n "gradeLevel" apps/api/src/db/seed.ts
```

Expected tras los pasos anteriores: solo apariciones en `seedGradeLevels` (`GRADE_LEVELS`/`gradeLevels`), en `seedStage` (`topicGradeList`) y en `seedCanonicalTaxonomy` (`"pre"`). Ninguna sobre `topics.gradeLevel`. Si sale alguna, arreglarla ahí mismo.

- [ ] **Step 6: `seed-collected-questions.ts` — clave sin grado + alta de `topic_grades`**

En `apps/api/src/db/seed-collected-questions.ts`, reemplazar la construcción del mapa (~94-99):

```ts
  const topicRows = await db
    .select({ id: topics.id, courseId: topics.courseId, name: topics.name })
    .from(topics);
  const topicIdByKey = new Map<string, string>();
  for (const row of topicRows) {
    topicIdByKey.set(`${row.courseId}|${row.name}`, row.id);
  }

  /**
   * Grades this pass discovers on entries whose topic does not list them yet.
   * Collected in memory and written once at the end, rather than one INSERT
   * per entry: the corpus is ~64k entries over ~626 topics, so the set is tiny
   * and the write is a single statement.
   */
  const discoveredGrades = new Set<string>();
```

…la resolución del tema (~180-184):

```ts
        const topicId = courseIds
          .map((courseId) => topicIdByKey.get(`${courseId}|${entry.topicName}`))
          .find(Boolean);
        if (!topicId) {
          throw new Error(`topic not found: ${entry.topicName} in ${entry.courseName}`);
        }
        // The entry's grade is the QUESTION's axis and always lands on
        // `questions.grade_level` below. If the taxonomy does not list it for
        // this topic yet, add it — a collected question is evidence the topic
        // is assessed at that grade.
        discoveredGrades.add(`${topicId}|${entry.gradeLevel}`);
```

…y, después del último `await flush()` y antes del `console.log` de resumen, escribir los grados descubiertos:

```ts
  if (discoveredGrades.size > 0) {
    await db
      .insert(topicGrades)
      .values(
        [...discoveredGrades].map((key) => {
          const [topicId, gradeLevel] = key.split("|") as [string, GradeLevel];
          return { topicId, gradeLevel };
        }),
      )
      .onConflictDoNothing({ target: [topicGrades.topicId, topicGrades.gradeLevel] });
  }
```

Agregar `topicGrades` al import de `./schema` y `GradeLevel` al import de tipos (el archivo ya importa `isGradeLevel`; el tipo sale del mismo módulo).

Localizar el punto exacto del `flush` final con:

```bash
rg -n "await flush\(\)|console.log\(\`\[seed-collected-questions\]" apps/api/src/db/seed-collected-questions.ts
```

- [ ] **Step 7: `seed-lot-questions.ts` — alta de `topic_grades`**

Su mapa ya usa `${course.name}${topic.name}`, sin grado, así que **no cambia**. Lo que falta es lo mismo que arriba: registrar el grado de la pregunta en la taxonomía. Después del bucle `for (const question of plan.toInsert) { … }`, agregar:

```ts
  if (discoveredGrades.size > 0) {
    await db
      .insert(topicGrades)
      .values(
        [...discoveredGrades].map((key) => {
          const [topicId, gradeLevel] = key.split("|") as [string, GradeLevel];
          return { topicId, gradeLevel };
        }),
      )
      .onConflictDoNothing({ target: [topicGrades.topicId, topicGrades.gradeLevel] });
  }
```

…declarando `const discoveredGrades = new Set<string>();` junto a `let inserted = 0;`, y llenándolo dentro del `try` del bucle, justo después de resolver `topicId`:

```ts
      discoveredGrades.add(`${topicId}|${question.gradeLevel}`);
```

Agregar `topicGrades` al import de `./schema` y `GradeLevel` al de tipos.

- [ ] **Step 8: Los cuatro scripts de una sola pasada**

Los cuatro filtran temas por `topics.gradeLevel`. El filtro simplemente desaparece: el nombre ya identifica al tema dentro del curso.

`apps/api/src/scripts/seed-image-question.ts` (~86-90) y `apps/api/src/scripts/seed-gap-topic-with-image.ts` (~86-90), idéntico en ambos:

```ts
        .where(and(inArray(topics.courseId, courseIds), eq(topics.name, entry.topicName)));
```

`apps/api/src/scripts/seed-preuni-course.ts` (~109-114):

```ts
      .where(and(inArray(topics.courseId, courseIds), eq(topics.name, topic.name)));
```

`apps/api/src/scripts/refile-round-solid-questions.ts`: quitar `gradeLevel: topics.gradeLevel` de la proyección (~47) y la línea del desempate por grado en el `where` del tema destino (~72), que queda:

```ts
    const [target] = await db
      .select({ id: topics.id })
      .from(topics)
      .where(and(eq(topics.courseId, row.courseId), eq(topics.slug, TARGET_SLUG)));
```

Si `isNull` queda sin uso en ese archivo, sacarlo del import.

En `apps/api/src/scripts/refile-round-solid-questions.spec.ts`, quitar `gradeLevel: "pre"` de los dos `insert(topics).values({...})` (~64 y ~70).

- [ ] **Step 9: Correr los tests tocados**

```bash
cd apps/api && pnpm exec jest src/scripts/refile-round-solid-questions --selectProjects non-e2e
```

Expected: PASS.

```bash
cd apps/api && pnpm exec jest src/db/seed-idempotency --selectProjects db-serial --runInBand
```

Expected: PASS, 1 test. Ojo: en una base ya sembrada tarda ~10s; en una recién migrada, hasta ~60s (ingesta de las 64k preguntas del corpus). El presupuesto del test son 90s.

- [ ] **Step 10: Formatear y commitear**

```bash
pnpm format
git checkout -- apps/api/src/common/compression.filter.spec.ts \
                apps/api/src/modules/assets/asset-cache.spec.ts \
                apps/api/src/modules/assets/assets.service.spec.ts \
                apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts
git add apps/api/src/db apps/api/src/scripts
git commit -m "refactor(api): seed topic grades into topic_grades instead of duplicating topics"
```

---

### Task 3: `GET /topics` devuelve `gradeLevels` y filtra por `topic_grades`

**Files:**
- Modify: `apps/api/src/modules/taxonomy/taxonomy.repository.ts`
- Test: `apps/api/src/modules/taxonomy/taxonomy.e2e.spec.ts`
- Test: `apps/api/src/modules/taxonomy/taxonomy.repository.spec.ts`

**Interfaces:**
- Consumes: `topics`, `topicGrades`, `gradeLevels`, `courses` de `../../db/schema`.
- Produces:
  ```ts
  // apps/api/src/modules/taxonomy/taxonomy.repository.ts
  export interface TopicListItem {
    readonly id: string;
    readonly name: string;
    readonly courseId: string;
    /** Grades this topic is taught at, ordered by `grade_levels.sort_order`. Empty = whole stage. */
    readonly gradeLevels: readonly string[];
  }
  export class TaxonomyRepository {
    findTopics(courseId?: string, gradeLevel?: string): Promise<TopicListItem[]>;
    findTopicsByCourseIds(courseIds: string[], gradeLevel?: string): Promise<TopicListItem[]>;
  }
  ```
  `taxonomy.controller.ts` y `taxonomy.service.ts` **no cambian**: las firmas son las mismas y solo re-exportan el tipo.

- [ ] **Step 1: Escribir el test rojo — e2e**

En `apps/api/src/modules/taxonomy/taxonomy.e2e.spec.ts`:

- Agregar `topicGrades` al import de `../../db/schema`.
- En el `beforeAll`, después de crear `topicA`, darle DOS grados y a `topicB` uno solo:

```ts
    await db.insert(topicGrades).values([
      { topicId: topicAId, gradeLevel: "secundaria_1" },
      { topicId: topicAId, gradeLevel: "secundaria_2" },
    ]);
    await db.insert(topicGrades).values({ topicId: topicBId, gradeLevel: "pre" });
```

- En el `afterAll`, el borrado de `topics` ya arrastra `topic_grades` por `ON DELETE CASCADE` — no hace falta un paso nuevo. Dejarlo como está.
- Reemplazar el test `"filters topics by courseId"` y agregar tres casos nuevos dentro del `describe("GET /topics")`:

```ts
    it("filters topics by courseId and carries every grade the topic is taught at", async () => {
      const res = await request(app.getHttpServer())
        .get("/topics")
        .query({ courseId: courseAId })
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      // ONE row for the concept, not one per grade — the whole point of 0023.
      expect(res.body).toEqual([
        {
          id: topicAId,
          name: `E2E Topic A ${suffix}`,
          courseId: courseAId,
          gradeLevels: ["secundaria_1", "secundaria_2"],
        },
      ]);
    });

    it("includes a topic when ?gradeLevel= is one of its grades", async () => {
      const res = await request(app.getHttpServer())
        .get("/topics")
        .query({ courseId: courseAId, gradeLevel: "secundaria_2" })
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect((res.body as Array<{ id: string }>).map((topic) => topic.id)).toEqual([topicAId]);
    });

    it("excludes a topic when ?gradeLevel= is a grade it is NOT taught at", async () => {
      const res = await request(app.getHttpServer())
        .get("/topics")
        .query({ courseId: courseAId, gradeLevel: "secundaria_5" })
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("refuses a second topic with the same name in the same course", async () => {
      // The taxonomy's new shape, enforced by `topics_course_id_name_idx`:
      // a concept exists once per course, and its grades live in topic_grades.
      await expect(
        db.insert(topics).values({ courseId: courseAId, name: `E2E Topic A ${suffix}` }),
      ).rejects.toThrow(/topics_course_id_name_idx/);
    });
```

- [ ] **Step 2: Escribir el test rojo — repositorio**

En `apps/api/src/modules/taxonomy/taxonomy.repository.spec.ts`:

- Agregar `topicGrades` al import de `../../db/schema`.
- Quitar `gradeLevel: "secundaria_1"` / `gradeLevel: "pre"` de los tres `insert(topics)` del `beforeAll` (líneas ~50, ~56 y ~69) y, después de los tres, agregar:

```ts
    await db.insert(topicGrades).values([
      { topicId: topicAId, gradeLevel: "secundaria_1" },
      { topicId: topicAId, gradeLevel: "secundaria_2" },
      { topicId: topicBId, gradeLevel: "pre" },
      { topicId: testFactoryTopicId, gradeLevel: "secundaria_1" },
    ]);
```

- Reemplazar el test `"filters topics by grade level"`:

```ts
    it("filters topics by grade level through topic_grades, not by a column on the topic", async () => {
      const bySecundaria1 = await repository.findTopics(courseAId, "secundaria_1");
      expect(bySecundaria1.map((t) => t.id)).toEqual([topicAId]);

      // The SAME topic, matched by its second grade — one row, two grades.
      const bySecundaria2 = await repository.findTopics(courseAId, "secundaria_2");
      expect(bySecundaria2.map((t) => t.id)).toEqual([topicAId]);

      const bySecundaria5 = await repository.findTopics(courseAId, "secundaria_5");
      expect(bySecundaria5).toEqual([]);
    });

    it("projects the grades ordered by the catalog's sort_order", async () => {
      const [topic] = await repository.findTopics(courseAId);
      expect(topic!.gradeLevels).toEqual(["secundaria_1", "secundaria_2"]);
    });

    it("returns an empty grade list for a topic taught across its whole stage", async () => {
      const bare = await db
        .insert(topics)
        .values({ courseId: courseAId, name: `Topic Bare ${suffix}` })
        .returning({ id: topics.id });
      try {
        const found = (await repository.findTopics(courseAId)).find((t) => t.id === bare[0]!.id);
        expect(found!.gradeLevels).toEqual([]);
      } finally {
        await db.delete(topics).where(eq(topics.id, bare[0]!.id));
      }
    });
```

Agregar `eq` al import de `drizzle-orm` (hoy importa solo `inArray`).

- [ ] **Step 3: Correr los dos y verificar que fallan**

```bash
cd apps/api && pnpm exec jest src/modules/taxonomy --selectProjects non-e2e
```

Expected: FAIL con `column topics.grade_level does not exist` — el repositorio todavía la proyecta.

```bash
cd apps/api && pnpm exec jest src/modules/taxonomy --selectProjects e2e --runInBand
```

Expected: FAIL, mismo motivo.

- [ ] **Step 4: Reescribir el repositorio**

En `apps/api/src/modules/taxonomy/taxonomy.repository.ts`, agregar `topicGrades` y `gradeLevels` al import de `../../db/schema`, y reemplazar `TopicListItem` y los dos métodos:

```ts
export interface TopicListItem {
  readonly id: string;
  readonly name: string;
  readonly courseId: string;
  /**
   * Every grade this topic is taught at, ordered by the catalog's
   * `sort_order`. Replaced `gradeLevel: string | null` when a topic stopped
   * being one row per grade (design doc 2026-09-03): the concept is one row
   * now, and the grades are the attribute.
   *
   * An EMPTY array means "taught across the whole stage" — the `?gradeLevel=`
   * filter below then excludes it, since there is no row to match.
   */
  readonly gradeLevels: readonly string[];
}
```

```ts
  /**
   * Filters by `courseId` and/or the grade a topic is taught at, when
   * provided; otherwise returns every topic. Grade filtering is an `EXISTS`
   * over `topic_grades` — it must NOT be a join, or a topic taught at three
   * grades would come back three times.
   *
   * The grade list itself comes from a `left join` + `array_agg` in the SAME
   * query (no N+1): `filter (where …)` keeps the array empty instead of
   * `[null]` for a topic with no grade rows, and the `order by` inside the
   * aggregate is what makes the list deterministic (catalog order, not insert
   * order).
   */
  async findTopics(courseId?: string, gradeLevel?: string): Promise<TopicListItem[]> {
    return db
      .select({
        id: topics.id,
        name: topics.name,
        courseId: topics.courseId,
        gradeLevels: topicGradesAgg,
      })
      .from(topics)
      .innerJoin(courses, eq(topics.courseId, courses.id))
      .leftJoin(topicGrades, eq(topicGrades.topicId, topics.id))
      .leftJoin(gradeLevels, eq(gradeLevels.code, topicGrades.gradeLevel))
      .where(
        and(
          excludesTestCourseName,
          excludesTestTopicName,
          ...(courseId ? [eq(topics.courseId, courseId)] : []),
          ...(gradeLevel ? [topicTaughtAt(gradeLevel)] : []),
        ),
      )
      .groupBy(topics.id, topics.name, topics.courseId);
  }

  /**
   * Batched sibling of `findTopics` — fetches topics for MULTIPLE courses in
   * a single query. Fixes the N+1 fan-out where 3 Angular components each
   * issued one `GET /topics?courseId=X` per course in parallel (`forkJoin`),
   * which tripped the global `ThrottlerGuard`. An empty `courseIds` returns
   * `[]` immediately WITHOUT querying — an empty `inArray(...)` is unsafe/
   * version-dependent (can behave as an always-false predicate rather than
   * "no filter"), so this never hands Drizzle an empty list.
   */
  async findTopicsByCourseIds(courseIds: string[], gradeLevel?: string): Promise<TopicListItem[]> {
    if (courseIds.length === 0) {
      return [];
    }

    return db
      .select({
        id: topics.id,
        name: topics.name,
        courseId: topics.courseId,
        gradeLevels: topicGradesAgg,
      })
      .from(topics)
      .innerJoin(courses, eq(topics.courseId, courses.id))
      .leftJoin(topicGrades, eq(topicGrades.topicId, topics.id))
      .leftJoin(gradeLevels, eq(gradeLevels.code, topicGrades.gradeLevel))
      .where(
        and(
          excludesTestCourseName,
          excludesTestTopicName,
          inArray(topics.courseId, courseIds),
          ...(gradeLevel ? [topicTaughtAt(gradeLevel)] : []),
        ),
      )
      .groupBy(topics.id, topics.name, topics.courseId);
  }
```

Y arriba, junto a `excludesTestCourseName`, los dos fragmentos compartidos:

```ts
/**
 * The grade list of the row being selected, in catalog order. `filter (where
 * … is not null)` is load-bearing: a plain `array_agg` over a `left join` with
 * no match yields `{NULL}`, and the web would render an empty option.
 */
const topicGradesAgg = sql<string[]>`coalesce(
  array_agg(${topicGrades.gradeLevel} order by ${gradeLevels.sortOrder})
    filter (where ${topicGrades.gradeLevel} is not null),
  '{}'
)`;

/**
 * `?gradeLevel=` as an EXISTS rather than a join condition. A join would drop
 * the topic's OTHER grades from the aggregate above (the filter would prune
 * the joined rows), so the response would say a topic is taught only at the
 * grade you happened to ask for.
 */
function topicTaughtAt(gradeLevel: string): SQL {
  return sql`exists (
    select 1 from ${topicGrades}
    where ${topicGrades.topicId} = ${topics.id}
      and ${topicGrades.gradeLevel} = ${gradeLevel}
  )`;
}
```

Agregar `type SQL` al import de `drizzle-orm`.

- [ ] **Step 5: Correr los dos y verificar que pasan**

```bash
cd apps/api && pnpm exec jest src/modules/taxonomy --selectProjects non-e2e
```

Expected: PASS.

```bash
cd apps/api && pnpm exec jest src/modules/taxonomy --selectProjects e2e --runInBand
```

Expected: PASS.

- [ ] **Step 6: Formatear y commitear**

```bash
pnpm format
git checkout -- apps/api/src/common/compression.filter.spec.ts \
                apps/api/src/modules/assets/asset-cache.spec.ts \
                apps/api/src/modules/assets/assets.service.spec.ts \
                apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts
git add apps/api/src/modules/taxonomy
git commit -m "feat(api): serve topic grades as a list and filter GET /topics through topic_grades"
```

---

### Task 4: `exams.repository.getTopicsForCourses` filtra por `topic_grades`

Chica a propósito: es la ÚNICA lectura de grado de tema que queda fuera del módulo `taxonomy`, la usa `resolveBlueprint` (`exams.service.ts:778`) con `TEMPLATE_GRADE_LEVEL = "pre"`, y ningún e2e cubre `POST /exams/blueprint/resolve` (ver Ambigüedad 7). Su test de integración va en `exams.repository.spec.ts`, que ya corre contra el Postgres real.

**Files:**
- Modify: `apps/api/src/modules/exams/exams.repository.ts:990-1008`
- Test: `apps/api/src/modules/exams/exams.repository.spec.ts`

**Interfaces:**
- Consumes: `topics`, `topicGrades`, `courses` de `../../db/schema`; `TEST_TAXONOMY_NAME_PATTERN`.
- Produces: `getTopicsForCourses(courseIds: readonly string[], gradeLevel: string): Promise<CourseTopic[]>` — **misma firma**, mismo `CourseTopic { courseId, topicId }`. `exams-repository.port.ts:320` no cambia.

- [ ] **Step 1: Escribir el test rojo**

En `apps/api/src/modules/exams/exams.repository.spec.ts`, agregar `topicGrades` al import de `../../db/schema` y un `describe` nuevo al final del archivo (antes del cierre del `describe("ExamsRepository")`):

```ts
  describe("getTopicsForCourses()", () => {
    let gradedTopicId: string;
    let otherGradeTopicId: string;

    beforeAll(async () => {
      const suffix = randomUUID().replace(/-/g, "");

      const [preTopic] = await db
        .insert(topics)
        .values({ courseId, name: `Blueprint Pre Topic ${suffix}` })
        .returning({ id: topics.id });
      gradedTopicId = preTopic!.id;
      createdTopicIds.push(gradedTopicId);

      const [schoolTopic] = await db
        .insert(topics)
        .values({ courseId, name: `Blueprint School Topic ${suffix}` })
        .returning({ id: topics.id });
      otherGradeTopicId = schoolTopic!.id;
      createdTopicIds.push(otherGradeTopicId);

      await db.insert(topicGrades).values([
        { topicId: gradedTopicId, gradeLevel: "pre" },
        { topicId: otherGradeTopicId, gradeLevel: "secundaria_1" },
      ]);
    });

    it("returns only the topics taught at the requested grade", async () => {
      const rows = await repository.getTopicsForCourses([courseId], "pre");
      const ids = rows.map((row) => row.topicId);

      expect(ids).toContain(gradedTopicId);
      expect(ids).not.toContain(otherGradeTopicId);
    });

    it("returns a topic taught at several grades exactly ONCE per grade asked for", async () => {
      // The regression the EXISTS exists for: a join on topic_grades would
      // return one row per matching grade row, and `resolveBlueprint` would
      // build duplicate blueprint rows for the same topic.
      await db.insert(topicGrades).values({ topicId: gradedTopicId, gradeLevel: "secundaria_5" });

      const rows = await repository.getTopicsForCourses([courseId], "pre");
      expect(rows.filter((row) => row.topicId === gradedTopicId)).toHaveLength(1);
    });

    it("returns [] for an empty course list without querying", async () => {
      await expect(repository.getTopicsForCourses([], "pre")).resolves.toEqual([]);
    });
  });
```

Comprobar que `createdTopicIds` se limpia en el `afterAll` del archivo (existe: `let createdTopicIds: string[]` en la cabecera).

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
cd apps/api && pnpm exec jest src/modules/exams/exams.repository --selectProjects non-e2e
```

Expected: FAIL con `column topics.grade_level does not exist`.

- [ ] **Step 3: Implementar**

Reemplazar el cuerpo de `getTopicsForCourses` en `apps/api/src/modules/exams/exams.repository.ts` (~990-1008):

```ts
  /**
   * The topics of a set of courses that are TAUGHT at `gradeLevel` — the
   * catalog `resolveBlueprint` expands a `week_scope='none'` exam type into.
   *
   * `exists (topic_grades …)` and not a join: a topic taught at several grades
   * would otherwise come back once per grade row and the blueprint would carry
   * the same topic twice.
   */
  async getTopicsForCourses(courseIds: readonly string[], gradeLevel: string): Promise<CourseTopic[]> {
    if (courseIds.length === 0) {
      return [];
    }

    return this.db
      .select({ courseId: topics.courseId, topicId: topics.id })
      .from(topics)
      .innerJoin(courses, eq(topics.courseId, courses.id))
      .where(
        and(
          sql`${courses.name} !~ ${TEST_TAXONOMY_NAME_PATTERN}`,
          sql`${topics.name} !~ ${TEST_TAXONOMY_NAME_PATTERN}`,
          inArray(topics.courseId, [...courseIds]),
          sql`exists (
            select 1 from ${topicGrades}
            where ${topicGrades.topicId} = ${topics.id}
              and ${topicGrades.gradeLevel} = ${gradeLevel}
          )`,
        ),
      )
      .orderBy(asc(topics.name));
  }
```

Agregar `topicGrades` al import de `../../db/schema`.

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
cd apps/api && pnpm exec jest src/modules/exams/exams.repository --selectProjects non-e2e
```

Expected: PASS.

```bash
cd apps/api && pnpm exec jest src/modules/exams/exams.service --selectProjects non-e2e
```

Expected: PASS — usa un mock del repositorio y la firma no cambió, así que sigue verde sin tocarlo.

- [ ] **Step 5: Formatear y commitear**

```bash
pnpm format
git checkout -- apps/api/src/common/compression.filter.spec.ts \
                apps/api/src/modules/assets/asset-cache.spec.ts \
                apps/api/src/modules/assets/assets.service.spec.ts \
                apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts
git add apps/api/src/modules/exams
git commit -m "refactor(api): resolve blueprint topics through topic_grades"
```

---

### Task 5: Borrar `GET /bank/questions/summary`

El endpoint existía para el árbol Curso → Tema del banco, que las carpetas reemplazaron. Ya no tiene consumidor y su única columna interesante (`gradeLevel` del tema) desapareció con la `0023`. Se va entero.

**Files:**
- Modify: `apps/api/src/modules/bank/bank.controller.ts` (borrar `@Get("summary")`)
- Modify: `apps/api/src/modules/bank/bank.service.ts` (borrar `countQuestionsByTopic`)
- Modify: `apps/api/src/modules/bank/bank.repository.ts` (borrar `countByCourseAndTopic` y el re-export del tipo)
- Modify: `apps/api/src/modules/bank/domain/ports/bank-repository.port.ts` (borrar `BankTopicQuestionCount` y su método del port)
- Test: `apps/api/src/modules/bank/bank.e2e.spec.ts`
- Test: `apps/api/src/modules/auth/cross-tenant.e2e.spec.ts`
- Test: `apps/api/src/modules/bank/bank.service.spec.ts`
- Test: `apps/api/src/modules/bank/bank.repository.spec.ts`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `BankRepositoryPort` sin `countByCourseAndTopic`; `BankService` sin `countQuestionsByTopic`; el tipo `BankTopicQuestionCount` deja de existir en todo el repo.

- [ ] **Step 1: Confirmar que nadie lo usa**

```bash
rg -n "questions/summary|countByCourseAndTopic|BankTopicQuestionCount|countQuestionsByTopic|getQuestionCounts|BankTopicCount" apps/web/src packages/shared/src
```

Expected: **cero resultados en `packages/shared/src`**, y en `apps/web/src` únicamente un COMENTARIO en `apps/web/src/app/features/bank/bank-list/bank-list.component.ts:118` que menciona el endpoint como historia. Si aparece una llamada real, **parar y reportarlo** — el spec asume que no queda ninguna.

- [ ] **Step 2: Escribir el test rojo — el endpoint ya no existe**

En `apps/api/src/modules/bank/bank.e2e.spec.ts`, borrar el bloque `describe("GET /bank/questions/summary — lazy tree skeleton", …)` COMPLETO (hoy ~líneas 812-906, incluido el comentario de bloque que lo precede) y poner en su lugar:

```ts
  it("no longer serves the retired per-topic summary route", async () => {
    // `GET /bank/questions/summary` fed the old Curso -> Tema bank tree, which
    // folders replaced. With the route gone, `summary` falls through to
    // `@Get(":id")` and `ParseUUIDPipe` rejects it — a 4xx either way, never a
    // 200 with counts.
    const res = await request(app.getHttpServer())
      .get("/bank/questions/summary")
      .set("Authorization", `Bearer ${tenantAToken}`);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });
```

Borrar también el fixture `gradedTopicId` si queda sin usar tras el borrado — comprobarlo con `rg -n "gradedTopicId" apps/api/src/modules/bank/bank.e2e.spec.ts`. Si sobrevive algún uso, dejarlo pero quitarle el `gradeLevel: "secundaria_5"` de su `insert(topics)` (~línea 77), que ya no compila.

En `apps/api/src/modules/auth/cross-tenant.e2e.spec.ts`, borrar el test `"does not count tenant B's questions in tenant A's summary (GET /bank/questions/summary)"` (~línea 639). El aislamiento por tenant que probaba ya lo prueba el test inmediatamente anterior sobre `GET /bank/questions`.

- [ ] **Step 3: Correr y verificar que falla**

```bash
cd apps/api && pnpm exec jest src/modules/bank/bank.e2e --selectProjects e2e --runInBand
```

Expected: FAIL en el test nuevo — la ruta todavía existe y responde 200.

- [ ] **Step 4: Borrar el endpoint y su cadena**

En `apps/api/src/modules/bank/bank.controller.ts`: borrar el método `questionSummary` con su bloque de documentación (~246-271) y quitar `BankTopicQuestionCount` del import de `./bank.repository` (queda `import { QuestionListItem } from "./bank.repository";`).

En `apps/api/src/modules/bank/bank.service.ts`: borrar `countQuestionsByTopic` con su docstring (~326-347) y quitar `BankTopicQuestionCount` del import de `./domain/ports/bank-repository.port`.

En `apps/api/src/modules/bank/bank.repository.ts`: borrar el método `countByCourseAndTopic` con su docstring (~339-373), quitar `BankTopicQuestionCount` de los dos sitios donde aparece (import ~19 y re-export ~105), y corregir los dos comentarios que lo mencionaban:
- `~29`: `The WHERE clause shared by \`listQuestions\` and \`countByCourseAndTopic\`.` → `The WHERE clause \`listQuestions\` builds.`
- `~260`: la referencia "(with `countByCourseAndTopic`)" sale de la frase.

Si `count` queda sin uso en el import de `drizzle-orm`, comprobarlo con `rg -n "count\(\)" apps/api/src/modules/bank/bank.repository.ts` antes de quitarlo — `listQuestions` también lo usa para el total paginado.

En `apps/api/src/modules/bank/domain/ports/bank-repository.port.ts`: borrar la interfaz `BankTopicQuestionCount` con su bloque de documentación (~164-183) y la línea `countByCourseAndTopic(...)` con su docstring dentro de `BankRepositoryPort` (~189-202).

- [ ] **Step 5: Limpiar los tests unitarios que lo mockeaban**

En `apps/api/src/modules/bank/bank.service.spec.ts`: borrar `countByCourseAndTopic: jest.fn().mockResolvedValue([])` del objeto repositorio falso (~51) y el test `"scopes the summary to the requester's own tenant, carrying the same filters listQuestions takes"` completo (~528-560).

En `apps/api/src/modules/bank/bank.repository.spec.ts`: borrar el `describe("countByCourseAndTopic() — lazy tree summary", …)` completo (~726 hasta el cierre de ese bloque) y el fixture `gradedTopic` (~71-76), incluido su `gradeLevel: "secundaria_5"` — que además ya no compila. Comprobar antes que nada más lo use:

```bash
rg -n "gradedTopic" apps/api/src/modules/bank/bank.repository.spec.ts
```

- [ ] **Step 6: Correr los tres y verificar que pasan**

```bash
cd apps/api && pnpm exec jest src/modules/bank/bank.service src/modules/bank/bank.repository --selectProjects non-e2e
```

Expected: PASS.

```bash
cd apps/api && pnpm exec jest src/modules/bank/bank.e2e src/modules/auth/cross-tenant --selectProjects e2e --runInBand
```

Expected: PASS.

- [ ] **Step 7: Formatear y commitear**

```bash
pnpm format
git checkout -- apps/api/src/common/compression.filter.spec.ts \
                apps/api/src/modules/assets/asset-cache.spec.ts \
                apps/api/src/modules/assets/assets.service.spec.ts \
                apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts
git add apps/api/src/modules/bank apps/api/src/modules/auth
git commit -m "refactor(api): drop the retired GET /bank/questions/summary route"
```

---

### Task 6: La siembra de carpetas ya no lleva sufijo de grado

**Files:**
- Modify: `apps/api/src/modules/bank/folders/domain/folder-name.ts` (borrar `folderNameForTopic`)
- Modify: `apps/api/src/modules/bank/folders/domain/folder-name.spec.ts`
- Modify: `apps/api/src/modules/bank/folders/domain/build-seed-folder-plan.ts` (borrar `dedupeSiblingNames`, `SeedTopicRow.gradeLevel`)
- Modify: `apps/api/src/modules/bank/folders/domain/build-seed-folder-plan.spec.ts`
- Modify: `apps/api/src/modules/bank/folders/bank-folders.repository.ts` (`loadSeedSource`)
- Test: `apps/api/src/modules/bank/folders/bank-folders.e2e.spec.ts`

**Interfaces:**
- Consumes: `MAX_FOLDER_NAME_LENGTH` de `@exams-generator/shared` (sin cambios).
- Produces:
  ```ts
  // folder-name.ts — `folderNameForTopic` DESAPARECE. Queda solo:
  export type FolderNameResult = { ok: true; name: string } | { ok: false; code: "folder_name_invalid" };
  export function validateFolderName(raw: unknown): FolderNameResult;

  // build-seed-folder-plan.ts
  export interface SeedTopicRow { readonly id: string; readonly courseId: string; readonly name: string }
  export function buildSeedFolderPlan(
    courses: readonly SeedCourseRow[],
    topics: readonly SeedTopicRow[],
  ): SeedFolderPlanNode[];
  // `SeedCourseRow` y `SeedFolderPlanNode` no cambian.
  ```

- [ ] **Step 1: Verificar que el clamp a 80 no puede colisionar**

Es la premisa de borrar `dedupeSiblingNames`. Comprobarla antes de tocar nada:

```bash
node -e "
const fs=require('fs');
const src=fs.readFileSync('apps/api/src/db/seed.ts','utf8');
const names=[...src.matchAll(/\{\s*name:\s*\"([^\"]+)\"/g)].map(m=>m[1]);
const ct=JSON.parse(fs.readFileSync('apps/api/src/db/data/canonical-taxonomy.json','utf8'));
for(const c of ct.courses) for(const t of c.topics) names.push(t.name);
const over=names.filter(n=>n.length>80);
console.log('names over 80 chars:', over.length, over);
console.log('longest:', names.slice().sort((a,b)=>b.length-a.length)[0]);
"
```

Expected: `names over 80 chars: 0 []`, y el más largo alrededor de 66 caracteres. Con eso, `clampFolderName` nunca trunca y dos temas distintos del mismo curso no pueden terminar con el mismo nombre. **Si sale algún nombre >80, NO borrar `dedupeSiblingNames`** — reportarlo y dejar la función, que en ese caso sí hace falta.

- [ ] **Step 2: Escribir el test rojo — e2e de carpetas**

En `apps/api/src/modules/bank/folders/bank-folders.e2e.spec.ts`:

- Reemplazar el fixture de los dos "Trigo" (~70-82) por UN tema con dos grados:

```ts
    // ONE topic taught at two grades — the shape that replaced two rows that
    // differed only in grade. The seeded folder must be ONE folder, bare.
    const [trigo] = await db
      .insert(topics)
      .values({ courseId: courseColegioId, name: `Trigo ${suffix}` })
      .returning({ id: topics.id });
    sharedNameTopicId = trigo!.id;
    await db.insert(topicGrades).values([
      { topicId: sharedNameTopicId, gradeLevel: "secundaria_4" },
      { topicId: sharedNameTopicId, gradeLevel: "secundaria_5" },
    ]);

    const [tPre] = await db
      .insert(topics)
      .values({ courseId: coursePreId, name: `Arco ${suffix}` })
      .returning({ id: topics.id });
    preTopicId = tPre!.id;
```

- Renombrar las declaraciones `let sharedNameTopic4Id: string;` / `let sharedNameTopic5Id: string;` a un único `let sharedNameTopicId: string;`, y actualizar el `afterAll` (`inArray(topics.id, [sharedNameTopicId, preTopicId])`, ~línea 184).
- Agregar `topicGrades` al import de `../../../db/schema`.
- Reemplazar las afirmaciones del sufijo en el primer test (~287-295):

```ts
    const topicFolders = all.filter((node) => node.parentId === courseFolder.id);
    // One folder per TOPIC, named exactly like the topic — no grade suffix
    // exists any more, because two topics of one course can no longer share a
    // name (`topics_course_id_name_idx`).
    expect(topicFolders.map((node) => node.name)).toEqual([`Trigo ${suffix}`]);
    expect(topicFolders.map((node) => node.topicId)).toEqual([sharedNameTopicId]);
```

- Buscar y arreglar el resto de los usos de los ids viejos:

```bash
rg -n "sharedNameTopic4Id|sharedNameTopic5Id" apps/api/src/modules/bank/folders/bank-folders.e2e.spec.ts
```

Todo uso pasa a `sharedNameTopicId`.

- [ ] **Step 3: Escribir los tests rojos — dominio puro**

En `apps/api/src/modules/bank/folders/domain/folder-name.spec.ts`, borrar el `describe("folderNameForTopic", …)` completo (~29 hasta el final) y su import.

En `apps/api/src/modules/bank/folders/domain/build-seed-folder-plan.spec.ts`:
- Quitar `gradeLevel` de todos los `SeedTopicRow` de los fixtures.
- Reemplazar el test `"puts one folder per topic under its course, carrying topicId and the grade suffix"`:

```ts
  it("puts one folder per topic under its course, named exactly like the topic", () => {
    const plan = buildSeedFolderPlan(
      [{ id: "c1", name: "Matemática", stage: "colegio" }],
      [
        { id: "t1", courseId: "c1", name: "Trigonometría" },
        { id: "t2", courseId: "c1", name: "Fracciones" },
      ],
    );

    const topicNodes = plan.filter((node) => node.topicId !== null);
    expect(topicNodes.map((node) => [node.name, node.topicId, node.position])).toEqual([
      ["Trigonometría", "t1", 0],
      ["Fracciones", "t2", 1],
    ]);
  });
```

- Borrar el test `"leaves a topic whose name is unique in its course bare"` (queda cubierto por el de arriba) y el test `"disambiguates two NULL-grade topics that share a name in the same course"` (ese caso ya no existe: `topics_course_id_name_idx` lo prohíbe).
- Dejar intacto `"truncates a course name longer than MAX_FOLDER_NAME_LENGTH"` — el clamp se queda.

- [ ] **Step 4: Correr los tres y verificar que fallan**

```bash
cd apps/api && pnpm exec jest src/modules/bank/folders/domain --selectProjects non-e2e
```

Expected: FAIL — `buildSeedFolderPlan` sigue pidiendo `gradeLevel` en `SeedTopicRow` (error de tipo en tiempo de ejecución no, pero el test nuevo espera nombres sin sufijo y el actual los produce cuando dos comparten nombre; el test de dedupe borrado ya no está). El fallo concreto es el del test reescrito, que llega con `topicNodes` correctos — **si pasara en verde**, verificar que el archivo se guardó y que `folderNameForTopic` sigue en su sitio.

```bash
cd apps/api && pnpm exec jest src/modules/bank/folders --selectProjects e2e --runInBand
```

Expected: FAIL en `loadSeedSource` con `column topics.grade_level does not exist`.

- [ ] **Step 5: Borrar `folderNameForTopic`**

En `apps/api/src/modules/bank/folders/domain/folder-name.ts`, borrar la función completa con su docstring y el import de `gradeLevelLabel`. El archivo queda:

```ts
import { MAX_FOLDER_NAME_LENGTH } from "@exams-generator/shared";

export type FolderNameResult =
  { readonly ok: true; readonly name: string } | { readonly ok: false; readonly code: "folder_name_invalid" };

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
```

- [ ] **Step 6: Borrar `dedupeSiblingNames` y el grado del plan de siembra**

En `apps/api/src/modules/bank/folders/domain/build-seed-folder-plan.ts`:
- Quitar el import de `./folder-name`.
- `SeedTopicRow` pierde `gradeLevel`:

```ts
export interface SeedTopicRow {
  readonly id: string;
  readonly courseId: string;
  readonly name: string;
}
```

- Borrar la función `dedupeSiblingNames` completa con su docstring.
- Reemplazar el bucle de temas dentro de `buildSeedFolderPlan`:

```ts
      /**
       * One folder per topic, named exactly like the topic. There used to be a
       * grade suffix here (`folderNameForTopic`) and a sibling-name deduper,
       * both for the same problem: `topics` was one row per grade, so two rows
       * of one course routinely shared a name. `topics_course_id_name_idx`
       * makes that impossible now (design doc 2026-09-03), and the clamp below
       * is the only name transformation left — verified never to truncate: the
       * longest catalog topic name is 66 characters.
       */
      const courseTopics = topics.filter((topic) => topic.courseId === course.id);
      for (const [topicPosition, topic] of courseTopics.entries()) {
        plan.push({
          key: `topic:${topic.id}`,
          parentKey: courseKey,
          name: clampFolderName(topic.name),
          topicId: topic.id,
          position: topicPosition,
        });
      }
```

- [ ] **Step 7: `loadSeedSource` deja de leer el grado**

En `apps/api/src/modules/bank/folders/bank-folders.repository.ts` (~196-209):

```ts
      this.db
        .select({
          id: topics.id,
          courseId: topics.courseId,
          name: topics.name,
        })
        .from(topics),
```

- [ ] **Step 8: Correr los dos y verificar que pasan**

```bash
cd apps/api && pnpm exec jest src/modules/bank/folders/domain --selectProjects non-e2e
```

Expected: PASS.

```bash
cd apps/api && pnpm exec jest src/modules/bank/folders --selectProjects e2e --runInBand
```

Expected: PASS.

- [ ] **Step 9: Confirmar que `GRADE_LEVEL_LABELS` sigue teniendo dueño**

```bash
rg -n "GRADE_LEVEL_LABELS|gradeLevelLabel" apps/api/src packages/shared/src apps/web/src
```

Expected: `packages/shared/src/domain/grade-level.ts` (declaración), y consumidores SOLO en `apps/web/src`. Ninguno en `apps/api/src` — el API dejó de generar copy con grado. El mapa se queda en `shared` porque la web lo re-exporta desde ahí (`grade-level-labels.ts`); el comentario que lo justificaba se corrige en la Task 7.

- [ ] **Step 10: Formatear y commitear**

```bash
pnpm format
git checkout -- apps/api/src/common/compression.filter.spec.ts \
                apps/api/src/modules/assets/asset-cache.spec.ts \
                apps/api/src/modules/assets/assets.service.spec.ts \
                apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts
git add apps/api/src/modules/bank/folders
git commit -m "refactor(api): seed one bare folder per topic now that grades are an attribute"
```

---

### Task 7: `Topic.gradeLevels` en la web y todos los fixtures

**Files:**
- Modify: `apps/web/src/app/features/taxonomy/taxonomy.models.ts`
- Modify: `apps/web/src/app/features/taxonomy/grade-level-labels.ts` (solo el comentario)
- Test: `apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts`
- Test: `apps/web/src/app/features/exams/exam-builder/exam-builder.component.spec.ts`
- Test: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts`
- Test: `apps/web/src/app/features/ai/ai-generate/ai-generate.component.spec.ts`
- Test: `apps/web/src/app/features/bank/taxonomy-matcher.spec.ts`
- Test: `apps/web/src/app/features/bank/bank-list/bank-list.component.spec.ts`

**Interfaces:**
- Consumes: la respuesta de `GET /topics` de la Task 3.
- Produces:
  ```ts
  // apps/web/src/app/features/taxonomy/taxonomy.models.ts
  export interface Topic {
    readonly id: string;
    readonly name: string;
    readonly courseId: string;
    readonly gradeLevels: readonly string[];
  }
  ```
  `TaxonomyService` (`getTopics`, `getTopicsForCourses`, `getAllTopics`, `getCourses`) **no cambia de firma**.

- [ ] **Step 1: Confirmar que `packages/shared` no participa**

```bash
rg -n "TopicListItem|BankTopicQuestionCount|gradeLevels" packages/shared/src
```

Expected: cero resultados. Si es así, **no hace falta `pnpm --filter @exams-generator/shared build`** y no hay que molestar al usuario. Si apareciera algo (alguien movió un tipo mientras tanto), **PARAR y pedirle permiso al usuario antes de correr ese build**: el typecheck del API resuelve `@exams-generator/shared` contra `packages/shared/dist/index.d.ts` (`apps/api/tsconfig.build.json`), así que sin el build los tipos nuevos no existen para el API — la web y jest resuelven desde el SOURCE, por eso los tests pasarían igual y el typecheck no.

- [ ] **Step 2: Escribir el test rojo — `TaxonomyService`**

En `apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts`, cambiar los tres fixtures `Topic` (líneas ~61, ~109 y ~110):

```ts
      const topics: Topic[] = [
        { id: 'topic-1', name: 'Fracciones', courseId: 'course-1', gradeLevels: ['secundaria_1'] },
      ];
```

```ts
      const topics: Topic[] = [
        { id: 'topic-1', name: 'Fracciones', courseId: 'course-1', gradeLevels: ['secundaria_1'] },
        { id: 'topic-2', name: 'Álgebra', courseId: 'course-2', gradeLevels: [] },
      ];
```

**No tocar nada más de este archivo** — sus dos hunks de deriva de Prettier (las llamadas a `httpMock.expectOne((request) => …)`, ~131 y ~140) tienen que quedar tal cual al commitear.

- [ ] **Step 3: Correr y verificar que falla**

```bash
cd apps/web && pnpm exec ng test --include='**/features/taxonomy/*.spec.ts' --watch=false
```

Expected: FAIL en tiempo de compilación de TypeScript: `Object literal may only specify known properties, and 'gradeLevels' does not exist in type 'Topic'`.

- [ ] **Step 4: Cambiar el modelo**

En `apps/web/src/app/features/taxonomy/taxonomy.models.ts`, reemplazar la interfaz `Topic`:

```ts
/** Mirrors `TopicListItem` from apps/api/src/modules/taxonomy/taxonomy.repository.ts. */
export interface Topic {
  readonly id: string;
  readonly name: string;
  readonly courseId: string;
  /**
   * Every grade this topic is taught at, ordered by the catalog's sort order.
   * Replaced `gradeLevel: string | null` when a topic stopped being one row per
   * grade (design doc 2026-09-03): the select of Tema no longer shows the same
   * concept once per grade, and `bank-new` reads this list to preselect Grado
   * from a folder's linked topic.
   *
   * EMPTY means "taught across the whole stage" — nothing to preselect.
   */
  readonly gradeLevels: readonly string[];
}
```

- [ ] **Step 5: Corregir el comentario de `grade-level-labels.ts`**

En `apps/web/src/app/features/taxonomy/grade-level-labels.ts`, reemplazar el bloque de comentario del re-export:

```ts
/**
 * The grade labels are pure WEB copy again: the API's folder seeder used to
 * generate folder names with a ` · <grade>` suffix (`folderNameForTopic`), and
 * that is gone — a topic is one row per concept now, so two folders of one
 * course can no longer share a name and nothing on the server renders a grade
 * (design doc 2026-09-03). The map still LIVES in `@exams-generator/shared`
 * rather than here so this file stays the single import site the bank/ai/exams
 * models already use; moving it back would be churn for no reader.
 */
export { GRADE_LEVEL_LABELS } from '@exams-generator/shared';
```

- [ ] **Step 6: Arreglar los cinco archivos de fixtures restantes**

Localizarlos primero:

```bash
rg -n "gradeLevel: (null|'[a-z_0-9]+')" apps/web/src --glob '*.spec.ts' | rg "courseId"
```

Expected: los cinco archivos de abajo. Cambios exactos:

`apps/web/src/app/features/exams/exam-builder/exam-builder.component.spec.ts` — línea ~34 y los cuatro bloques `topicsByCourse` (~931, ~952, ~987, ~1066):

```ts
const TOPICS: Topic[] = [{ id: 't1', name: 'Álgebra', courseId: 'c1', gradeLevels: ['secundaria_1'] }];
```

```ts
        c1: [{ id: 't1', name: 'Álgebra', courseId: 'c1', gradeLevels: ['secundaria_1'] }],
        c2: [{ id: 't2', name: 'Lectura', courseId: 'c2', gradeLevels: ['secundaria_1'] }],
```

`apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.spec.ts` — línea ~45:

```ts
const TOPICS_C1: Topic[] = [{ id: 't1', name: 'Célula', courseId: 'c1', gradeLevels: [] }];
```

`apps/web/src/app/features/ai/ai-generate/ai-generate.component.spec.ts` — línea ~14:

```ts
const TOPICS: Topic[] = [{ id: 't1', name: 'La célula', courseId: 'c1', gradeLevels: [] }];
```

`apps/web/src/app/features/bank/taxonomy-matcher.spec.ts` — línea ~79: `gradeLevel: null,` pasa a `gradeLevels: [],`.

`apps/web/src/app/features/bank/bank-list/bank-list.component.spec.ts` — líneas ~112, ~113 y ~115:

```ts
const TOPICS_C1: Topic[] = [
  { id: 't1', name: 'Fracciones', courseId: 'c1', gradeLevels: [] },
  { id: 't2', name: 'Porcentajes', courseId: 'c1', gradeLevels: [] },
];
const TOPICS_C2: Topic[] = [{ id: 't3', name: 'Ecuaciones', courseId: 'c2', gradeLevels: [] }];
```

`bank-new.component.spec.ts` NO se toca en esta tarea — es el objeto de la Task 8.

- [ ] **Step 7: Correr los tests tocados**

```bash
cd apps/web && pnpm exec ng test \
  --include='**/features/taxonomy/*.spec.ts' \
  --include='**/features/exams/exam-builder/*.spec.ts' \
  --include='**/features/ai/**/*.spec.ts' \
  --include='**/features/bank/taxonomy-matcher.spec.ts' \
  --include='**/features/bank/bank-list/*.spec.ts' \
  --watch=false
```

Expected: PASS. Si `bank-new.component.spec.ts` entra por arrastre de algún `--include`, va a fallar — es esperado y lo cierra la Task 8; acotar el `--include` para no confundirse.

- [ ] **Step 8: Formatear y commitear (con cuidado con la deriva)**

```bash
pnpm format
git checkout -- apps/api/src/common/compression.filter.spec.ts \
                apps/api/src/modules/assets/asset-cache.spec.ts \
                apps/api/src/modules/assets/assets.service.spec.ts
```

`taxonomy.service.spec.ts` sí lleva cambios reales, así que **no** se revierte entero. Prettier le habrá reformateado además los dos hunks de `httpMock.expectOne(...)`; hay que dejarlos fuera del commit:

```bash
git checkout -p apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts
# aceptar (y) SOLO los hunks de `httpMock.expectOne(` — esos vuelven a como estaban;
# rechazar (n) los hunks de los fixtures `Topic`, que son el cambio real.
git diff apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts
```

Expected en ese `git diff` final: SOLO las líneas de `gradeLevel` → `gradeLevels`. Confirmarlo antes de seguir:

```bash
pnpm exec prettier --check "apps/**/*.{ts,html,scss}" "packages/**/*.ts" 2>&1 | tail -8
```

Expected: los MISMOS cuatro archivos en `[warn]` que antes de empezar — ni uno más, ni uno menos.

```bash
git add apps/web/src/app/features
git commit -m "refactor(web): model a topic's grades as a list"
```

---

### Task 8: `bank-new` prefill y `exam-builder` sobre `gradeLevels`

**Files:**
- Modify: `apps/web/src/app/features/bank/bank-new/bank-new.component.ts`
- Test: `apps/web/src/app/features/bank/bank-new/bank-new.component.spec.ts`
- Verify: `apps/web/src/app/features/exams/exam-builder/exam-builder.component.ts` (probablemente sin cambios)

**Interfaces:**
- Consumes: `Topic.gradeLevels: readonly string[]` (Task 7).
- Produces:
  ```ts
  // bank-new.component.ts — el snapshot cambia de forma:
  private folderTaxonomy: Partial<
    Record<Tab, { readonly courseId: string; readonly topicId: string; readonly gradeLevels: readonly string[] }>
  >;
  ```
  `prefillTaxonomyFrom(tab: Tab, topic: Topic): void`, `folderCourseFor(tab: Tab): string` y `folderTopicFor(tab: Tab, courseId: string): string` conservan sus firmas.

- [ ] **Step 1: Escribir los tests rojos**

En `apps/web/src/app/features/bank/bank-new/bank-new.component.spec.ts`:

- Actualizar los cinco fixtures `Topic` (~25, ~27, ~36, ~37, ~749, ~752) a `gradeLevels`. El de `t1` en `ALL_TOPICS` (~36) es el que manda la regla nueva — le damos DOS grados:

```ts
const TOPICS_C1: Topic[] = [{ id: 't1', name: 'Álgebra', courseId: 'c1', gradeLevels: [] }];
const TOPICS_C2: Topic[] = [
  { id: 't2', name: 'Comprensión lectora', courseId: 'c2', gradeLevels: [] },
];
```

```ts
const ALL_TOPICS: Topic[] = [
  // Two grades: the folder must preselect the FIRST one when Grado is empty.
  { id: 't1', name: 'Trigonometría', courseId: 'c1', gradeLevels: ['secundaria_4', 'secundaria_5'] },
  // No grades at all: the folder leaves Grado to the teacher.
  { id: 't2', name: 'Otro', courseId: 'c1', gradeLevels: [] },
];
```

```ts
        { id: 't9', name: 'Tema de c2', courseId: 'c2', gradeLevels: [] },
```
```ts
        { id: 't1', name: 'Tema de c1', courseId: 'c1', gradeLevels: [] },
```

- Actualizar el comentario de la línea ~63-64 (`Topic 't2' carries NO gradeLevel`) a `Topic 't2' carries an EMPTY 'gradeLevels'`.
- Agregar tres tests dentro del mismo `describe` donde vive `"prefills Curso and Tema when the picked folder carries a topicId"`:

```ts
    it("preselects the topic's FIRST grade when Grado is still empty", async () => {
      pickFolder('photo', 'trigo'); // topic 't1', grades ['secundaria_4', 'secundaria_5']
      await settleEffects(fixture);

      expect(component.pGradeLevel()).toBe('secundaria_4');
      expect(component.pCourseId()).toBe('c1');
      expect(component.pTopicId()).toBe('t1');
    });

    it("keeps a Grado the teacher already picked when the topic is taught at it", async () => {
      set(fixture, 'pGradeLevel', 'secundaria_5');
      await settleEffects(fixture);

      pickFolder('photo', 'trigo');
      await settleEffects(fixture);

      // 'secundaria_5' IS one of the topic's grades — no reason to move her.
      expect(component.pGradeLevel()).toBe('secundaria_5');
      expect(component.pTopicId()).toBe('t1');
    });

    it("moves Grado to the topic's first grade when the current one is not in the list", async () => {
      set(fixture, 'pGradeLevel', 'pre');
      await settleEffects(fixture);

      pickFolder('photo', 'trigo');
      await settleEffects(fixture);

      // 'pre' is not a grade this topic is taught at, so the folder wins —
      // otherwise Curso/Tema would hold ids the (stage-scoped) dropdowns
      // cannot render and the API would reject.
      expect(component.pGradeLevel()).toBe('secundaria_4');
      expect(component.pCourseId()).toBe('c1');
      expect(component.pTopicId()).toBe('t1');
    });
```

- El test existente `"keeps the folder Curso/Tema when the teacher picks Grado by hand afterwards"` (~3363) apoyaba en que el topic de `sin-grado` no tenía grado — sigue valiendo con `gradeLevels: []`. Verificar que su comentario diga `carries no grades` en vez de `carries no gradeLevel`.

- [ ] **Step 2: Correr y verificar que falla**

```bash
cd apps/web && pnpm exec ng test --include='**/features/bank/bank-new/*.spec.ts' --watch=false
```

Expected: FAIL en compilación (`'gradeLevels' does not exist in type ...` desapareció con la Task 7, así que ahora falla `topic.gradeLevel` dentro del componente: `Property 'gradeLevel' does not exist on type 'Topic'`).

- [ ] **Step 3: Implementar la regla de prefill**

En `apps/web/src/app/features/bank/bank-new/bank-new.component.ts`:

Cambiar la declaración del snapshot (~192-197):

```ts
  private folderTaxonomy: Partial<
    Record<
      Tab,
      { readonly courseId: string; readonly topicId: string; readonly gradeLevels: readonly string[] }
    >
  > = {};
```

Reemplazar `prefillTaxonomyFrom` (~466-500) — solo cambia el cálculo de `grade` y el docstring:

```ts
  /**
   * Drives one tab's Grado -> Curso -> Tema from the folder's topic.
   *
   * The snapshot is written FIRST, so whichever effects the writes below wake
   * up already find the folder's answer waiting for them. The two branches
   * afterwards are the cases where an effect will NOT fire — a signal
   * `.set()` to the value it already holds never notifies — and the value
   * therefore has to be applied here instead, the same shape
   * `resolveStructuredTaxonomy` uses for the extraction's own preselect.
   *
   * Grado rule, now that a topic carries a LIST of grades: keep whatever the
   * teacher already picked IF the topic is taught at it; otherwise (Grado
   * empty, or a grade the topic is not taught at) take the topic's FIRST
   * grade. A topic with no grades at all leaves Grado untouched — the snapshot
   * is what keeps Curso/Tema alive when she picks one.
   */
  private prefillTaxonomyFrom(tab: Tab, topic: Topic): void {
    const gradeSignal = tab === 'photo' ? this.pGradeLevel : this.sGradeLevel;
    const courseSignal = tab === 'photo' ? this.pCourseId : this.sCourseId;
    const topicSignal = tab === 'photo' ? this.pTopicId : this.sTopicId;

    const current = gradeSignal();
    const grade =
      current && topic.gradeLevels.includes(current) ? current : (topic.gradeLevels[0] ?? null);

    this.folderDerivedTaxonomy[tab] = true;
    this.folderTaxonomy[tab] = {
      courseId: topic.courseId,
      topicId: topic.id,
      gradeLevels: topic.gradeLevels,
    };

    if (grade && gradeSignal() !== grade) {
      // Setting Grado blanks Curso via `loadCoursesFor`, which then blanks
      // Tema via `loadTopicsFor` — both read the snapshot on the way through,
      // so the whole chain lands on the folder's values.
      gradeSignal.set(grade);
      return;
    }

    const courseChanged = courseSignal() !== topic.courseId;
    courseSignal.set(topic.courseId);
    if (!courseChanged) {
      topicSignal.set(topic.id);
    }
  }
```

Reemplazar el guard de `folderCourseFor` (~508-518) — la comparación pasa de "un grado" a "la lista":

```ts
  /**
   * The folder's Curso for this tab — `''` once the teacher has taken
   * Curso/Tema over, and also once she has moved to a grade the folder's topic
   * is NOT taught at. The course catalog is split by educational stage, so the
   * folder's course is simply not in the list she is now looking at: keeping it
   * would leave `pCourseId` holding an id the dropdown cannot render and the
   * API would reject, while `photoValid()` happily reported the form complete.
   */
  private folderCourseFor(tab: Tab): string {
    const folder = this.folderDerivedTaxonomy[tab] ? this.folderTaxonomy[tab] : undefined;
    if (!folder) {
      return '';
    }
    const grade = tab === 'photo' ? this.pGradeLevel() : this.sGradeLevel();
    if (folder.gradeLevels.length > 0 && grade && !folder.gradeLevels.includes(grade)) {
      return '';
    }
    return folder.courseId;
  }
```

`folderTopicFor` no cambia.

- [ ] **Step 4: Correr y verificar que pasa**

```bash
cd apps/web && pnpm exec ng test --include='**/features/bank/bank-new/*.spec.ts' --watch=false
```

Expected: PASS.

- [ ] **Step 5: Verificar `exam-builder` y `ai-generate` sin cambios**

Los dos piden `getTopics(courseId, gradeLevel)` / `getTopicsForCourses(ids, gradeLevel)` y el servidor ya filtra por `topic_grades`, así que su lógica no cambia. Confirmarlo:

```bash
rg -n "\.gradeLevel\b" apps/web/src/app/features/exams/exam-builder/exam-builder.component.ts \
                        apps/web/src/app/features/ai/ai-generate/ai-generate.component.ts \
                        apps/web/src/app/features/bank/taxonomy-matcher.ts \
                        apps/web/src/app/features/bank/bank-new-extraction.service.ts
```

Expected: solo apariciones sobre el grado de la PREGUNTA o de la señal del formulario (`this.gradeLevel()`, `entry.gradeLevel`), ninguna sobre un `Topic`. **Si aparece un `topic.gradeLevel`, arreglarlo aquí mismo** con un test que lo cubra primero.

```bash
cd apps/web && pnpm exec ng test --include='**/features/exams/exam-builder/*.spec.ts' --include='**/features/ai/ai-generate/*.spec.ts' --watch=false
```

Expected: PASS.

- [ ] **Step 6: Typecheck de los dos paquetes — aquí se cierra el rojo**

```bash
pnpm --filter @exams-generator/web typecheck
```

Expected: sin errores.

```bash
pnpm --filter @exams-generator/api typecheck
```

Expected: **sin errores por primera vez desde la Task 1.** Si sale algo, es un lector de `topics.grade_level` que este plan no listó — arreglarlo aquí y anotarlo. Barrido de control:

```bash
rg -n "topics\.gradeLevel|topic\.gradeLevel|gradeLevel: topics\." apps/api/src apps/web/src
```

Expected: cero resultados.

- [ ] **Step 7: Formatear y commitear**

```bash
pnpm format
git checkout -- apps/api/src/common/compression.filter.spec.ts \
                apps/api/src/modules/assets/asset-cache.spec.ts \
                apps/api/src/modules/assets/assets.service.spec.ts \
                apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts
git add apps/web/src/app/features/bank
git commit -m "feat(web): preselect Grado from the folder topic's grade list"
```

---

### Task 9: Suites completas, respaldo de prod y pasada manual en el navegador

**Files:**
- Ninguno por defecto. Cualquier archivo que toques aquí es un bug encontrado, y se arregla con un test que lo reproduzca primero.

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada.

- [ ] **Step 1: Correr las tres suites del API**

```bash
pnpm dev:infra
cd apps/api && pnpm exec jest --selectProjects non-e2e
cd apps/api && pnpm exec jest --selectProjects db-serial --runInBand
cd apps/api && pnpm exec jest --selectProjects e2e --maxWorkers=4
cd apps/api && pnpm db:purge-test-taxonomy
```

Expected: verde las tres. Es la única corrida completa que este plan pide, y va aquí porque el cambio toca el esquema: no hay forma de acotarla por rutas sin dejar fuera módulos que leen `topics`.

`db:purge-test-taxonomy` al final borra los cursos/temas de fixtures que hayan quedado (`apps/api/src/scripts/purge-test-taxonomy.ts`); `topic_grades` se va sola con el `ON DELETE CASCADE`.

- [ ] **Step 2: Correr toda la suite de la web**

```bash
cd apps/web && pnpm exec ng test --watch=false
```

Expected: verde.

- [ ] **Step 3: Typecheck y formato**

```bash
pnpm typecheck
pnpm exec prettier --check "apps/**/*.{ts,html,scss}" "packages/**/*.ts" "*.{json,md}" "docs/**/*.md" ".github/**/*.yml" 2>&1 | tail -8
```

Expected: typecheck sin errores; Prettier reporta EXACTAMENTE los cuatro archivos de deriva preexistente y ninguno más.

- [ ] **Step 4: Respaldo antes de desplegar en prod — LO CORRE EL USUARIO**

**Este paso no lo ejecuta el agente.** Pasarle al usuario el comando textual y esperar su confirmación antes de dar la tarea por cerrada. La migración es irreversible salvo desde este respaldo.

> Antes de desplegar, corre esto contra la base de PROD y guarda el archivo FUERA del contenedor:
>
> ```bash
> pg_dump "$DATABASE_URL" \
>   --format=custom \
>   --table=public.topics \
>   --table=public.topic_grades \
>   --table=public.questions \
>   --table=public.question_folders \
>   --table=public.generation_jobs \
>   --table=public.exam_blueprint_rows \
>   --table=public.exam_blueprint_template_rows \
>   --table=public.subtopics \
>   --table=public.syllabus_week_maps \
>   --file=topics-pre-0023-$(date +%Y%m%d-%H%M).dump
> ```
>
> `topic_grades` todavía no existe en prod: `pg_dump` avisa `no matching tables were found` para esa tabla y sigue — es esperado, no un error. Copia el `.dump` a tu máquina antes del deploy.

- [ ] **Step 5: Levantar el entorno y hacer la pasada manual**

```bash
pnpm dev:infra
cd apps/api && pnpm db:migrate
cd apps/api && pnpm db:seed
```

Levantar API y web (`pnpm --filter @exams-generator/api dev` y `pnpm --filter @exams-generator/web dev`, en dos terminales) y entrar a `http://localhost:4201/app/bank` con un usuario de colegio (rol `teacher`, con `tenantId`). **No leer `.env` a mano**; si hace falta un valor, `envsafe show .env`.

Recorrido, con la skill `claude-in-chrome` o Playwright MCP:

1. **Árbol del banco sin copias** — entrar a `/app/bank`. Dentro de "Colegio → Matemática" hay UNA carpeta "Fracciones, decimales y porcentajes" (antes había dos) y UNA "Patrones y secuencias" (antes seis). Ninguna carpeta muestra un sufijo " · N° secundaria" ni " · Pre-admisión".
2. **Conteo de carpetas** — el árbol de un colegio ronda las ~670 carpetas, no las ~1 000 de antes. Basta con ver que las ramas de Matemática y Comunicación no tienen pares repetidos.
3. **Select de Tema filtrado por grado (subida)** — "Nueva pregunta" → Grado `1° secundaria` → Curso "Matemática" → abrir Tema: aparece "Fracciones, decimales y porcentajes" UNA vez, y NO aparece "Trigonometría: razones e identidades" (que solo se dicta en 4° y 5°). Cambiar Grado a `4° secundaria`: ahora Trigonometría sí está y "Números enteros y operaciones" (solo 1°) no.
4. **Prefill desde carpeta con Grado vacío** — recargar "Nueva pregunta" sin tocar Grado, elegir la carpeta "Trigonometría: razones e identidades": Grado queda en `4° secundaria` (el primero de la lista del tema), y Curso/Tema quedan cargados.
5. **Prefill respetando un Grado ya elegido** — poner Grado `5° secundaria` primero y recién ahí elegir la misma carpeta: Grado se queda en `5° secundaria` (el tema también se dicta ahí), Curso/Tema se cargan igual.
6. **Prefill con Grado incompatible** — poner Grado `1° primaria`, elegir la carpeta de Trigonometría: Grado salta a `4° secundaria` y Curso/Tema quedan cargados y renderizables.
7. **Hint de desajuste** — con la carpeta puesta, cambiar Tema a mano: aparece "El Tema no coincide con la carpeta" y la carpeta no cambia.
8. **Constructor de exámenes por grado** — `/app/exams/new`, Grado `2° secundaria`: la grilla de existencias lista cada tema UNA vez, y solo temas que se dictan en 2°. Cambiar a `5° secundaria`: la lista cambia y sigue sin repetidos.
9. **Subir una pregunta de punta a punta** — subir una foto desde la carpeta del paso 4 y guardarla. Al volver al banco, la pregunta está dentro de esa carpeta.

**Cualquier paso que falle es un bug de este trabajo: arreglarlo con un test que lo reproduzca primero**, no con un parche a mano.

- [ ] **Step 6: Commit final si hubo arreglos**

Solo si los pasos anteriores movieron código:

```bash
pnpm format
git checkout -- apps/api/src/common/compression.filter.spec.ts \
                apps/api/src/modules/assets/asset-cache.spec.ts \
                apps/api/src/modules/assets/assets.service.spec.ts \
                apps/web/src/app/features/taxonomy/taxonomy.service.spec.ts
git add -A apps packages
git commit -m "fix: <lo que el recorrido manual encontró>"
```

Si no hubo arreglos, no hay commit: la tarea es una verificación.

---

## Self-Review

**1. Cobertura del spec.** Sección por sección del diseño:

| Sección del spec | Tarea |
|---|---|
| `topics` pierde `grade_level`; únicos `(course_id, name)` y parcial `(course_id, slug)` | Task 1 (Steps 5, 7) |
| Tabla `topic_grades` (PK compuesta, FK cascade, índice por `grade_level`) | Task 1 (Steps 4, 7) |
| `questions.grade_level` / `generation_jobs.grade_level` NO cambian | Task 1 (Step 7, el SQL no los toca; Step 1 lo afirma en el test) |
| Cursos repetidos entre etapas se quedan | Sin tarea, correctamente (fuera de alcance) |
| `subtopics` no se toca (solo se re-apunta su FK) | Task 1 (Step 7) |
| Migración Drizzle numerada, una sola pasada, dentro del pipeline | Task 1 (Steps 6, 7) + Global Constraints |
| `0023` paso 1: crear `topic_grades` | Task 1 (Step 7) |
| `0023` paso 2: insertar grados sobre el canónico (menor `sort_order`, desempate por id) | Task 1 (Step 7, `topic_collapse_map`) + Ambigüedad 3 |
| `0023` paso 3: re-apuntar las 6 FKs, con el dedupe de `syllabus_week_maps` | Task 1 (Step 7) |
| `0023` paso 4: merge de carpetas por tenant (menor `position`), mover preguntas y subcarpetas, quitar el sufijo, regla " (2)" | Task 1 (Step 7, `folder_merge_map` + strip + pass de dedupe) |
| `0023` paso 5: borrar las copias | Task 1 (Step 7) |
| `0023` paso 6: quitar la columna y los índices viejos, crear los nuevos | Task 1 (Step 7) |
| `pg_dump` antes de desplegar en prod | Task 9 (Step 4), redactado para que lo corra el usuario |
| `seedStage`: un insert por tema + una fila por grado, `onConflictDoNothing` | Task 2 (Step 3) |
| `reconcileLegacyTopics` indexado por `(courseName, name)` sin grado | Task 2 (Step 5) — ya lo estaba; el paso es la verificación |
| `seed-collected-questions.ts` con clave `courseId\|topicName` + alta en `topic_grades` | Task 2 (Step 6) |
| `seed-lot-questions.ts` + alta en `topic_grades` | Task 2 (Step 7) |
| `canonical-taxonomy.json` no cambia | Sin tarea, correctamente |
| `seed-idempotency.spec.ts` indexa por `name` y afirma que `topic_grades` no crece | Task 2 (Step 1) |
| `TopicListItem` / `Topic` pasan a `gradeLevels: readonly string[]` | Task 3 (Step 4), Task 7 (Step 4) |
| `GET /topics?gradeLevel=` y `findTopicsByCourseIds` filtran con `EXISTS` | Task 3 (Step 4) |
| Sin filtro, devuelven todos los temas con su lista (`array_agg` + `left join`, sin N+1) | Task 3 (Step 4) |
| `exams.repository.getTopicsForCourses` usa el mismo `EXISTS` | Task 4 (Step 3) |
| `GET /bank/questions/summary` y `countByCourseAndTopic` se eliminan | Task 5 (Steps 4, 5) |
| `BankTopicQuestionCount` desaparece | Task 5 (Step 4) + Ambigüedad 1 (no vivía en `shared`) |
| `SeedTopicRow` pierde `gradeLevel`; `folderNameForTopic` y `dedupeSiblingNames` desaparecen; el clamp se queda | Task 6 (Steps 5, 6) + Ambigüedad 5 |
| `GRADE_LEVEL_LABELS` se queda en `packages/shared`; el API deja de generar copy con grado | Task 6 (Step 9), Task 7 (Step 5) |
| AI y `validate-question-taxonomy` no cambian | Task 8 (Step 5), verificación por `rg` |
| `Topic.gradeLevels` en `taxonomy.models.ts` y en todos los fixtures | Task 7 (Steps 4, 6), Task 8 (Step 1) |
| Los selects de Tema siguen pidiendo `getTopics(courseId, gradeLevel)` sin cambiar su lógica | Task 8 (Step 5), verificación por `rg` + suites |
| `bank-new` prefill: primer grado del tema si Grado está vacío o no pertenece a la lista | Task 8 (Steps 1, 3) |
| El hint "El Tema no coincide con la carpeta" no cambia | Task 8 (Step 1, el test existente sigue verde) |
| `taxonomy-matcher.ts` no cambia | Task 7 (Step 6, solo su fixture), Task 8 (Step 5) |
| El árbol de carpetas ya no muestra sufijos; comentario de `grade-level-labels.ts` | Task 6 (Steps 5, 6), Task 7 (Step 5), Task 9 (Step 5, punto 1) |
| Test `taxonomy.e2e`: un tema con dos grados sale una vez; `?gradeLevel=` incluye/excluye; la unicidad muerde | Task 3 (Step 1) |
| Test `bank-folders.e2e`: una carpeta por tema sin sufijo; el fixture "Trigo" pasa a un tema con dos grados | Task 6 (Step 2) |
| Test `bank.e2e`: se retiran los casos del `summary`; el filtro `gradeLevel` del listado sigue probado | Task 5 (Steps 2, 6) |
| Test exams: temas por grado | Task 4 (Step 1) + Ambigüedad 7 |
| Test de migración `db-serial` sobre el estado `0022` | Task 1 (Steps 1, 2) + Ambigüedad 4 |
| Test unit: `build-seed-folder-plan.spec.ts` sin casos de grado; `seed-idempotency` con `topic_grades` | Task 6 (Step 3), Task 2 (Step 1) |
| Tests web: fixtures, prefill con uno y con varios grados, bank-list sin sufijos | Task 7 (Steps 2, 6), Task 8 (Step 1) |
| Pasada manual en navegador | Task 9 (Step 5) |
| Fuera de alcance (borrar `subtopics`, fusionar cursos, cambiar el eje de grado) | Sin tarea, correctamente |

Sin huecos. Tres cosas que el spec no listaba y este plan agrega porque el código las obliga: el test del `summary` en `cross-tenant.e2e.spec.ts` (Task 5 Step 2), los cuatro scripts de `apps/api/src/scripts/` que filtraban por `topics.grade_level` (Task 2 Step 8), y el `testRegex` de `db-serial` en `jest.config.js`, que hoy apunta a un solo archivo (Task 1 Step 2).

**2. Placeholders.** Revisado: no hay "TBD", ni "similar a la Task N", ni "agregar validación apropiada". Cada paso de código trae el código. Los siete puntos donde el plan dice "verificar antes de escribir" son verificaciones REALES con comando y resultado esperado, no huecos:
- Task 1 Step 6 (el SQL que `drizzle-kit` genera), Step 8 (la lista de FKs a `topics.id`), Step 9 (deriva de esquema).
- Task 2 Step 5 (que no queden lecturas de `topics.gradeLevel` en `seed.ts`).
- Task 5 Step 1 (que nadie consuma el `summary`).
- Task 6 Step 1 (que ningún nombre supere los 80 caracteres — es la premisa de borrar `dedupeSiblingNames`, y el paso dice explícitamente qué hacer si falla).
- Task 7 Step 1 (que `packages/shared` no participe, y qué hacer si participa).
- Task 8 Step 5 (que no quede ningún `topic.gradeLevel` en la web).
Los sitios que mandan a `rg` para localizar algo apuntan a código EXISTENTE, no a código por inventar.

**3. Consistencia de tipos.** Verificado cruzando tareas:
- `topicGrades` se declara una sola vez (Task 1, `db/schema/topic-grades.schema.ts`) con las columnas `topicId`/`gradeLevel`, y con ESOS nombres lo consumen Task 2 (`seed.ts`, los dos sembradores), Task 3 (`taxonomy.repository.ts`), Task 4 (`exams.repository.ts`) y los fixtures de las tasks 3, 4 y 6.
- `TopicListItem.gradeLevels` (Task 3) y `Topic.gradeLevels` (Task 7) son el MISMO nombre y el MISMO tipo (`readonly string[]`), y la e2e de la Task 3 afirma exactamente la forma que la web consume (`{ id, name, courseId, gradeLevels }` — sin `gradeLevel`).
- `SeedTopicRow` se declara una sola vez (Task 6, `build-seed-folder-plan.ts`) con `{ id, courseId, name }`, y con esa forma exacta la produce `loadSeedSource` (Task 6 Step 7) y la consume `buildSeedFolderPlan` (Task 6 Step 6). El spec de dominio usa la misma.
- `getTopicsForCourses(courseIds: readonly string[], gradeLevel: string): Promise<CourseTopic[]>` (Task 4) es idéntica a la de hoy, así que `exams-repository.port.ts:320` y el mock de `exams.service.spec.ts` no cambian — por eso la Task 4 Step 4 corre ese spec y espera verde sin tocarlo.
- `folderTaxonomy[tab]` (Task 8) pasa de `{ courseId, topicId, gradeLevel: string | null }` a `{ courseId, topicId, gradeLevels: readonly string[] }`, y los DOS lectores del snapshot cambian en el mismo paso: `folderCourseFor` (que ahora compara con `includes`) y `prefillTaxonomyFrom` (que lo escribe). `folderTopicFor` no lo lee, por eso no cambia.
- `validateFolderName` / `FolderNameResult` (Task 6) conservan su firma; lo único que sale de `folder-name.ts` es `folderNameForTopic`, y su único llamador (`build-seed-folder-plan.ts`) se reescribe en el mismo paso.
- `MAX_FOLDER_NAME_LENGTH` sigue viniendo de `@exams-generator/shared` en los dos archivos del dominio de carpetas — no se duplica ni cambia de valor.

**Dos arreglos aplicados durante esta revisión:**
1. La Task 5 borraba el fixture `gradedTopicId` de `bank.e2e.spec.ts` sin decir qué pasa si sobrevive algún otro uso; el paso ahora obliga a comprobarlo con `rg` y, si sobrevive, a quitarle solo el `gradeLevel` del insert (que de todos modos ya no compila tras la Task 1).
2. La Task 2 tenía a `seedStage` insertando el tema y escribiendo grados sin resolver el `topicId` — `onConflictDoNothing` no devuelve fila cuando el tema ya existía, que es el estado normal en un reseed. El paso ahora lee el id de vuelta con un `select`, con la misma invariante-y-throw que el resto del seeder usa para los cursos.
