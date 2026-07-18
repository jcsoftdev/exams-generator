import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { courses, topics } from "../../db/schema";

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
  async findAllCourses(): Promise<CourseListItem[]> {
    return db.select({ id: courses.id, name: courses.name }).from(courses);
  }

  /** Filters by `courseId` when provided; otherwise returns every topic. */
  async findTopics(courseId?: string): Promise<TopicListItem[]> {
    const query = db
      .select({ id: topics.id, name: topics.name, courseId: topics.courseId })
      .from(topics);

    if (courseId) {
      return query.where(eq(topics.courseId, courseId));
    }

    return query;
  }
}
