/**
 * The status tag every exam screen shows, in one place.
 *
 * Two facts get confused here and must not be: an exam's STATUS (`draft` vs
 * `ready` — has the teacher confirmed the selection?) and whether any FORMS
 * have actually been compiled. "Generado" reads as "los PDFs están listos",
 * so claiming it for a `ready` exam with zero forms sends a teacher to a
 * download screen with nothing on it (audit 2026-08-15).
 *
 * This lived as three separate copies — `exam-list`, `exam-versions-panel`
 * and `dashboard` — under a "kept as a local duplicate" convention, and they
 * drifted exactly as you would expect: one screen said "Generado" for an exam
 * with no forms, another said "Lista" (feminine, for `examen`) for the same
 * row. Shared so the next fix cannot land on one screen only.
 *
 * `versionCount` is optional because not every screen loads it — the
 * dashboard's recent-exams list carries no form count. When it is unknown the
 * label degrades to "Listo", which is true of any `ready` exam, rather than
 * guessing "Generado".
 */
export function examStatusLabel(status: string, versionCount: number | undefined): string {
  if (status !== 'ready') {
    return 'Borrador';
  }
  return (versionCount ?? 0) > 0 ? 'Generado' : 'Listo';
}
