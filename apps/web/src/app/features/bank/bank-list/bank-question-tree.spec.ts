import { describe, it, expect } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { buildQuestionTree, filterQuestionTree } from './bank-question-tree';
import { BankQuestion } from '../bank.models';

function q(o: Partial<BankQuestion> & { id: string; courseId: string; topicId: string }): BankQuestion {
  return {
    id: o.id,
    tenantId: o.tenantId ?? 't1',
    courseId: o.courseId,
    topicId: o.topicId,
    difficulty: o.difficulty ?? Difficulty.Easy,
    gradeLevel: o.gradeLevel ?? 'pre',
    correctAnswer: o.correctAnswer ?? 'a',
    imageAssetId: o.imageAssetId ?? null,
    status: o.status ?? 'approved',
    type: o.type ?? 'image',
    origin: o.origin ?? 'school',
    usedInExamCount: o.usedInExamCount ?? 0,
  };
}

describe('buildQuestionTree', () => {
  it('groups questions by course -> topic, resolving names and counts from the id maps', () => {
    const questions = [
      q({ id: 'q1', courseId: 'c1', topicId: 't1' }),
      q({ id: 'q2', courseId: 'c1', topicId: 't1' }),
      q({ id: 'q3', courseId: 'c1', topicId: 't2' }),
      q({ id: 'q4', courseId: 'c2', topicId: 't3' }),
    ];
    const courseNames = new Map([
      ['c1', 'Aritmética'],
      ['c2', 'Álgebra'],
    ]);
    const topicNames = new Map([
      ['t1', 'Fracciones'],
      ['t2', 'Porcentajes'],
      ['t3', 'Ecuaciones'],
    ]);

    const tree = buildQuestionTree(questions, courseNames, topicNames);

    expect(tree).toHaveLength(2);
    const aritmetica = tree.find((c) => c.courseId === 'c1');
    expect(aritmetica?.name).toBe('Aritmética');
    expect(aritmetica?.questionCount).toBe(3);
    expect(aritmetica?.topics).toHaveLength(2);
    const fracciones = aritmetica?.topics.find((t) => t.topicId === 't1');
    expect(fracciones?.name).toBe('Fracciones');
    expect(fracciones?.questions.map((it) => it.id)).toEqual(['q1', 'q2']);

    const algebra = tree.find((c) => c.courseId === 'c2');
    expect(algebra?.name).toBe('Álgebra');
    expect(algebra?.topics).toHaveLength(1);
    expect(algebra?.topics[0].questions.map((it) => it.id)).toEqual(['q4']);
  });

  it('sorts courses and topics alphabetically by resolved name (never by raw id)', () => {
    const questions = [
      q({ id: 'q1', courseId: 'c-zeta', topicId: 't-zulu' }),
      q({ id: 'q2', courseId: 'c-alpha', topicId: 't-yankee' }),
      q({ id: 'q3', courseId: 'c-alpha', topicId: 't-alpha' }),
    ];
    const courseNames = new Map([
      ['c-zeta', 'Zoología'],
      ['c-alpha', 'Aritmética'],
    ]);
    const topicNames = new Map([
      ['t-zulu', 'Zonas'],
      ['t-yankee', 'Ya lo sé'],
      ['t-alpha', 'Alfabeto'],
    ]);

    const tree = buildQuestionTree(questions, courseNames, topicNames);

    expect(tree.map((c) => c.name)).toEqual(['Aritmética', 'Zoología']);
    const aritmetica = tree[0];
    expect(aritmetica.topics.map((t) => t.name)).toEqual(['Alfabeto', 'Ya lo sé']);
  });

  it('falls back to a friendly label (never the raw UUID) when a name is unresolved', () => {
    const questions = [q({ id: 'q1', courseId: 'missing-course', topicId: 'missing-topic' })];

    const tree = buildQuestionTree(questions, new Map(), new Map());

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('Curso sin nombre');
    expect(tree[0].name).not.toMatch(/missing-course/);
    expect(tree[0].topics[0].name).toBe('Tema sin nombre');
    expect(tree[0].topics[0].name).not.toMatch(/missing-topic/);
  });

  it('returns an empty array for an empty question list (no empty branches rendered)', () => {
    expect(buildQuestionTree([], new Map([['c1', 'X']]), new Map())).toEqual([]);
  });
});

describe('filterQuestionTree', () => {
  const courseNames = new Map([
    ['c1', 'Aritmética'],
    ['c2', 'Álgebra'],
  ]);
  const topicNames = new Map([
    ['t1', 'Fracciones'],
    ['t2', 'Porcentajes'],
    ['t3', 'Ecuaciones'],
  ]);
  const questions = [
    q({ id: 'q1', courseId: 'c1', topicId: 't1', correctAnswer: 'A' }),
    q({ id: 'q2', courseId: 'c1', topicId: 't1', correctAnswer: 'B' }),
    q({ id: 'q3', courseId: 'c1', topicId: 't2', correctAnswer: 'C' }),
    q({ id: 'q4', courseId: 'c2', topicId: 't3', correctAnswer: 'ZEBRA' }),
  ];

  it('returns the tree unchanged when the query is blank', () => {
    const tree = buildQuestionTree(questions, courseNames, topicNames);
    expect(filterQuestionTree(tree, '')).toEqual(tree);
    expect(filterQuestionTree(tree, '   ')).toEqual(tree);
  });

  it('keeps only branches matching by course name (case-insensitive), full branch included', () => {
    const tree = buildQuestionTree(questions, courseNames, topicNames);
    const filtered = filterQuestionTree(tree, 'aritm');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Aritmética');
    expect(filtered[0].topics).toHaveLength(2);
    expect(filtered[0].questionCount).toBe(3);
  });

  it('keeps only the matching topic within a course when matching by topic name', () => {
    const tree = buildQuestionTree(questions, courseNames, topicNames);
    const filtered = filterQuestionTree(tree, 'fracciones');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].topics).toHaveLength(1);
    expect(filtered[0].topics[0].name).toBe('Fracciones');
    expect(filtered[0].questionCount).toBe(2);
  });

  it('keeps only the topic containing a leaf question matching by clave', () => {
    const tree = buildQuestionTree(questions, courseNames, topicNames);
    const filtered = filterQuestionTree(tree, 'zebra');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Álgebra');
    expect(filtered[0].topics[0].questions.map((it) => it.id)).toEqual(['q4']);
  });

  it('drops branches with no match at all', () => {
    const tree = buildQuestionTree(questions, courseNames, topicNames);
    expect(filterQuestionTree(tree, 'no-existe-nada')).toEqual([]);
  });
});
