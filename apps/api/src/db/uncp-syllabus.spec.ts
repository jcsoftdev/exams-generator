import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Pure data-integrity test (no DB) for the UNCP approximated weekly syllabus
 * (design doc §8): guards the seed invariant that every `courseName` in the
 * JSON resolves against the preuniversitario course catalog, so
 * `seedSyllabusWeekMaps` -> `getCourseId` never throws at seed time.
 */
const UNCP_SYLLABUS_PATH = resolve(__dirname, "data/uncp-preuniversitario-syllabus.json");

/**
 * The 19 preuniversitario course names this UNCP syllabus is allowed to
 * reference — the union of `PREUNI_SYLLABUS`'s catalog entries (post-rename,
 * see `seed.ts` `UncpAnexo7Row` doc comment) plus `BANK_SAMPLE_COURSES`'s
 * "Comunicación"/"Biología". Kept as a hardcoded expected set (rather than
 * imported) so this test doesn't need to import `seed.ts`'s non-exported
 * constants.
 */
const KNOWN_PREUNI_COURSES = new Set([
  "Aritmética",
  "Álgebra",
  "Geometría",
  "Trigonometría",
  "Razonamiento Matemático",
  "Razonamiento Verbal",
  "Lenguaje",
  "Literatura",
  "Física",
  "Química",
  "Historia del Perú",
  "Historia Universal",
  "Geografía",
  "Economía",
  "Filosofía",
  "Educación Cívica",
  "Psicología",
  "Historia",
  "Inglés",
  "Estadística y Probabilidades",
  "Ecología",
  "Biología",
  "Comunicación",
]);

interface SyllabusWeekEntry {
  readonly week: number;
  readonly topics: readonly string[];
}
interface SyllabusCourseEntry {
  readonly courseName: string;
  readonly weeks: readonly SyllabusWeekEntry[];
}
interface SyllabusFile {
  readonly _source: string;
  readonly courses: readonly SyllabusCourseEntry[];
}

describe("UNCP approximated weekly syllabus data", () => {
  let file: SyllabusFile;

  beforeAll(() => {
    file = JSON.parse(readFileSync(UNCP_SYLLABUS_PATH, "utf8")) as SyllabusFile;
  });

  it("parses and marks itself as an approximation", () => {
    expect(typeof file._source).toBe("string");
    expect(file._source.toUpperCase()).toContain("APPROXIMATION");
    expect(file.courses.length).toBeGreaterThan(0);
  });

  it("has exactly 19 courses, each a known preuniversitario catalog course", () => {
    expect(file.courses).toHaveLength(19);

    for (const course of file.courses) {
      expect(KNOWN_PREUNI_COURSES.has(course.courseName)).toBe(true);
    }

    // No duplicate courseName entries.
    const names = file.courses.map((course) => course.courseName);
    expect(new Set(names).size).toBe(names.length);
  });

  it("has no course with empty weeks, and every week has positive integer numbers and non-empty topics", () => {
    for (const course of file.courses) {
      expect(course.weeks.length).toBeGreaterThan(0);

      for (const weekEntry of course.weeks) {
        expect(Number.isInteger(weekEntry.week)).toBe(true);
        expect(weekEntry.week).toBeGreaterThan(0);
        expect(weekEntry.topics.length).toBeGreaterThan(0);
        for (const topic of weekEntry.topics) {
          expect(typeof topic).toBe("string");
          expect(topic.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("has sequential week numbers per course, starting at 1", () => {
    for (const course of file.courses) {
      const weekNumbers = course.weeks.map((weekEntry) => weekEntry.week);
      const sorted = [...weekNumbers].sort((a, b) => a - b);
      expect(weekNumbers).toEqual(sorted);
      expect(sorted[0]).toBe(1);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(sorted[index]).toBe(sorted[index - 1] + 1);
      }
    }
  });
});
