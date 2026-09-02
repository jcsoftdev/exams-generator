import { describe, it, expect } from 'vitest';
import { Difficulty } from '@exams-generator/shared';
import { buildQuestionTree, filterQuestionTree } from './bank-question-tree';
import { BankQuestion, BankTopicCount } from '../bank.models';

function q(
  o: Partial<BankQuestion> & { id: string; courseId: string; topicId: string },
): BankQuestion {
  return {
    id: o.id,
    // `??` would turn an explicit null back into 't1', and null IS the value
    // that means "central bank" — the distinction this fixture exists to make.
    tenantId: o.tenantId === undefined ? 't1' : o.tenantId,
    courseId: o.courseId,
    topicId: o.topicId,
    difficulty: o.difficulty ?? Difficulty.Easy,
    gradeLevel: o.gradeLevel ?? 'pre',
    correctAnswer: o.correctAnswer ?? 'a',
    imageAssetId: o.imageAssetId ?? null,
    status: o.status ?? 'approved',
    type: o.type ?? 'image',
    bodyTypst: o.bodyTypst ?? null,
    alternatives: o.alternatives ?? null,
    sourceName: o.sourceName ?? null,
    figureCode: o.figureCode ?? null,
    aiGenerated: o.aiGenerated ?? false,
    usedInExamCount: o.usedInExamCount ?? 0,
  };
}

const COURSE_NAMES = new Map([
  ['c1', 'Aritmética'],
  ['c2', 'Álgebra'],
]);
const TOPIC_NAMES = new Map([
  ['t1', 'Fracciones'],
  ['t2', 'Porcentajes'],
  ['t3', 'Ecuaciones'],
]);
const COUNTS: BankTopicCount[] = [
  { courseId: 'c1', topicId: 't1', total: 2 },
  { courseId: 'c1', topicId: 't2', total: 1 },
  { courseId: 'c2', topicId: 't3', total: 1 },
];

describe('buildQuestionTree', () => {
  it('builds the whole Curso -> Tema skeleton from the summary counts alone, with no questions loaded', () => {
    const tree = buildQuestionTree(COUNTS, new Map(), COURSE_NAMES, TOPIC_NAMES);

    expect(tree).toHaveLength(2);
    const aritmetica = tree.find((c) => c.courseId === 'c1');
    expect(aritmetica?.name).toBe('Aritmética');
    expect(aritmetica?.questionCount).toBe(3);
    expect(aritmetica?.topics).toHaveLength(2);

    const fracciones = aritmetica?.topics.find((t) => t.topicId === 't1');
    expect(fracciones?.name).toBe('Fracciones');
    // The count comes from the server summary — the leaves are simply not fetched yet.
    expect(fracciones?.questionCount).toBe(2);
    expect(fracciones?.questions).toEqual([]);
    expect(fracciones?.loaded).toBe(false);
  });

  it("fills in a topic's leaves once that topic's page has been fetched, leaving its siblings untouched", () => {
    const loaded = new Map<string, readonly BankQuestion[]>([
      [
        't1',
        [
          q({ id: 'q1', courseId: 'c1', topicId: 't1' }),
          q({ id: 'q2', courseId: 'c1', topicId: 't1' }),
        ],
      ],
    ]);

    const tree = buildQuestionTree(COUNTS, loaded, COURSE_NAMES, TOPIC_NAMES);

    const aritmetica = tree.find((c) => c.courseId === 'c1');
    const fracciones = aritmetica?.topics.find((t) => t.topicId === 't1');
    expect(fracciones?.questions.map((it) => it.id)).toEqual(['q1', 'q2']);
    expect(fracciones?.loaded).toBe(true);

    const porcentajes = aritmetica?.topics.find((t) => t.topicId === 't2');
    expect(porcentajes?.questions).toEqual([]);
    expect(porcentajes?.loaded).toBe(false);
  });

  it("keeps the course/topic counts from the summary even when only part of a topic's page is loaded", () => {
    const loaded = new Map<string, readonly BankQuestion[]>([
      ['t1', [q({ id: 'q1', courseId: 'c1', topicId: 't1' })]],
    ]);

    const tree = buildQuestionTree(COUNTS, loaded, COURSE_NAMES, TOPIC_NAMES);
    const fracciones = tree
      .find((c) => c.courseId === 'c1')
      ?.topics.find((t) => t.topicId === 't1');

    // 2 in the bank, 1 page-loaded — the header must still say 2, that's how "Ver más" is discoverable.
    expect(fracciones?.questionCount).toBe(2);
    expect(fracciones?.questions).toHaveLength(1);
  });

  it('sorts courses and topics alphabetically by resolved name (never by raw id)', () => {
    const counts: BankTopicCount[] = [
      { courseId: 'c-zeta', topicId: 't-zulu', total: 1 },
      { courseId: 'c-alpha', topicId: 't-yankee', total: 1 },
      { courseId: 'c-alpha', topicId: 't-alpha', total: 1 },
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

    const tree = buildQuestionTree(counts, new Map(), courseNames, topicNames);

    expect(tree.map((c) => c.name)).toEqual(['Aritmética', 'Zoología']);
    expect(tree[0].topics.map((t) => t.name)).toEqual(['Alfabeto', 'Ya lo sé']);
  });

  it('falls back to a friendly label (never the raw UUID) when a name is unresolved', () => {
    const tree = buildQuestionTree(
      [{ courseId: 'missing-course', topicId: 'missing-topic', total: 1 }],
      new Map(),
      new Map(),
      new Map(),
    );

    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('Curso sin nombre');
    expect(tree[0].name).not.toMatch(/missing-course/);
    expect(tree[0].topics[0].name).toBe('Tema sin nombre');
    expect(tree[0].topics[0].name).not.toMatch(/missing-topic/);
  });

  it('drops zero-total buckets so an empty branch never renders', () => {
    const tree = buildQuestionTree(
      [
        { courseId: 'c1', topicId: 't1', total: 2 },
        { courseId: 'c1', topicId: 't2', total: 0 },
      ],
      new Map(),
      COURSE_NAMES,
      TOPIC_NAMES,
    );

    expect(tree[0].topics.map((t) => t.topicId)).toEqual(['t1']);
  });

  it('returns an empty array for an empty summary (no empty branches rendered)', () => {
    expect(buildQuestionTree([], new Map(), COURSE_NAMES, TOPIC_NAMES)).toEqual([]);
  });

  it("exposes a topic's gradeLevel once its questions are loaded (D2b — needed to disambiguate same-named topics)", () => {
    const loaded = new Map<string, readonly BankQuestion[]>([
      ['t1', [q({ id: 'q1', courseId: 'c1', topicId: 't1', gradeLevel: 'secundaria_5' })]],
    ]);

    const tree = buildQuestionTree(COUNTS, loaded, COURSE_NAMES, TOPIC_NAMES);
    const fracciones = tree
      .find((c) => c.courseId === 'c1')
      ?.topics.find((t) => t.topicId === 't1');

    expect(fracciones?.gradeLevel).toBe('secundaria_5');
  });

  it('leaves gradeLevel null for a topic never expanded — grade is unknown until the first page loads', () => {
    const tree = buildQuestionTree(COUNTS, new Map(), COURSE_NAMES, TOPIC_NAMES);
    const fracciones = tree
      .find((c) => c.courseId === 'c1')
      ?.topics.find((t) => t.topicId === 't1');

    expect(fracciones?.gradeLevel).toBeNull();
  });
});

describe('filterQuestionTree', () => {
  const tree = buildQuestionTree(COUNTS, new Map(), COURSE_NAMES, TOPIC_NAMES);

  it('returns the tree unchanged when the query is blank', () => {
    expect(filterQuestionTree(tree, '')).toEqual(tree);
    expect(filterQuestionTree(tree, '   ')).toEqual(tree);
  });

  it('keeps only branches matching by course name (case-insensitive), full branch included', () => {
    const filtered = filterQuestionTree(tree, 'aritm');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Aritmética');
    expect(filtered[0].topics).toHaveLength(2);
    expect(filtered[0].questionCount).toBe(3);
  });

  it('keeps only the matching topic within a course when matching by topic name', () => {
    const filtered = filterQuestionTree(tree, 'fracciones');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].topics).toHaveLength(1);
    expect(filtered[0].topics[0].name).toBe('Fracciones');
    expect(filtered[0].questionCount).toBe(2);
  });

  it('recomputes the surviving course count from the summary totals, not from the loaded leaves', () => {
    const partiallyLoaded = buildQuestionTree(
      COUNTS,
      new Map<string, readonly BankQuestion[]>([
        ['t1', [q({ id: 'q1', courseId: 'c1', topicId: 't1' })]],
      ]),
      COURSE_NAMES,
      TOPIC_NAMES,
    );

    const filtered = filterQuestionTree(partiallyLoaded, 'fracciones');

    expect(filtered[0].questionCount).toBe(2);
  });

  it('does NOT match the clave of loaded questions — search is scoped to curso/tema names only', () => {
    const loaded = buildQuestionTree(
      COUNTS,
      new Map<string, readonly BankQuestion[]>([
        ['t3', [q({ id: 'q4', courseId: 'c2', topicId: 't3', correctAnswer: 'ZEBRA' })]],
      ]),
      COURSE_NAMES,
      TOPIC_NAMES,
    );

    expect(filterQuestionTree(loaded, 'zebra')).toEqual([]);
  });

  it('drops branches with no match at all', () => {
    expect(filterQuestionTree(tree, 'no-existe-nada')).toEqual([]);
  });
});
