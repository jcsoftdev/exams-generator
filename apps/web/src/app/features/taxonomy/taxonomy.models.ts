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
   * Every grade this topic is taught at, ordered by the catalog's sort order.
   * Replaced `gradeLevel: string | null` when a topic stopped being one row per
   * grade (design doc 2026-09-03): the select of Tema no longer shows the same
   * concept once per grade, and `bank-new` reads this list to preselect Grado
   * from a folder's linked topic.
   *
   * EMPTY means "taught across the whole stage" — nothing to preselect.
   */
  readonly gradeLevels: readonly string[];
}
