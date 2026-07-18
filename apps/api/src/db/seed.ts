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

/**
 * Courses + topics required by `scripts/seed-bank-sample.ts` (71 real
 * image-type questions, grade level "pre", central bank / tenant_id NULL).
 * Topic names are copied verbatim from `bank-questions/classification.json`
 * (the `topic` field of every entry) so the sample-seeding script can
 * resolve `topicId` by exact name match after this runs.
 */
const BANK_SAMPLE_COURSES: ReadonlyArray<{ name: string; topics: readonly string[] }> = [
  {
    name: "Biología",
    topics: [
      "biología general",
      "método científico",
      "fisiología humana",
      "evolución",
      "bioquímica",
      "citología",
      "biología molecular",
      "microbiología",
      "bioenergética",
      "fotosíntesis",
      "sistema nervioso",
      "biotecnología",
    ],
  },
  {
    name: "Comunicación",
    topics: [
      "morfología verbal (accidentes del verbo)",
      "acentuación - clasificación de palabras según su acento (agudas, graves, esdrújulas, sobresdrújulas)",
      "sintaxis - complementos oracionales (complemento agente)",
      "ortografía - uso de mayúsculas",
      "clases de oraciones según la actitud del hablante",
      "morfología - clases de palabras (adjetivo)",
      "teoría de la comunicación - concepto y elementos",
      "morfología - formación de palabras (prefijos y sufijos)",
      "morfología - clases de palabras (adverbio)",
      "morfología - clasificación del sustantivo (individual y colectivo)",
      "morfología - clases de palabras (pronombre)",
      "sintaxis - la oración (concepto y estructura)",
      "fonética - diptongo, triptongo e hiato",
      "semántica - concepto y niveles de la lengua",
      "acentuación - conceptos generales (acento, tilde, sílaba tónica y átona)",
      "morfología - clases de palabras (sustantivo)",
      "ortografía - signos de puntuación y entonación",
      "teoría de la comunicación - funciones del lenguaje",
      "gramática - niveles de la lengua (fonética, morfología, sintaxis, semántica)",
      "morfología - formación de palabras (composición y derivación)",
      "ortografía - signos de puntuación (uso del punto y coma)",
      "sintaxis - funciones del sustantivo en la oración",
      "sintaxis - estructura del sujeto (núcleo y modificadores)",
      "lingüística - articulación del lenguaje (doble articulación)",
      "teoría de la comunicación - etimología del término comunicación",
      "acentuación - clasificación de palabras según su acento (tildación)",
      "sintaxis - el sujeto de la oración",
      "ortografía - uso de los dos puntos",
      "sintaxis - el sujeto tácito",
      "sintaxis - clases de sujeto",
      "lingüística - características de la lengua",
      "teoría de la comunicación - elementos de la comunicación (receptor)",
      "lingüística - ramas de la lingüística",
      "ortografía - uso de grafías (ortografía literal)",
      "acentuación - hiato",
      "morfología - clases de verbo (transitivo/intransitivo)",
      "sintaxis - el predicado (núcleo)",
      "sintaxis - el sintagma verbal / predicado",
      "lingüística - el fonema (unidades mínimas del lenguaje)",
      "teoría de la comunicación - lengua, lenguaje y habla",
    ],
  },
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
 * Platform-staff user (`tenant_id NULL`) that `scripts/seed-bank-sample.ts`
 * signs its JWT for. `questions.created_by` is a NOT NULL FK to `users.id`,
 * so a real row is required — there is no login endpoint yet (PR5+ auth
 * module scope) to create one interactively.
 */
const BANK_SAMPLE_ADMIN = {
  email: "bank-sample-seeder@exams-generator.internal",
  // NOTE: same placeholder convention as DEMO_ADMIN — see comment above.
  passwordHash: "unset-pending-auth-module-pr5",
  role: Role.PlatformAdmin,
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
  await seedBankSampleAdmin();
  await seedCoursesAndTopics(DEMO_COURSES);
  await seedCoursesAndTopics(BANK_SAMPLE_COURSES);
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

async function seedBankSampleAdmin(): Promise<void> {
  await db
    .insert(users)
    .values({ ...BANK_SAMPLE_ADMIN, tenantId: null })
    .onConflictDoNothing({ target: users.email });
}

async function seedCoursesAndTopics(
  courseList: ReadonlyArray<{ name: string; topics: readonly string[] }>,
): Promise<void> {
  for (const course of courseList) {
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
