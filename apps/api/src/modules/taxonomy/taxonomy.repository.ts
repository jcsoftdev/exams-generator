import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import { courses, examTypes, topics, tracks, universities } from "../../db/schema";
import type { Stage } from "../exams/domain/value-objects/grade-level";

export interface CourseListItem {
  readonly id: string;
  readonly name: string;
}

export interface TopicListItem {
  readonly id: string;
  readonly name: string;
  readonly courseId: string;
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
  /** Filters by educational `stage` when provided; otherwise returns every course. */
  async findAllCourses(stage?: Stage): Promise<CourseListItem[]> {
    const query = db.select({ id: courses.id, name: courses.name }).from(courses);

    if (stage) {
      return query.where(eq(courses.stage, stage));
    }

    return query;
  }

  /**
   * Filters by `courseId` and/or the grade level a topic is assessed at, when
   * provided; otherwise returns every topic. Grade filtering is exact — a topic
   * is only returned for the grade(s) it was seeded for.
   */
  async findTopics(courseId?: string, gradeLevel?: string): Promise<TopicListItem[]> {
    const query = db
      .select({ id: topics.id, name: topics.name, courseId: topics.courseId })
      .from(topics);

    const conditions = [
      ...(courseId ? [eq(topics.courseId, courseId)] : []),
      ...(gradeLevel ? [eq(topics.gradeLevel, gradeLevel)] : []),
    ];

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }

    return query;
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

    const query = db
      .select({ id: topics.id, name: topics.name, courseId: topics.courseId })
      .from(topics);

    const conditions = [
      inArray(topics.courseId, courseIds),
      ...(gradeLevel ? [eq(topics.gradeLevel, gradeLevel)] : []),
    ];

    return query.where(and(...conditions));
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
