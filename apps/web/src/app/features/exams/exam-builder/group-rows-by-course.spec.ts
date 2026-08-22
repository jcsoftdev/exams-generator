import { describe, it, expect } from 'vitest';
import { groupRowsByCourse } from './group-rows-by-course';
import { ContentRow } from './exam-builder.store';

function row(o: Partial<ContentRow> & { id: string; courseId: string }): ContentRow {
  return {
    id: o.id,
    courseId: o.courseId,
    courseName: o.courseName ?? `Curso ${o.courseId}`,
    topicId: o.topicId ?? 't1',
    topicName: o.topicName ?? 'Tema 1',
  };
}

describe('groupRowsByCourse', () => {
  it('groups rows by courseId, preserving first-seen order', () => {
    const rows = [
      row({ id: 'r1', courseId: 'c1' }),
      row({ id: 'r2', courseId: 'c2' }),
      row({ id: 'r3', courseId: 'c1' }),
    ];

    const groups = groupRowsByCourse(rows);

    expect(groups.map((g) => g.courseId)).toEqual(['c1', 'c2']);
    expect(groups[0]!.rows.map((r) => r.id)).toEqual(['r1', 'r3']);
    expect(groups[1]!.rows.map((r) => r.id)).toEqual(['r2']);
  });

  it('collapses a non-consecutive re-occurrence of the same courseId into one group (NG0955 regression)', () => {
    // Mirrors bulkLoadFromBlueprint appending a sentinel row for a course
    // that already has grid rows earlier in the array.
    const rows = [
      row({ id: 'r1', courseId: 'c1' }),
      row({ id: 'r2', courseId: 'c2' }),
      row({ id: 'r3', courseId: 'c1' }),
    ];

    const groups = groupRowsByCourse(rows);

    expect(groups.length).toBe(2);
    expect(new Set(groups.map((g) => g.courseId)).size).toBe(groups.length);
  });

  it('returns an empty array for no rows', () => {
    expect(groupRowsByCourse([])).toEqual([]);
  });
});
