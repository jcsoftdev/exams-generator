import { Role } from "@exams-generator/shared";
import { eq } from "drizzle-orm";
import { GRADE_LEVELS } from "../modules/exams/domain/value-objects/grade-level";
import { db, pool } from "./client";
import { courses, gradeLevels, tenants, topics, users } from "./schema";

/**
 * Demo course -> topic taxonomy. Small on purpose (this is seed/demo data,
 * not the real bank): mirrors the exact example given in the design doc
 * (§3: "Aritmética, Álgebra, RM, RV..." / "fracciones, ecuaciones...").
 */
const DEMO_COURSES: ReadonlyArray<{ name: string; topics: readonly string[] }> = [
  { name: "Aritmética", topics: ["Fracciones", "Porcentajes"] },
  { name: "Álgebra", topics: ["Ecuaciones", "Factorización"] },
  { name: "Razonamiento Matemático", topics: ["Series", "Analogías numéricas"] },
  { name: "Razonamiento Verbal", topics: ["Analogías verbales", "Comprensión de lectura"] },
];

const DEMO_TENANT = {
  name: "Colegio Demo",
  slug: "colegio-demo",
};

const DEMO_ADMIN = {
  email: "admin@colegio-demo.test",
  // NOTE: not a real bcrypt hash — the auth module (PR5) owns password
  // hashing and will replace this with a properly hashed value once it
  // exists. This seed only needs a syntactically valid, clearly-marked
  // placeholder so `password_hash NOT NULL` is satisfied.
  passwordHash: "unset-pending-auth-module-pr5",
  role: Role.SchoolAdmin,
};

/**
 * Idempotent: every insert targets a unique column with
 * `onConflictDoNothing`, so running this twice (or a hundred times) never
 * creates duplicates and never throws — required by task 2.7.
 */
export async function seed(): Promise<void> {
  await seedGradeLevels();
  const tenantId = await seedDemoTenant();
  await seedDemoAdmin(tenantId);
  await seedDemoCoursesAndTopics();
}

async function seedGradeLevels(): Promise<void> {
  const rows = GRADE_LEVELS.map((code, index) => ({ code, sortOrder: index }));
  await db.insert(gradeLevels).values(rows).onConflictDoNothing({ target: gradeLevels.code });
}

async function seedDemoTenant(): Promise<string> {
  await db.insert(tenants).values(DEMO_TENANT).onConflictDoNothing({ target: tenants.slug });

  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, DEMO_TENANT.slug));

  if (!tenant) {
    throw new Error(`Seed invariant violated: tenant '${DEMO_TENANT.slug}' missing after insert`);
  }

  return tenant.id;
}

async function seedDemoAdmin(tenantId: string): Promise<void> {
  await db
    .insert(users)
    .values({ ...DEMO_ADMIN, tenantId })
    .onConflictDoNothing({ target: users.email });
}

async function seedDemoCoursesAndTopics(): Promise<void> {
  for (const course of DEMO_COURSES) {
    await db.insert(courses).values({ name: course.name }).onConflictDoNothing({ target: courses.name });

    const [courseRow] = await db.select({ id: courses.id }).from(courses).where(eq(courses.name, course.name));

    if (!courseRow) {
      throw new Error(`Seed invariant violated: course '${course.name}' missing after insert`);
    }

    for (const topicName of course.topics) {
      await db
        .insert(topics)
        .values({ courseId: courseRow.id, name: topicName })
        .onConflictDoNothing({ target: [topics.courseId, topics.name] });
    }
  }
}

/* istanbul ignore next -- CLI entrypoint, exercised manually / in deploys, not under unit test */
if (require.main === module) {
  seed()
    .then(() => {
      // eslint-disable-next-line no-console
      console.log("Seed complete.");
      return pool.end();
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error("Seed failed:", error);
      return pool.end().finally(() => process.exit(1));
    });
}
