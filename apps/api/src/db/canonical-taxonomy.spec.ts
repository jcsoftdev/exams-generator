import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { BANK_SAMPLE_COURSES, LEGACY_COURSE_ALIASES, LEGACY_TOPICS_TO_DROP, PREUNI_SYLLABUS } from "./seed";

/**
 * Pure data-integrity + conservation tests (no DB) for the canonical
 * two-level topic taxonomy (design doc: canonical topic taxonomy) — the
 * source of truth `seedCanonicalTaxonomy`/`seedSyllabusWeekMaps`/
 * `reconcileLegacyTopics` (`db/seed.ts`) rely on. The conservation test is
 * the critical guard: it proves every raw syllabus/classification label this
 * project ships resolves against `mapsFrom`, so seeding never throws a
 * "no canonical mapping" invariant violation.
 */
const CANONICAL_TAXONOMY_PATH = resolve(__dirname, "data/canonical-taxonomy.json");
const UNI_SYLLABUS_PATH = resolve(__dirname, "data/uni-preuniversitario-syllabus.json");
const UNCP_SYLLABUS_PATH = resolve(__dirname, "data/uncp-preuniversitario-syllabus.json");
const CLASSIFICATION_PATH = resolve(__dirname, "../../../../bank-questions/classification.json");

interface CanonicalSubtopic {
  readonly slug: string;
  readonly name: string;
  readonly mapsFrom: readonly string[];
}
interface CanonicalTopic {
  readonly slug: string;
  readonly name: string;
  readonly mapsFrom: readonly string[];
  readonly subtopics: readonly CanonicalSubtopic[];
}
interface CanonicalCourse {
  readonly course: string;
  readonly topics: readonly CanonicalTopic[];
}
interface CanonicalTaxonomyFile {
  readonly courses: readonly CanonicalCourse[];
}

interface SyllabusWeekEntry {
  readonly week: number;
  readonly topics: readonly string[];
}
interface SyllabusCourseEntry {
  readonly courseName: string;
  readonly weeks: readonly SyllabusWeekEntry[];
}
interface SyllabusFile {
  readonly courses: readonly SyllabusCourseEntry[];
}

interface ClassificationEntry {
  readonly topic: string;
}
interface ClassificationFile {
  readonly biologia: readonly ClassificationEntry[];
  readonly comunicacion: readonly ClassificationEntry[];
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

describe("canonical taxonomy integrity", () => {
  let file: CanonicalTaxonomyFile;

  beforeAll(() => {
    file = loadJson<CanonicalTaxonomyFile>(CANONICAL_TAXONOMY_PATH);
  });

  it("parses and has at least one course", () => {
    expect(Array.isArray(file.courses)).toBe(true);
    expect(file.courses.length).toBeGreaterThan(0);
  });

  it("has no empty course/topic/subtopic name or slug", () => {
    for (const course of file.courses) {
      expect(course.course.trim().length).toBeGreaterThan(0);
      for (const topic of course.topics) {
        expect(topic.slug.trim().length).toBeGreaterThan(0);
        expect(topic.name.trim().length).toBeGreaterThan(0);
        for (const subtopic of topic.subtopics) {
          expect(subtopic.slug.trim().length).toBeGreaterThan(0);
          expect(subtopic.name.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("has unique topic slugs within each course", () => {
    for (const course of file.courses) {
      const slugs = course.topics.map((topic) => topic.slug);
      expect(new Set(slugs).size).toBe(slugs.length);
    }
  });

  it("has unique subtopic slugs within each topic", () => {
    for (const course of file.courses) {
      for (const topic of course.topics) {
        const slugs = topic.subtopics.map((subtopic) => subtopic.slug);
        expect(new Set(slugs).size).toBe(slugs.length);
      }
    }
  });

  it("has no legacy label duplicated across two topics/subtopics of the same course", () => {
    // `seedCanonicalTaxonomy` indexes by `${course} ${label}` — a label
    // claimed by two entries in the same course would silently resolve to
    // whichever was indexed last, hiding a real ambiguity.
    for (const course of file.courses) {
      const seen = new Map<string, string>();
      for (const topic of course.topics) {
        for (const label of topic.mapsFrom) {
          expect(seen.has(label)).toBe(false);
          seen.set(label, topic.slug);
        }
        for (const subtopic of topic.subtopics) {
          for (const label of subtopic.mapsFrom) {
            expect(seen.has(label)).toBe(false);
            seen.set(label, `${topic.slug}/${subtopic.slug}`);
          }
        }
      }
    }
  });

  it("has no duplicate course names", () => {
    const names = file.courses.map((course) => course.course);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("canonical taxonomy conservation", () => {
  let taxonomy: CanonicalTaxonomyFile;
  let labelsByCourse: Map<string, Set<string>>;

  beforeAll(() => {
    taxonomy = loadJson<CanonicalTaxonomyFile>(CANONICAL_TAXONOMY_PATH);
    labelsByCourse = new Map(
      taxonomy.courses.map((course) => {
        const labels = new Set<string>();
        for (const topic of course.topics) {
          for (const label of topic.mapsFrom) {
            labels.add(label);
          }
          for (const subtopic of topic.subtopics) {
            for (const label of subtopic.mapsFrom) {
              labels.add(label);
            }
          }
        }
        return [course.course, labels] as const;
      }),
    );
  });

  function assertSyllabusConserved(syllabusPath: string): void {
    const file = loadJson<SyllabusFile>(syllabusPath);
    const missing: string[] = [];

    for (const course of file.courses) {
      const labels = labelsByCourse.get(course.courseName);
      for (const weekEntry of course.weeks) {
        for (const topicLabel of weekEntry.topics) {
          if (!labels || !labels.has(topicLabel)) {
            missing.push(`${course.courseName} / ${topicLabel} (week ${weekEntry.week})`);
          }
        }
      }
    }

    expect(missing).toEqual([]);
  }

  it("every UNI syllabus week-topic label maps to a canonical entry", () => {
    assertSyllabusConserved(UNI_SYLLABUS_PATH);
  });

  it("every UNCP syllabus week-topic label maps to a canonical entry", () => {
    assertSyllabusConserved(UNCP_SYLLABUS_PATH);
  });

  it("every classification.json topic label maps to a canonical subtopic", () => {
    const classification = loadJson<ClassificationFile>(CLASSIFICATION_PATH);
    const sections: ReadonlyArray<{ courseName: string; entries: readonly ClassificationEntry[] }> = [
      { courseName: "Biología", entries: classification.biologia },
      { courseName: "Comunicación", entries: classification.comunicacion },
    ];

    const missing: string[] = [];
    for (const section of sections) {
      const labels = labelsByCourse.get(section.courseName);
      for (const entry of section.entries) {
        if (!labels || !labels.has(entry.topic)) {
          missing.push(`${section.courseName} / ${entry.topic}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });

  /**
   * `reconcileLegacyTopics` (`db/seed.ts`) iterates every slug-NULL
   * preuniversitario topic at runtime — those legacy rows come from
   * `PREUNI_SYLLABUS`/`BANK_SAMPLE_COURSES`'s raw course/topic-name lists
   * (imported directly from `./seed`, not replicated here, so this test
   * can't drift from the actual source), not from a JSON file, so the
   * conservation tests above never covered them. Without this test, editing
   * either array (adding a course/topic with no canonical mapping) would
   * only surface as a runtime throw the next time `seed()` runs — this
   * fails at test time instead, applying the exact same
   * `LEGACY_COURSE_ALIASES` Historia aliasing and `LEGACY_TOPICS_TO_DROP`
   * allowlist `reconcileLegacyTopics` itself uses.
   */
  it("every PREUNI_SYLLABUS/BANK_SAMPLE_COURSES topic name resolves to a canonical mapping", () => {
    const missing: string[] = [];

    for (const course of [...PREUNI_SYLLABUS, ...BANK_SAMPLE_COURSES]) {
      const aliasCourseName = LEGACY_COURSE_ALIASES[course.name] ?? course.name;
      const labels = labelsByCourse.get(course.name) ?? labelsByCourse.get(aliasCourseName);

      for (const topic of course.topics) {
        if (LEGACY_TOPICS_TO_DROP.has(`${course.name} / ${topic.name}`)) {
          continue;
        }
        if (!labels || !labels.has(topic.name)) {
          missing.push(`${course.name} / ${topic.name}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
