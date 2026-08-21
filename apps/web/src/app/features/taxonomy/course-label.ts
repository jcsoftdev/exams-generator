import { Course } from './taxonomy.models';

/**
 * Short stage names, for use INSIDE a course label. `STAGE_LABELS` in
 * `exams.models.ts` is the long form ("Colegio (Secundaria)") used where the
 * stage is the subject of the control; here it is a suffix on a name that is
 * already long, so it stays terse.
 */
const SHORT_STAGE_LABELS: Readonly<Record<string, string>> = {
  escuela: 'Escuela',
  colegio: 'Colegio',
  preuniversitario: 'Preuniversitario',
};

function normalize(name: string): string {
  return name.trim().toLocaleLowerCase('es-PE');
}

/**
 * Maps course id -> the label to show, disambiguating ONLY the names that
 * actually repeat.
 *
 * Course uniqueness is `(stage, name)`, so the same subject legitimately
 * exists once per educational stage: the seeded catalog has "Comunicación"
 * three times and "Matemática", "Arte y Cultura" and "Educación Física" twice
 * each. The bank tree printed the bare name, so with the "Todos" filter on
 * there was no way to tell which one to open (audit 2026-08-20, M2).
 *
 * Only duplicates get the suffix, on purpose: tagging every course would make
 * the common case noisier to fix the uncommon one. An unknown stage code is
 * printed raw rather than dropped — a distinction we cannot name is still a
 * distinction the reader needs.
 */
export function courseLabels(courses: readonly Course[]): ReadonlyMap<string, string> {
  const occurrences = new Map<string, number>();
  for (const course of courses) {
    const key = normalize(course.name);
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }

  return new Map(
    courses.map((course) => {
      const name = course.name.trim();
      const repeated = (occurrences.get(normalize(course.name)) ?? 0) > 1;
      if (!repeated) {
        return [course.id, name];
      }
      const stage = SHORT_STAGE_LABELS[course.stage] ?? course.stage;
      return [course.id, `${name} · ${stage}`];
    }),
  );
}
