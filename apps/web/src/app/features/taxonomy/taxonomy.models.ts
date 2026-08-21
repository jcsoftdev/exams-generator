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
}
