import { and, eq } from "drizzle-orm";
import { db } from "../../db/client";
import { courses, topics } from "../../db/schema";
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
}
