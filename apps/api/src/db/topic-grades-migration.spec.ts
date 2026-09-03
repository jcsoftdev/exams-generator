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
 * Lives in the `db-serial` jest project: it creates and drops databases, and
 * it must not race the parallel `non-e2e` workers.
 */
describe("0023_topic_grades migration", () => {
  const apiRoot = resolve(__dirname, "../..");
  const migrationsDir = join(apiRoot, "drizzle");

  let adminClient: Client;
  let tmpMigrationsDir: string;
  const openPools: Pool[] = [];
  const createdDatabases: string[] = [];

  /**
   * A fresh database already at `0022`, with the two `grade_levels` rows the
   * fixtures order by (the catalog is normally seeded, and the collapse ranks
   * copies by its `sort_order`).
   */
  async function scratchDatabaseAt0022(): Promise<Pool> {
    const dbName = `topic_grades_migration_${randomUUID().replace(/-/g, "")}`;
    await adminClient.query(`create database "${dbName}"`);
    createdDatabases.push(dbName);

    const url = new URL(resolveDatabaseUrl());
    url.pathname = `/${dbName}`;
    const pool = new Pool({ connectionString: url.toString() });
    openPools.push(pool);

    await migrate(drizzle(pool), { migrationsFolder: tmpMigrationsDir });
    await pool.query(
      `insert into grade_levels (code, sort_order)
       values ('secundaria_3', 8), ('secundaria_4', 9), ('secundaria_5', 10)`,
    );
    return pool;
  }

  beforeAll(async () => {
    adminClient = new Client({ connectionString: resolveDatabaseUrl() });
    await adminClient.connect();

    // A copy of `drizzle/` whose journal stops at 0022.
    tmpMigrationsDir = mkdtempSync(join(tmpdir(), "drizzle-0022-"));
    cpSync(migrationsDir, tmpMigrationsDir, { recursive: true });
    const journalPath = join(tmpMigrationsDir, "meta", "_journal.json");
    const journal = JSON.parse(readFileSync(journalPath, "utf-8")) as {
      entries: Array<{ idx: number }>;
    };
    journal.entries = journal.entries.filter((entry) => entry.idx <= 22);
    writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  }, 120_000);

  afterAll(async () => {
    for (const pool of openPools) {
      await pool.end();
    }
    rmSync(tmpMigrationsDir, { recursive: true, force: true });
    for (const dbName of createdDatabases) {
      await adminClient.query(`drop database if exists "${dbName}"`);
    }
    await adminClient.end();
  }, 120_000);

  it("collapses per-grade topic copies, repoints every FK, merges folders and renames around collisions", async () => {
    const pool = await scratchDatabaseAt0022();
    const suffix = randomUUID().slice(0, 8);

    /** First row of a single-row statement, typed. */
    async function one<T extends object>(sql: string, params: unknown[] = []): Promise<T> {
      const { rows } = await pool.query<T>(sql, params);
      return rows[0];
    }

    async function insertTopic(courseId: string, name: string, gradeLevel: string | null): Promise<string> {
      const row = await one<{ id: string }>(
        `insert into topics (course_id, name, grade_level) values ($1, $2, $3) returning id`,
        [courseId, name, gradeLevel],
      );
      return row.id;
    }

    async function insertFolder(
      tenantId: string,
      name: string,
      parentId: string | null,
      topicId: string | null,
      position: number,
    ): Promise<string> {
      const row = await one<{ id: string }>(
        `insert into question_folders (tenant_id, parent_id, name, topic_id, position)
         values ($1, $2, $3, $4, $5) returning id`,
        [tenantId, parentId, name, topicId, position],
      );
      return row.id;
    }

    // --- fixtures ---------------------------------------------------------
    const course = await one<{ id: string }>(
      `insert into courses (name, stage) values ($1, 'colegio') returning id`,
      [`Mig Course ${suffix}`],
    );

    // Group T: two copies of ONE concept, one row per grade — the shape being
    // retired. `secundaria_4` has the lower sort_order, so IT is canonical.
    const trigoName = `Trigo ${suffix}`;
    const topic4 = await insertTopic(course.id, trigoName, "secundaria_4");
    const topic5 = await insertTopic(course.id, trigoName, "secundaria_5");
    // Group G: same shape, but its folders are NESTED — the keeper's folder is
    // a child of the loser's folder.
    const geoName = `Geo ${suffix}`;
    const geo4 = await insertTopic(course.id, geoName, "secundaria_4");
    const geo5 = await insertTopic(course.id, geoName, "secundaria_5");
    // Topic A: a single grade, nothing to collapse — only its folder's suffix
    // is stripped, and that strip collides with a hand-made folder.
    const aritName = `Arit ${suffix}`;
    const arit4 = await insertTopic(course.id, aritName, "secundaria_4");
    // Group C: THREE copies whose folders form a chain root → child → keeper.
    const chainName = `Cadena ${suffix}`;
    const chain3 = await insertTopic(course.id, chainName, "secundaria_3");
    const chain4 = await insertTopic(course.id, chainName, "secundaria_4");
    const chain5 = await insertTopic(course.id, chainName, "secundaria_5");
    // Group E: three copies again, for the "two losers each holding an
    // 'Ejercicios' while one also holds 'Ejercicios (2)'" case.
    const ejerName = `Ejer ${suffix}`;
    const ejer3 = await insertTopic(course.id, ejerName, "secundaria_3");
    const ejer4 = await insertTopic(course.id, ejerName, "secundaria_4");
    const ejer5 = await insertTopic(course.id, ejerName, "secundaria_5");
    // Two SEPARATE courses holding a topic of the same name: nothing collapses,
    // but both seeded folders strip to the same name in one tenant's root.
    const course2 = await one<{ id: string }>(
      `insert into courses (name, stage) values ($1, 'colegio') returning id`,
      [`Mig Course2 ${suffix}`],
    );
    const dupName = `Dup ${suffix}`;
    const dupA = await insertTopic(course.id, dupName, "secundaria_4");
    const dupB = await insertTopic(course2.id, dupName, "secundaria_4");
    // The same pair again, but with a topic name long enough that
    // "<name> · <label>" does not fit in `MAX_FOLDER_NAME_LENGTH` — so both
    // seeded folder names are CLAMPED and the second was numbered on top of the
    // clamp, which is where the numbering arithmetic gets delicate.
    const longName = `Larga ${suffix}`.padEnd(70, "y").slice(0, 70);
    const longA = await insertTopic(course.id, longName, "secundaria_4");
    const longB = await insertTopic(course2.id, longName, "secundaria_4");
    // Group L: a merge whose two colliding child names are already a clamped
    // "… (2)" of EXACTLY 80 characters.
    const largName = `Larg ${suffix}`;
    const larg4 = await insertTopic(course.id, largName, "secundaria_4");
    const larg5 = await insertTopic(course.id, largName, "secundaria_5");
    // Two groups interleaved along one branch, for the parent_id cycle case.
    const cycloName = `Ciclo ${suffix}`;
    const cyclo4 = await insertTopic(course.id, cycloName, "secundaria_4");
    const cyclo5 = await insertTopic(course.id, cycloName, "secundaria_5");
    const cyclo2Name = `Ciclo2 ${suffix}`;
    const cyclo24 = await insertTopic(course.id, cyclo2Name, "secundaria_4");
    const cyclo25 = await insertTopic(course.id, cyclo2Name, "secundaria_5");

    const tenant = await one<{ id: string }>(
      `insert into tenants (name, slug) values ($1, $2) returning id`,
      [`Mig Tenant ${suffix}`, `mig-tenant-${suffix}`],
    );
    const user = await one<{ id: string }>(
      `insert into users (tenant_id, email, password_hash, role) values ($1, $2, 'x', 'teacher') returning id`,
      [tenant.id, `mig-${suffix}@exams-generator.test`],
    );
    // A SECOND school, whose only folder for group T sits on the LOSING copy.
    const tenant2 = await one<{ id: string }>(
      `insert into tenants (name, slug) values ($1, $2) returning id`,
      [`Mig Tenant2 ${suffix}`, `mig-tenant2-${suffix}`],
    );

    async function insertQuestion(topicId: string, gradeLevel: string): Promise<string> {
      const row = await one<{ id: string }>(
        `insert into questions
           (tenant_id, topic_id, difficulty, grade_level, status, type, body_typst, body_hash, alternatives, correct_answer, created_by)
         values ($1, $2, 'medium', $3, 'approved', 'structured', 'Enunciado', $4, $5, '0', $6)
         returning id`,
        [tenant.id, topicId, gradeLevel, randomUUID(), JSON.stringify(["a", "b", "c", "d"]), user.id],
      );
      return row.id;
    }

    // One question on EACH copy: both must end on the canonical topic, neither
    // may be lost, and each keeps its own `grade_level`.
    const questionOnLoser = await insertQuestion(topic5, "secundaria_5");
    const questionOnCanonical = await insertQuestion(topic4, "secundaria_4");

    // Group T's folders, tenant 1. `folder4` has the lower position → keeper.
    const folder4 = await insertFolder(tenant.id, `${trigoName} · 4° secundaria`, null, topic4, 0);
    const folder5 = await insertFolder(tenant.id, `${trigoName} · 5° secundaria`, null, topic5, 1);
    // A child of the folder that will LOSE the merge — it must be re-parented.
    const childSub = await insertFolder(tenant.id, `Sub ${suffix}`, folder5, null, 0);
    // Both the keeper and the loser have a child called "Ejercicios": moving
    // the loser's under the keeper collides on `question_folders_sibling_name_idx`.
    const exerciseKeep = await insertFolder(tenant.id, "Ejercicios", folder4, null, 1);
    const exerciseMove = await insertFolder(tenant.id, "Ejercicios", folder5, null, 1);
    // The questions are filed, one under the loser folder and one under the keeper.
    await pool.query(`update questions set folder_id = $1 where id = $2`, [folder5, questionOnLoser]);
    await pool.query(`update questions set folder_id = $1 where id = $2`, [folder4, questionOnCanonical]);

    // Group G: the keeper folder is a CHILD of the loser folder. Deleting the
    // loser would cascade the keeper away (`parent_id` is ON DELETE CASCADE).
    const geoLoser = await insertFolder(tenant.id, `${geoName} · 5° secundaria`, null, geo5, 5);
    const geoKeeper = await insertFolder(tenant.id, `${geoName} · 4° secundaria`, geoLoser, geo4, 1);
    // Hand-made roots that already occupy the names the strip wants: the
    // stripped folder has to skip BOTH and land on " (3)".
    await insertFolder(tenant.id, geoName, null, null, 20);
    await insertFolder(tenant.id, `${geoName} (2)`, null, null, 21);

    // Topic A: one seeded folder to strip, one hand-made folder already named
    // exactly like the topic → the stripped one becomes " (2)".
    const aritFolder = await insertFolder(tenant.id, `${aritName} · 4° secundaria`, null, arit4, 30);
    await insertFolder(tenant.id, aritName, null, null, 31);

    // Group C, the chain: M (root) → L (child of M) → K (child of L), all three
    // pointing at copies of ONE concept, K the lowest position and therefore
    // the keeper. Lifting K to "its loser's parent" lands on M, whose own
    // keeper IS K — so a one-step lift makes K its own parent and then orphans
    // it. K has to walk up past every folder the merge deletes.
    const chainM = await insertFolder(tenant.id, `${chainName} · 5° secundaria`, null, chain5, 9);
    const chainL = await insertFolder(tenant.id, `${chainName} · 4° secundaria`, chainM, chain4, 8);
    const chainK = await insertFolder(tenant.id, `${chainName} · 3° secundaria`, chainL, chain3, 7);
    // K's own child and a question filed in a folder that disappears: both must
    // come out of the merge intact.
    const chainChild = await insertFolder(tenant.id, `Cadena hija ${suffix}`, chainK, null, 0);
    const chainQuestion = await insertQuestion(chain5, "secundaria_5");
    await pool.query(`update questions set folder_id = $1 where id = $2`, [chainL, chainQuestion]);

    // Group E: the keeper has NO children; two losers each bring an
    // "Ejercicios", and one of them also brings an "Ejercicios (2)". The
    // second "Ejercicios" therefore cannot take "Ejercicios (2)" — that name
    // belongs to a folder moving into the same parent — and needs a candidate
    // beyond the naive budget.
    const ejerKeeper = await insertFolder(tenant.id, `${ejerName} · 3° secundaria`, null, ejer3, 50);
    const ejerLoser1 = await insertFolder(tenant.id, `${ejerName} · 4° secundaria`, null, ejer4, 51);
    const ejerLoser2 = await insertFolder(tenant.id, `${ejerName} · 5° secundaria`, null, ejer5, 52);
    const ejerChild1 = await insertFolder(tenant.id, "Ejercicios", ejerLoser1, null, 0);
    const ejerChild2 = await insertFolder(tenant.id, "Ejercicios", ejerLoser2, null, 1);
    const ejerChild3 = await insertFolder(tenant.id, "Ejercicios (2)", ejerLoser2, null, 2);

    // Two seeded sibling folders for same-named topics in different courses.
    // The seeder already had to number the second one; both strip to `dupName`,
    // so the strip has to number it again instead of aborting.
    const dupFolderA = await insertFolder(tenant.id, `${dupName} · 4° secundaria`, null, dupA, 40);
    const dupFolderB = await insertFolder(tenant.id, `${dupName} · 4° secundaria (2)`, null, dupB, 41);

    // Long clamped names, both stripping to the same 70-character base. The
    // seeder had to clamp "<topic> · 4° secundaria" to 80 and then number the
    // second one on top of that clamp — both still strip to the topic's name.
    const longFolderAName = `${longName} · 4° secundaria`.slice(0, 80);
    const longFolderBName = `${longFolderAName.slice(0, 76)} (2)`;
    const longFolderA = await insertFolder(tenant.id, longFolderAName, null, longA, 80);
    const longFolderB = await insertFolder(tenant.id, longFolderBName, null, longB, 81);

    // Group L: keeper and loser each hold a child whose name is EXACTLY 80
    // characters and already ends in " (2)" — precisely what the seeder's own
    // clamp-then-number produces. Deriving the next candidate by cutting four
    // characters off THAT name and appending " (2)" reproduces the same string,
    // so the naive candidate list contains a duplicate and runs dry.
    const largStem = `Repaso ${suffix}`.padEnd(76, "z").slice(0, 76);
    const largClampedDup = `${largStem} (2)`;
    expect(largClampedDup).toHaveLength(80);
    const largKeeper = await insertFolder(tenant.id, `${largName} · 4° secundaria`, null, larg4, 70);
    const largLoser = await insertFolder(tenant.id, `${largName} · 5° secundaria`, null, larg5, 71);
    const largKeepChild = await insertFolder(tenant.id, largClampedDup, largKeeper, null, 0);
    const largMoveChild = await insertFolder(tenant.id, largClampedDup, largLoser, null, 1);

    // The cycle: L'(root) → A → L → K → K2, where {L', K2} is one merge group
    // (K2 the keeper) and {L, K} is another (K the keeper). Lifting K to the
    // nearest ancestor the merge does not DELETE lands on A — but A is itself
    // moving under K2, and K2 is K's own child, so K → A → K2 → K closes a
    // parent_id loop that no constraint forbids and every recursive tree query
    // in the app would hang on.
    const cycLPrime = await insertFolder(tenant.id, `${cycloName} · 5° secundaria`, null, cyclo5, 61);
    const cycA = await insertFolder(tenant.id, `Intermedia ${suffix}`, cycLPrime, null, 0);
    const cycL = await insertFolder(tenant.id, `${cyclo2Name} · 5° secundaria`, cycA, cyclo25, 63);
    const cycK = await insertFolder(tenant.id, `${cyclo2Name} · 4° secundaria`, cycL, cyclo24, 62);
    const cycK2 = await insertFolder(tenant.id, `${cycloName} · 4° secundaria`, cycK, cyclo4, 60);

    // Tenant 2's lone folder points at the LOSING copy — it is its own keeper,
    // so it is only re-pointed and stripped, never merged or deleted.
    const tenant2Folder = await insertFolder(tenant2.id, `${trigoName} · 5° secundaria`, null, topic5, 0);

    // `subtopics`: one slug held by BOTH copies (the copy's row is redundant),
    // one held only by the loser (must survive, re-pointed).
    await pool.query(`insert into subtopics (topic_id, slug, name) values ($1, $2, $3)`, [
      topic4,
      "shared-slug",
      "Shared from canonical",
    ]);
    await pool.query(`insert into subtopics (topic_id, slug, name) values ($1, $2, $3)`, [
      topic5,
      "shared-slug",
      "Shared from copy",
    ]);
    await pool.query(`insert into subtopics (topic_id, slug, name) values ($1, $2, $3)`, [
      topic5,
      "only-on-copy",
      "Only on copy",
    ]);

    // `generation_jobs` on the losing copy.
    const generationJob = await one<{ id: string }>(
      `insert into generation_jobs
         (tenant_id, created_by, created_by_role, course_id, topic_id, difficulty, grade_level, count)
       values ($1, $2, 'teacher', $3, $4, 'medium', 'secundaria_5', 3) returning id`,
      [tenant.id, user.id, course.id, topic5],
    );

    // `exams.exam_type` defaults to 'manual' and references the seeded
    // `exam_types` catalog, which is empty on a fresh database.
    await pool.query(
      `insert into exam_types (code, label, course_scope, week_scope, sort_order)
       values ('manual', 'Manual', 'none', 'none', 1)`,
    );
    const exam = await one<{ id: string }>(
      `insert into exams (tenant_id, title, grade_level, created_by)
       values ($1, $2, 'secundaria_4', $3) returning id`,
      [tenant.id, `Mig Exam ${suffix}`, user.id],
    );
    const blueprintRow = await one<{ id: string }>(
      `insert into exam_blueprint_rows (exam_id, course_id, topic_id, count)
       values ($1, $2, $3, 5) returning id`,
      [exam.id, course.id, topic5],
    );

    // `exam_blueprint_templates` is keyed by (university, track, tenant) with a
    // free-text `cycle_label` — it has neither an `exam_type_code` nor a `name`.
    const university = await one<{ id: string }>(
      `insert into universities (code, name) values ($1, $2) returning id`,
      [`mig-uni-${suffix}`, `Mig University ${suffix}`],
    );
    const template = await one<{ id: string }>(
      `insert into exam_blueprint_templates (university_id, cycle_label)
       values ($1, $2) returning id`,
      [university.id, `Mig Cycle ${suffix}`],
    );
    const templateRow = await one<{ id: string }>(
      `insert into exam_blueprint_template_rows (template_id, course_id, topic_id, question_count)
       values ($1, $2, $3, 4) returning id`,
      [template.id, course.id, topic5],
    );

    // A syllabus row on EACH copy for the same template — the collapse must
    // delete the redundant one instead of violating (template_id, topic_id).
    await pool.query(
      `insert into syllabus_week_maps (template_id, course_id, topic_id, week_number)
       values ($1, $2, $3, 1), ($1, $2, $4, 2)`,
      [template.id, course.id, topic4, topic5],
    );

    // --- run 0023 ---------------------------------------------------------
    await migrate(drizzle(pool), { migrationsFolder: migrationsDir });

    // 1. One topic per concept survives, and each is the lower-sort_order copy.
    const { rows: remaining } = await pool.query<{ id: string }>(
      `select id from topics where course_id = $1`,
      [course.id],
    );
    expect(remaining.map((row) => row.id).sort()).toEqual(
      [arit4, geo4, topic4, chain3, ejer3, dupA, longA, larg4, cyclo4, cyclo24].sort(),
    );

    // 2. Both grades survive as topic_grades rows on the canonical topic.
    async function gradesOf(topicId: string): Promise<string[]> {
      const { rows } = await pool.query<{ grade_level: string }>(
        `select grade_level from topic_grades where topic_id = $1 order by grade_level`,
        [topicId],
      );
      return rows.map((row) => row.grade_level);
    }
    expect(await gradesOf(topic4)).toEqual(["secundaria_4", "secundaria_5"]);
    expect(await gradesOf(geo4)).toEqual(["secundaria_4", "secundaria_5"]);
    expect(await gradesOf(arit4)).toEqual(["secundaria_4"]);
    expect(await gradesOf(chain3)).toEqual(["secundaria_3", "secundaria_4", "secundaria_5"]);
    expect(await gradesOf(ejer3)).toEqual(["secundaria_3", "secundaria_4", "secundaria_5"]);

    // 3. BOTH questions are on the canonical topic, neither lost, and each
    //    kept its OWN grade_level.
    const { rows: questionRows } = await pool.query<{
      id: string;
      topic_id: string;
      grade_level: string;
      folder_id: string | null;
    }>(`select id, topic_id, grade_level, folder_id from questions`);
    expect(questionRows).toHaveLength(3);
    const movedQuestion = questionRows.find((row) => row.id === questionOnLoser)!;
    const stayingQuestion = questionRows.find((row) => row.id === questionOnCanonical)!;
    expect(movedQuestion.topic_id).toBe(topic4);
    expect(stayingQuestion.topic_id).toBe(topic4);
    expect(movedQuestion.grade_level).toBe("secundaria_5");
    expect(stayingQuestion.grade_level).toBe("secundaria_4");
    // Both end up in the surviving folder.
    expect(movedQuestion.folder_id).toBe(folder4);
    expect(stayingQuestion.folder_id).toBe(folder4);

    // 4. Folders. The losers are gone, everything they held moved to the
    //    keeper, and every rename dodged a collision instead of aborting.
    const { rows: folderRows } = await pool.query<{
      id: string;
      name: string;
      parent_id: string | null;
      topic_id: string | null;
    }>(`select id, name, parent_id, topic_id from question_folders where tenant_id = $1`, [tenant.id]);
    const folders = new Map(folderRows.map((row) => [row.id, row]));
    expect(folders.has(folder5)).toBe(false);
    expect(folders.has(geoLoser)).toBe(false);

    // The keeper kept its topic and lost the grade suffix.
    expect(folders.get(folder4)!.name).toBe(trigoName);
    expect(folders.get(folder4)!.parent_id).toBeNull();
    // The loser's plain child moved across under its own name.
    expect(folders.get(childSub)!.parent_id).toBe(folder4);
    expect(folders.get(childSub)!.name).toBe(`Sub ${suffix}`);
    // (a) Two children called "Ejercicios" now share one parent: the keeper's
    //     own keeps the bare name, the moved one is numbered.
    expect(folders.get(exerciseKeep)!.parent_id).toBe(folder4);
    expect(folders.get(exerciseKeep)!.name).toBe("Ejercicios");
    expect(folders.get(exerciseMove)!.parent_id).toBe(folder4);
    expect(folders.get(exerciseMove)!.name).toBe("Ejercicios (2)");

    // (2) The keeper was a child of the loser: it was lifted to the loser's
    //     own parent (root) rather than becoming its own parent or being
    //     cascade-deleted along with it.
    expect(folders.get(geoKeeper)!.parent_id).toBeNull();
    expect(folders.get(geoKeeper)!.topic_id).toBe(geo4);
    // (c) Its stripped name "Geo …" was taken, and so was "Geo … (2)".
    expect(folders.get(geoKeeper)!.name).toBe(`${geoName} (3)`);
    // (b) The hand-made folder named exactly like the topic keeps its name;
    //     the stripped one is numbered.
    expect(folders.get(aritFolder)!.name).toBe(`${aritName} (2)`);
    expect(folderRows.filter((row) => row.name === aritName)).toHaveLength(1);

    // (chain) The keeper walked up past BOTH folders the merge deletes and
    // ended at the root — not as its own child, and not cascade-deleted.
    expect(folders.has(chainM)).toBe(false);
    expect(folders.has(chainL)).toBe(false);
    expect(folders.get(chainK)!.parent_id).toBeNull();
    expect(folders.get(chainK)!.name).toBe(chainName);
    expect(folders.get(chainK)!.topic_id).toBe(chain3);
    // Its subtree and the question filed in a deleted folder both landed on it.
    expect(folders.get(chainChild)!.parent_id).toBe(chainK);
    expect(questionRows.find((row) => row.id === chainQuestion)!.topic_id).toBe(chain3);
    expect(questionRows.find((row) => row.id === chainQuestion)!.folder_id).toBe(chainK);

    // (budget) All THREE children of the two losers moved under the keeper.
    // "Ejercicios (2)" is claimed by a folder moving into the same parent, so
    // the second "Ejercicios" has to skip past it — the naive candidate budget
    // ran out here and silently left the row behind to be cascade-deleted.
    expect(folders.has(ejerLoser1)).toBe(false);
    expect(folders.has(ejerLoser2)).toBe(false);
    for (const child of [ejerChild1, ejerChild2, ejerChild3]) {
      expect(folders.get(child)!.parent_id).toBe(ejerKeeper);
    }
    expect(folders.get(ejerChild1)!.name).toBe("Ejercicios");
    expect(folders.get(ejerChild2)!.name).toBe("Ejercicios (3)");
    expect(folders.get(ejerChild3)!.name).toBe("Ejercicios (2)");

    // (b) Two seeded siblings stripping to the SAME name: the first by seed
    // order keeps it, the second is numbered again.
    expect(folders.get(dupFolderA)!.name).toBe(dupName);
    expect(folders.get(dupFolderB)!.name).toBe(`${dupName} (2)`);

    // (b, clamped) Same, but the seeded names were clamped to 80 characters.
    // Both strip to the topic's own 70-character name.
    expect(folders.get(longFolderA)!.name).toBe(longName);
    expect(folders.get(longFolderB)!.name).toBe(`${longName} (2)`);

    // (distinctness) The colliding children are named "<76 chars> (2)" at
    // exactly 80 characters. Cutting 4 characters off that and appending " (2)"
    // gives the SAME string back, so a candidate list built that way repeats
    // itself and the family runs out of names — the migration then either
    // aborts on the unique index or refuses to run. The survivor keeps its
    // name and the moved one goes to " (3)".
    expect(folders.has(largLoser)).toBe(false);
    expect(folders.get(largKeepChild)!.parent_id).toBe(largKeeper);
    expect(folders.get(largKeepChild)!.name).toBe(largClampedDup);
    expect(folders.get(largMoveChild)!.parent_id).toBe(largKeeper);
    expect(folders.get(largMoveChild)!.name).toBe(`${largStem} (3)`);
    expect(folders.get(largMoveChild)!.name).toHaveLength(80);

    // (cycle) K was lifted past A — which is itself moving, under K's own
    // child — all the way to the root, so no parent_id loop is left behind.
    expect(folders.has(cycLPrime)).toBe(false);
    expect(folders.has(cycL)).toBe(false);
    expect(folders.get(cycK)!.parent_id).toBeNull();
    expect(folders.get(cycK2)!.parent_id).toBe(cycK);
    expect(folders.get(cycA)!.parent_id).toBe(cycK2);

    // No folder in the tenant can reach itself by walking up `parent_id`.
    const parentOf = new Map(folderRows.map((row) => [row.id, row.parent_id]));
    for (const start of parentOf.keys()) {
      const seen = new Set<string>([start]);
      let node = parentOf.get(start) ?? null;
      while (node !== null) {
        expect(seen.has(node)).toBe(false);
        seen.add(node);
        node = parentOf.get(node) ?? null;
      }
    }

    // (3) The second school's folder survives, re-pointed and stripped.
    const { rows: tenant2Folders } = await pool.query<{
      id: string;
      name: string;
      topic_id: string | null;
    }>(`select id, name, topic_id from question_folders where tenant_id = $1`, [tenant2.id]);
    expect(tenant2Folders).toHaveLength(1);
    expect(tenant2Folders[0].id).toBe(tenant2Folder);
    expect(tenant2Folders[0].topic_id).toBe(topic4);
    expect(tenant2Folders[0].name).toBe(trigoName);

    // 5. The duplicate syllabus row is gone; the survivor points at the canonical topic.
    const { rows: weekMaps } = await pool.query<{ topic_id: string; week_number: number }>(
      `select topic_id, week_number from syllabus_week_maps where template_id = $1`,
      [template.id],
    );
    expect(weekMaps).toEqual([{ topic_id: topic4, week_number: 1 }]);

    // 6. Every other FK to `topics.id` was re-pointed.
    const job = await one<{ topic_id: string; grade_level: string }>(
      `select topic_id, grade_level from generation_jobs where id = $1`,
      [generationJob.id],
    );
    expect(job.topic_id).toBe(topic4);
    // Same rule as `questions`: the JOB's own grade is not the topic's.
    expect(job.grade_level).toBe("secundaria_5");
    const movedBlueprintRow = await one<{ topic_id: string }>(
      `select topic_id from exam_blueprint_rows where id = $1`,
      [blueprintRow.id],
    );
    expect(movedBlueprintRow.topic_id).toBe(topic4);
    const movedTemplateRow = await one<{ topic_id: string }>(
      `select topic_id from exam_blueprint_template_rows where id = $1`,
      [templateRow.id],
    );
    expect(movedTemplateRow.topic_id).toBe(topic4);

    // 7. Subtopics: the redundant slug collapsed, the copy-only one survived.
    const { rows: subtopicRows } = await pool.query<{ slug: string; name: string }>(
      `select slug, name from subtopics where topic_id = $1 order by slug`,
      [topic4],
    );
    expect(subtopicRows).toEqual([
      { slug: "only-on-copy", name: "Only on copy" },
      { slug: "shared-slug", name: "Shared from canonical" },
    ]);

    // 8. The column and the two old indexes are gone; the new ones are there.
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

    // 9. The new unique index actually bites.
    await expect(
      pool.query(`insert into topics (course_id, name) values ($1, $2)`, [course.id, trigoName]),
    ).rejects.toThrow(/topics_course_id_name_idx/);
  }, 180_000);

  it("refuses to run when two topics in one course share a slug under different names", async () => {
    const pool = await scratchDatabaseAt0022();
    const suffix = randomUUID().slice(0, 8);

    const course = await pool.query<{ id: string }>(
      `insert into courses (name, stage) values ($1, 'colegio') returning id`,
      [`Slug Clash ${suffix}`],
    );
    // Two DIFFERENT names sharing one slug: the collapse groups by name, so
    // both survive and then break `topics_course_id_slug_idx`. Without the
    // pre-flight check the deploy dies on Postgres' generic index error, which
    // names neither the course nor the rows.
    await pool.query(
      `insert into topics (course_id, name, slug, grade_level)
       values ($1, $2, $3, 'secundaria_4'), ($1, $4, $3, 'secundaria_5')`,
      [course.rows[0].id, `Fracciones ${suffix}`, `fracciones-${suffix}`, `Fraccion ${suffix}`],
    );

    await expect(migrate(drizzle(pool), { migrationsFolder: migrationsDir })).rejects.toThrow(
      /share a slug under different names/,
    );
  }, 180_000);
});
