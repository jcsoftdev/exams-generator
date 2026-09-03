import { and, asc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { db } from "../../db/client";
import { courses, examTypes, gradeLevels, topicGrades, topics, tracks, universities } from "../../db/schema";
import { TEST_TAXONOMY_NAME_PATTERN } from "../../db/test-taxonomy-name";
import type { Stage } from "../exams/domain/value-objects/grade-level";

/**
 * Keeps test-factory rows out of every product-facing catalog read (audit
 * 2026-08-20, H1). `courses`/`topics` are GLOBAL — no `tenant_id` — so an
 * interrupted spec run leaves its fixtures visible to real teachers in the
 * exam builder until someone runs `db:purge-test-taxonomy`. This is the read
 * guard that makes the purge cleanup rather than the only defence; both key
 * off the same signature (`TEST_TAXONOMY_NAME_PATTERN`).
 *
 * Applied to the topic's own name as well as its course's: a spec that hangs
 * its fixture topic off a real course would otherwise slip through.
 */
const excludesTestCourseName = sql`${courses.name} !~ ${TEST_TAXONOMY_NAME_PATTERN}`;
const excludesTestTopicName = sql`${topics.name} !~ ${TEST_TAXONOMY_NAME_PATTERN}`;

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
 *
 * `OR NOT EXISTS (any topic_grades row)`: a topic with zero rows in
 * `topic_grades` is taught across its WHOLE stage (design doc 2026-09-03),
 * so it has to match every grade filter, not just the ones that happen to be
 * listed. A bare `EXISTS` would silently drop it from every grade-filtered
 * result.
 */
function topicTaughtAt(gradeLevel: string): SQL {
  return sql`(
    exists (
      select 1 from ${topicGrades}
      where ${topicGrades.topicId} = ${topics.id}
        and ${topicGrades.gradeLevel} = ${gradeLevel}
    )
    or not exists (
      select 1 from ${topicGrades}
      where ${topicGrades.topicId} = ${topics.id}
    )
  )`;
}

export interface CourseListItem {
  readonly id: string;
  readonly name: string;
  /**
   * Escuela | colegio | preuniversitario. Shipped because course NAMES repeat
   * across stages by design — uniqueness is `(stage, name)` — so "Comunicación"
   * legitimately exists three times and the stage is the only thing that tells
   * the three apart in a catalog listing (audit 2026-08-20, M2).
   */
  readonly stage: string;
}

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
   * filter below MATCHES it regardless of the grade asked for, rather than
   * excluding it for having no row to match (`topicTaughtAt`).
   */
  readonly gradeLevels: readonly string[];
}

export interface UniversityListItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export interface TrackListItem {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: string;
}

export interface ExamTypeListItem {
  readonly code: string;
  readonly label: string;
  readonly courseScope: string;
  readonly weekScope: string;
}

/**
 * Drizzle-backed read-only persistence for the global course/topic taxonomy
 * (design doc: courses/topics are shared across every tenant, never
 * tenant-scoped). Kept as a thin class with no repository port/interface —
 * same convention as `BankRepository`, since nothing in this module's scope
 * needs a swappable implementation.
 */
export class TaxonomyRepository {
  /**
   * Filters by educational `stage` when provided; otherwise returns every
   * course. Test-factory rows are never returned — see
   * `excludesTestCourseName`.
   */
  async findAllCourses(stage?: Stage): Promise<CourseListItem[]> {
    return db
      .select({ id: courses.id, name: courses.name, stage: courses.stage })
      .from(courses)
      .where(and(excludesTestCourseName, ...(stage ? [eq(courses.stage, stage)] : [])));
  }

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
   *
   * `orderBy` is not cosmetic: the aggregate above forces a `GROUP BY`, and a
   * grouped query has no implicit order — Postgres returns whatever the hash
   * aggregate produced, i.e. uuid order, so the picker lists the syllabus
   * scrambled and reshuffles between requests.
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
      .groupBy(topics.id, topics.name, topics.courseId)
      .orderBy(asc(topics.name));
  }

  /**
   * Batched sibling of `findTopics` — fetches topics for MULTIPLE courses in
   * a single query. Fixes the N+1 fan-out where 3 Angular components each
   * issued one `GET /topics?courseId=X` per course in parallel (`forkJoin`),
   * which tripped the global `ThrottlerGuard`. An empty `courseIds` returns
   * `[]` immediately WITHOUT querying — an empty `inArray(...)` is unsafe/
   * version-dependent (can behave as an always-false predicate rather than
   * "no filter"), so this never hands Drizzle an empty list.
   *
   * Ordered by name for the same reason as `findTopics`: the grade aggregate
   * groups, and a grouped query with no `ORDER BY` comes back in uuid order.
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
      .groupBy(topics.id, topics.name, topics.courseId)
      .orderBy(asc(topics.name));
  }

  /** Every university in the global catalog, ordered by name. */
  async findAllUniversities(): Promise<UniversityListItem[]> {
    return db
      .select({ id: universities.id, code: universities.code, name: universities.name })
      .from(universities)
      .orderBy(asc(universities.name));
  }

  /**
   * A single university's tracks, ordered by code. A university with no
   * tracks returns `[]` — that's the normal case, not an error (design doc:
   * tracks generalize "area by career"/"prep-cycle track", and not every
   * university needs the concept).
   */
  async findTracksByUniversity(universityId: string): Promise<TrackListItem[]> {
    return db
      .select({ id: tracks.id, code: tracks.code, name: tracks.name, kind: tracks.kind })
      .from(tracks)
      .where(eq(tracks.universityId, universityId))
      .orderBy(asc(tracks.code));
  }

  /** Every exam type in the global catalog, ordered by its curated `sortOrder`. */
  async findAllExamTypes(): Promise<ExamTypeListItem[]> {
    return db
      .select({
        code: examTypes.code,
        label: examTypes.label,
        courseScope: examTypes.courseScope,
        weekScope: examTypes.weekScope,
      })
      .from(examTypes)
      .orderBy(asc(examTypes.sortOrder));
  }
}
