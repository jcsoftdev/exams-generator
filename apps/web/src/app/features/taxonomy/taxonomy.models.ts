/** Mirrors `CourseListItem` from apps/api/src/modules/taxonomy/taxonomy.repository.ts. */
export interface Course {
  readonly id: string;
  readonly name: string;
  /**
   * `escuela | colegio | preuniversitario`. Typed as a string, not the `Stage`
   * union: it comes straight off the API and a stage added there before the web
   * knows about it must still render (see `courseLabels`).
   */
  readonly stage: string;
}

/** Mirrors `TopicListItem` from apps/api/src/modules/taxonomy/taxonomy.repository.ts. */
export interface Topic {
  readonly id: string;
  readonly name: string;
  readonly courseId: string;
  /**
   * The grade this topic is assessed at, or `null` when it applies to the
   * whole stage. `GET /topics` now projects `topics.grade_level` (round 2 of
   * this task) on both `findTopics` and `findTopicsByCourseIds`, so every
   * producer of a `Topic` supplies it — `bank-new`'s folder field reads it to
   * preselect Grado from a folder's linked topic.
   */
  readonly gradeLevel: string | null;
}
