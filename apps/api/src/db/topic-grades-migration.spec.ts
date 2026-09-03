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
    const {
      rows: [course],
    } = await pool.query<{ id: string }>(
      `insert into courses (name, stage) values ($1, 'colegio') returning id`,
      [`Mig Course ${suffix}`],
    );
    // Two copies of ONE concept, one row per grade — the shape being retired.
    // `secundaria_4` has the lower sort_order, so IT is the canonical row.
    const {
      rows: [topic4],
    } = await pool.query<{ id: string }>(
      `insert into topics (course_id, name, grade_level) values ($1, $2, 'secundaria_4') returning id`,
      [course.id, `Trigo ${suffix}`],
    );
    const {
      rows: [topic5],
    } = await pool.query<{ id: string }>(
      `insert into topics (course_id, name, grade_level) values ($1, $2, 'secundaria_5') returning id`,
      [course.id, `Trigo ${suffix}`],
    );

    const {
      rows: [tenant],
    } = await pool.query<{ id: string }>(`insert into tenants (name, slug) values ($1, $2) returning id`, [
      `Mig Tenant ${suffix}`,
      `mig-tenant-${suffix}`,
    ]);
    const {
      rows: [user],
    } = await pool.query<{ id: string }>(
      `insert into users (tenant_id, email, password_hash, role) values ($1, $2, 'x', 'teacher') returning id`,
      [tenant.id, `mig-${suffix}@exams-generator.test`],
    );

    // A question on the NON-canonical copy: it must end up on the canonical
    // topic with its OWN grade_level untouched.
    const {
      rows: [question],
    } = await pool.query<{ id: string }>(
      `insert into questions
         (tenant_id, topic_id, difficulty, grade_level, status, type, body_typst, body_hash, alternatives, correct_answer, created_by)
       values ($1, $2, 'medium', 'secundaria_5', 'approved', 'structured', 'Enunciado', $3, $4, '0', $5)
       returning id`,
      [tenant.id, topic5.id, randomUUID(), JSON.stringify(["a", "b", "c", "d"]), user.id],
    );

    // Two seeded folders, one per copy, with the grade suffix the seeder wrote.
    const {
      rows: [folder4],
    } = await pool.query<{ id: string }>(
      `insert into question_folders (tenant_id, parent_id, name, topic_id, position)
       values ($1, null, $2, $3, 0) returning id`,
      [tenant.id, `Trigo ${suffix} · 4° secundaria`, topic4.id],
    );
    const {
      rows: [folder5],
    } = await pool.query<{ id: string }>(
      `insert into question_folders (tenant_id, parent_id, name, topic_id, position)
       values ($1, null, $2, $3, 1) returning id`,
      [tenant.id, `Trigo ${suffix} · 5° secundaria`, topic5.id],
    );
    // A child of the folder that will LOSE the merge — it must be re-parented.
    const {
      rows: [child],
    } = await pool.query<{ id: string }>(
      `insert into question_folders (tenant_id, parent_id, name, topic_id, position)
       values ($1, $2, $3, null, 0) returning id`,
      [tenant.id, folder5.id, `Sub ${suffix}`],
    );
    // The question is filed under the loser folder.
    await pool.query(`update questions set folder_id = $1 where id = $2`, [folder5.id, question.id]);

    // A syllabus row on EACH copy for the same template — the collapse must
    // delete the redundant one instead of violating (template_id, topic_id).
    const {
      rows: [university],
    } = await pool.query<{ id: string }>(
      `insert into universities (code, name) values ($1, $2) returning id`,
      [`mig-uni-${suffix}`, `Mig University ${suffix}`],
    );
    // `exam_blueprint_templates` is keyed by (university, track, tenant) with a
    // free-text `cycle_label` — it has neither the `exam_type_code` nor the
    // `name` column the plan assumed.
    const {
      rows: [template],
    } = await pool.query<{ id: string }>(
      `insert into exam_blueprint_templates (university_id, cycle_label)
       values ($1, $2) returning id`,
      [university.id, `Mig Cycle ${suffix}`],
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
    const {
      rows: [movedQuestion],
    } = await pool.query<{ topic_id: string; grade_level: string; folder_id: string }>(
      `select topic_id, grade_level, folder_id from questions where id = $1`,
      [question.id],
    );
    expect(movedQuestion.topic_id).toBe(topic4.id);
    expect(movedQuestion.grade_level).toBe("secundaria_5");

    // 4. Folders merged into the lowest-position one, which kept the child and
    //    the question, and lost the grade suffix.
    const { rows: folders } = await pool.query<{
      id: string;
      name: string;
      parent_id: string | null;
    }>(`select id, name, parent_id from question_folders where tenant_id = $1 order by position, id`, [
      tenant.id,
    ]);
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
