/** Mirrors `CourseListItem` from apps/api/src/modules/taxonomy/taxonomy.repository.ts. */
export interface Course {
  readonly id: string;
  readonly name: string;
}

/** Mirrors `TopicListItem` from apps/api/src/modules/taxonomy/taxonomy.repository.ts. */
export interface Topic {
  readonly id: string;
  readonly name: string;
  readonly courseId: string;
}
