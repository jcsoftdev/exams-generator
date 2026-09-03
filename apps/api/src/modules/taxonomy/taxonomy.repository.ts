import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { courses, examTypes, topics, tracks, universities } from "../../db/schema";
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
   * The grade this topic is assessed at, or `null` when it applies to the
   * whole stage. The column already existed and was already filtered on
   * (`?gradeLevel=`); it simply was not projected into the response —
   * `bank-new`'s folder field (web) needs it to preselect Grado from a
   * folder's linked topic.
   */
  readonly gradeLevel: string | null;
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
   * Filters by `courseId` and/or the grade level a topic is assessed at, when
   * provided; otherwise returns every topic. Grade filtering is exact — a topic
   * is only returned for the grade(s) it was seeded for.
   */
  async findTopics(courseId?: string, gradeLevel?: string): Promise<TopicListItem[]> {
    return db
      .select({
        id: topics.id,
        name: topics.name,
        courseId: topics.courseId,
        gradeLevel: topics.gradeLevel,
      })
      .from(topics)
      .innerJoin(courses, eq(topics.courseId, courses.id))
      .where(
        and(
          excludesTestCourseName,
          excludesTestTopicName,
          ...(courseId ? [eq(topics.courseId, courseId)] : []),
          ...(gradeLevel ? [eq(topics.gradeLevel, gradeLevel)] : []),
        ),
      );
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
        gradeLevel: topics.gradeLevel,
      })
      .from(topics)
      .innerJoin(courses, eq(topics.courseId, courses.id))
      .where(
        and(
          excludesTestCourseName,
          excludesTestTopicName,
          inArray(topics.courseId, courseIds),
          ...(gradeLevel ? [eq(topics.gradeLevel, gradeLevel)] : []),
        ),
      );
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
