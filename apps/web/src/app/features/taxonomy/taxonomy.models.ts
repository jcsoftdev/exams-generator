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
   * The grade this topic is assessed at. OPTIONAL because `GET /topics` does
   * NOT project `topics.grade_level` today — the column exists and is already
   * filtered on (`findTopics`'s `?gradeLevel=`), it is simply not selected
   * into `TopicListItem`. `bank-new`'s folder field reads it to preselect
   * Grado from the folder's topic and degrades to "leave Grado alone" while
   * it is absent, so exposing it API-side is a purely additive change (two
   * `select({...})` calls, the interface, and the one `toEqual` in
   * `taxonomy.e2e.spec.ts`) with no client migration.
   */
  readonly gradeLevel?: string | null;
}
