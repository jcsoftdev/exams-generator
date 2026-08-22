import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Observable, Subject, map, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { Router } from '@angular/router';
import {
  LucideAngularModule,
  Lock,
  Pencil,
  Archive,
  Trash2,
  Search,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Image,
  FileText,
  Expand,
  Minimize2,
  X,
} from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { BankListComponent } from './bank-list.component';
import { BankService } from '../bank.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { BankQuestion, BankTopicCount } from '../bank.models';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { AiService } from '../../ai/ai.service';
import { AiRevisedQuestion } from '../../ai/ai.models';

function makeQuestion(o: Partial<BankQuestion> & { id: string }): BankQuestion {
  return {
    id: o.id,
    // `??` would turn an explicit null back into 't1', and null IS the value
    // that means "central bank" — the distinction this fixture exists to make.
    tenantId: o.tenantId === undefined ? 't1' : o.tenantId,
    courseId: o.courseId ?? 'c1',
    topicId: o.topicId ?? 't1',
    difficulty: o.difficulty ?? Difficulty.Easy,
    gradeLevel: o.gradeLevel ?? 'pre',
    correctAnswer: o.correctAnswer ?? 'a',
    imageAssetId: o.imageAssetId ?? null,
    status: o.status ?? 'approved',
    type: o.type ?? 'image',
    usedInExamCount: o.usedInExamCount ?? 0,
    bodyTypst: o.bodyTypst ?? null,
    alternatives: o.alternatives ?? null,
    sourceName: o.sourceName ?? null,
    figureCode: o.figureCode ?? null,
    aiGenerated: o.aiGenerated ?? false,
  };
}

const COURSES: Course[] = [
  { id: 'c1', name: 'Aritmética', stage: 'preuniversitario' },
  { id: 'c2', name: 'Álgebra', stage: 'preuniversitario' },
];
const TOPICS_C1: Topic[] = [
  { id: 't1', name: 'Fracciones', courseId: 'c1' },
  { id: 't2', name: 'Porcentajes', courseId: 'c1' },
];
const TOPICS_C2: Topic[] = [{ id: 't3', name: 'Ecuaciones', courseId: 'c2' }];

const QUESTIONS: BankQuestion[] = [
  makeQuestion({ id: 'q1', courseId: 'c1', topicId: 't1', imageAssetId: 'asset-1' }),
  makeQuestion({
    id: 'q2',
    courseId: 'c1',
    topicId: 't1',
    difficulty: Difficulty.Medium,
    type: 'structured',
    imageAssetId: null,
  }),
  makeQuestion({ id: 'q3', courseId: 'c1', topicId: 't2', difficulty: Difficulty.Hard }),
  makeQuestion({ id: 'q4', courseId: 'c2', topicId: 't3' }),
];

/**
 * The fake bank's per-topic summary, derived from the same question array
 * the fake `listQuestionsPaged` pages through — mirroring the real backend,
 * where `GET /bank/questions/summary` and `GET /bank/questions` answer the
 * same filter set and therefore can never disagree.
 */
function countsFrom(questions: readonly BankQuestion[]): BankTopicCount[] {
  const byTopic = new Map<string, BankTopicCount>();
  for (const question of questions) {
    const existing = byTopic.get(question.topicId);
    byTopic.set(question.topicId, {
      courseId: question.courseId,
      topicId: question.topicId,
      total: (existing?.total ?? 0) + 1,
    });
  }
  return [...byTopic.values()];
}

function setup(
  over: {
    /** The fake bank's FULL contents — the summary counts and every per-topic page are both derived from it. */
    listImpl?: (...a: unknown[]) => unknown;
    getQuestionImpl?: (id: string) => unknown;
    archiveImpl?: (id: string) => unknown;
    deleteImpl?: (id: string) => unknown;
    getCoursesImpl?: () => unknown;
    getTopicsForCoursesImpl?: (courseIds: string[]) => unknown;
    reviseQuestionImpl?: (id: string, instruction: string) => unknown;
    extractQuestionFromImageImpl?: (image: File) => unknown;
    updateQuestionImpl?: (id: string, patch: unknown) => unknown;
  } = {},
) {
  const questionSource = vi.fn(over.listImpl ?? (() => of(QUESTIONS)));
  const getQuestionCounts = vi.fn((_filters?: unknown) =>
    (questionSource() as Observable<BankQuestion[]>).pipe(map(countsFrom)),
  );
  const listQuestionsPaged = vi.fn(
    (filters: { topicId?: string }, page: number, pageSize: number) =>
      (questionSource() as Observable<BankQuestion[]>).pipe(
        map((all) => {
          const inTopic = all.filter((q) => q.topicId === filters.topicId);
          return {
            items: inTopic.slice((page - 1) * pageSize, page * pageSize),
            total: inTopic.length,
          };
        }),
      ),
  );
  const getQuestion = vi.fn(over.getQuestionImpl ?? ((id: string) => of(makeQuestion({ id }))));
  const archiveQuestion = vi.fn(
    over.archiveImpl ?? ((id: string) => of({ id, status: 'archived' })),
  );
  const deleteQuestion = vi.fn(over.deleteImpl ?? (() => of(void 0)));
  const updateQuestion = vi.fn(
    over.updateQuestionImpl ?? ((id: string, _patch: unknown) => of(makeQuestion({ id }))),
  );
  const replaceQuestionImage = vi.fn((id: string, _file: File) => of({ id }));
  const buildImageAssetUrl = vi.fn((id: string) => `http://api.test/assets/${id}`);
  const fetchQuestionImage = vi.fn((id: string) =>
    of(new Blob([`b-${id}`], { type: 'image/png' })),
  );
  const getCourses = vi.fn(over.getCoursesImpl ?? (() => of(COURSES)));
  const getTopicsForCourses = vi.fn(
    over.getTopicsForCoursesImpl ??
      ((courseIds: string[]) =>
        of([...TOPICS_C1, ...TOPICS_C2].filter((t) => courseIds.includes(t.courseId)))),
  );
  const reviseQuestion = vi.fn(
    over.reviseQuestionImpl ??
      ((_id: string, _instruction: string) =>
        of({
          bodyTypst: 'Enunciado revisado por IA',
          alternatives: ['Uno revisado', 'Dos revisado'],
          correctAnswer: '1',
        } satisfies AiRevisedQuestion)),
  );
  const extractQuestionFromImage = vi.fn(
    over.extractQuestionFromImageImpl ??
      ((_image: File) =>
        of({
          bodyTypst: 'Enunciado desde imagen',
          alternatives: ['Alt A extraída', 'Alt B extraída'],
          correctAnswer: '1',
        } satisfies AiRevisedQuestion)),
  );
  const navigate = vi.fn();
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  TestBed.configureTestingModule({
    imports: [BankListComponent],
    providers: [
      importProvidersFrom(
        LucideAngularModule.pick({
          Lock,
          Pencil,
          Archive,
          Trash2,
          Search,
          ChevronLeft,
          ChevronRight,
          ChevronDown,
          Image,
          FileText,
          Expand,
          Minimize2,
          X,
        }),
      ),
      {
        provide: BankService,
        useValue: {
          getQuestionCounts,
          listQuestionsPaged,
          getQuestion,
          archiveQuestion,
          deleteQuestion,
          updateQuestion,
          replaceQuestionImage,
          buildImageAssetUrl,
          fetchQuestionImage,
        },
      },
      { provide: TaxonomyService, useValue: { getCourses, getTopicsForCourses } },
      { provide: AiService, useValue: { reviseQuestion, extractQuestionFromImage } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(BankListComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    questionSource,
    getQuestionCounts,
    listQuestionsPaged,
    getQuestion,
    archiveQuestion,
    deleteQuestion,
    updateQuestion,
    replaceQuestionImage,
    fetchQuestionImage,
    getCourses,
    getTopicsForCourses,
    reviseQuestion,
    extractQuestionFromImage,
    navigate,
  };
}

function courseHeader(compiled: HTMLElement, courseId: string): HTMLElement {
  return compiled.querySelector(
    `[data-testid="course-header"][data-course-id="${courseId}"]`,
  ) as HTMLElement;
}

function topicHeader(compiled: HTMLElement, topicId: string): HTMLElement {
  return compiled.querySelector(
    `[data-testid="topic-header"][data-topic-id="${topicId}"]`,
  ) as HTMLElement;
}

function expandCourse(
  compiled: HTMLElement,
  fixture: { detectChanges(): void },
  courseId: string,
): void {
  courseHeader(compiled, courseId).click();
  fixture.detectChanges();
}

function expandTopic(
  compiled: HTMLElement,
  fixture: { detectChanges(): void },
  topicId: string,
): void {
  topicHeader(compiled, topicId).click();
  fixture.detectChanges();
}

describe('BankListComponent', () => {
  describe('tree structure', () => {
    it("fetches every course's topics via a single batched getTopicsForCourses call, not one per course", () => {
      const { getTopicsForCourses } = setup();
      expect(getTopicsForCourses).toHaveBeenCalledTimes(1);
      expect(getTopicsForCourses).toHaveBeenCalledWith(['c1', 'c2']);
    });

    it('groups questions by course -> topic with resolved names and counts, never raw UUIDs', () => {
      const { compiled } = setup();
      const headers = compiled.querySelectorAll('[data-testid="course-header"]');
      expect(headers.length).toBe(2);
      expect(courseHeader(compiled, 'c1').textContent).toMatch(/Aritmética/);
      expect(courseHeader(compiled, 'c1').textContent).toMatch(/3/);
      expect(courseHeader(compiled, 'c2').textContent).toMatch(/Álgebra/);
      expect(compiled.textContent).not.toMatch(/\bc1\b/);
      expect(compiled.textContent).not.toMatch(/\bc2\b/);
      expect(compiled.textContent).not.toMatch(/\bt1\b/);
    });

    it('tells two same-named courses apart by their stage, and leaves unique names bare', () => {
      // Audit 2026-08-20 M2: "Comunicación" ×3 in the tree, no way to know which to open.
      const courses: Course[] = [
        { id: 'c1', name: 'Comunicación', stage: 'colegio' },
        { id: 'c2', name: 'Comunicación', stage: 'preuniversitario' },
      ];
      const { compiled } = setup({ getCoursesImpl: () => of(courses) });

      expect(courseHeader(compiled, 'c1').textContent).toMatch(/Comunicación · Colegio/);
      expect(courseHeader(compiled, 'c2').textContent).toMatch(/Comunicación · Preuniversitario/);
    });

    it('leaves a course name alone when nothing else shares it', () => {
      const { compiled } = setup();

      expect(courseHeader(compiled, 'c1').textContent).not.toMatch(/·/);
      expect(courseHeader(compiled, 'c1').textContent).toMatch(/Aritmética/);
    });

    it('renders ALL courses collapsed by default — no topics or leaves visible until a course is expanded (avoids the initial wall)', () => {
      const { compiled } = setup();
      expect(compiled.querySelectorAll('[data-testid="course-header"]').length).toBe(2);
      expect(compiled.querySelectorAll('[data-testid="topic-header"]').length).toBe(0);
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(0);
      expect(courseHeader(compiled, 'c1').getAttribute('aria-expanded')).toBe('false');
      expect(courseHeader(compiled, 'c2').getAttribute('aria-expanded')).toBe('false');
    });

    it('expanding a course reveals its topics, still collapsed — progressive disclosure', () => {
      const { compiled, fixture } = setup();
      expandCourse(compiled, fixture, 'c1');
      expect(compiled.querySelectorAll('[data-testid="topic-header"]').length).toBe(2);
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(0);
      expect(topicHeader(compiled, 't1').getAttribute('aria-expanded')).toBe('false');
    });

    it('topics are collapsed by default — no question leaves render until a topic is expanded', () => {
      const { compiled, fixture } = setup();
      expandCourse(compiled, fixture, 'c1');
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(0);
      expect(topicHeader(compiled, 't1')).toBeTruthy();
    });

    it('expanding a topic reveals its questions with clave and a difficulty tag', () => {
      const { compiled, fixture } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      const leaves = compiled.querySelectorAll('[data-testid="bank-question"]');
      expect(leaves.length).toBe(2);
      expect(leaves[0].textContent).toMatch(/Clave: a/);
      expect(leaves[0].querySelector('[data-testid="tag"]')).toBeTruthy();
    });

    it('collapsing a course hides its topics and their expanded questions', () => {
      const { compiled, fixture } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(2);

      courseHeader(compiled, 'c1').click();
      fixture.detectChanges();
      expect(topicHeader(compiled, 't1')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(0);
    });

    it('reflects expand/collapse state via aria-expanded on headers', () => {
      const { compiled, fixture } = setup();
      expect(courseHeader(compiled, 'c1').getAttribute('aria-expanded')).toBe('false');

      expandCourse(compiled, fixture, 'c1');
      expect(courseHeader(compiled, 'c1').getAttribute('aria-expanded')).toBe('true');
      expect(topicHeader(compiled, 't1').getAttribute('aria-expanded')).toBe('false');

      expandTopic(compiled, fixture, 't1');
      expect(topicHeader(compiled, 't1').getAttribute('aria-expanded')).toBe('true');
    });

    it('fetches thumbnails through an authenticated blob for a leaf question', () => {
      const { compiled, fixture, fetchQuestionImage } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      expect(fetchQuestionImage).toHaveBeenCalledWith('asset-1');
      expect(compiled.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
    });

    it('does NOT fetch thumbnails for a topic that has never been expanded (lazy-load)', () => {
      const { fetchQuestionImage } = setup();
      expect(fetchQuestionImage).not.toHaveBeenCalled();
    });

    it('loads the tree from the per-topic summary alone — not a single question row is fetched on entry', () => {
      const { getQuestionCounts, listQuestionsPaged, compiled } = setup();

      expect(getQuestionCounts).toHaveBeenCalledTimes(1);
      expect(listQuestionsPaged).not.toHaveBeenCalled();
      // …and the skeleton is complete anyway: both courses render, with their real counts.
      expect(compiled.querySelectorAll('[data-testid="course-header"]').length).toBe(2);
      expect(courseHeader(compiled, 'c1').textContent).toMatch(/3/);
    });

    it("shows a topic's real total on its header while it is still collapsed (count comes from the summary)", () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      expandCourse(compiled, fixture, 'c1');

      expect(topicHeader(compiled, 't1').textContent).toMatch(/2/);
      expect(listQuestionsPaged).not.toHaveBeenCalled();
    });

    it('expanding a course costs NO question request — only the topic list, which the summary already carries', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      expandCourse(compiled, fixture, 'c1');
      expect(listQuestionsPaged).not.toHaveBeenCalled();
    });

    it('expanding a topic fetches ONLY that topic, paginated', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');

      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
      expect(listQuestionsPaged).toHaveBeenCalledWith(
        expect.objectContaining({ topicId: 't1' }),
        1,
        expect.any(Number),
      );
    });

    it('re-expanding an already-loaded topic does NOT re-fetch it', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      expandTopic(compiled, fixture, 't1'); // collapse
      expandTopic(compiled, fixture, 't1'); // re-open

      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(2);
    });

    it('offers "Ver más" when the topic holds more than one page, and appends the next page on click', () => {
      // 3 questions in t1 with a page size of 2 forces a second page.
      const many = [
        makeQuestion({ id: 'm1', courseId: 'c1', topicId: 't1' }),
        makeQuestion({ id: 'm2', courseId: 'c1', topicId: 't1' }),
        makeQuestion({ id: 'm3', courseId: 'c1', topicId: 't1' }),
      ];
      const { compiled, fixture, listQuestionsPaged } = setup({ listImpl: () => of(many) });
      listQuestionsPaged.mockImplementation((filters: { topicId?: string }, page: number) => {
        const inTopic = many.filter((q) => q.topicId === filters.topicId);
        return of({ items: inTopic.slice((page - 1) * 2, page * 2), total: inTopic.length });
      });

      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(2);

      const loadMore = compiled.querySelector(
        '[data-testid="topic-load-more"]',
      ) as HTMLButtonElement;
      expect(loadMore.textContent).toMatch(/1/);
      loadMore.click();
      fixture.detectChanges();

      expect(listQuestionsPaged).toHaveBeenLastCalledWith(
        expect.objectContaining({ topicId: 't1' }),
        2,
        expect.any(Number),
      );
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(3);
      expect(compiled.querySelector('[data-testid="topic-load-more"]')).toBeFalsy();
    });

    it('a failed topic page shows an inline retry inside that branch, leaving the rest of the tree intact', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      listQuestionsPaged.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 500 })),
      );

      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');

      expect(compiled.querySelector('[data-testid="topic-error"]')).toBeTruthy();
      // The whole-screen error state is NOT used — the other branches still render.
      expect(compiled.querySelector('[data-testid="error-state"]')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="course-header"]').length).toBe(2);

      (compiled.querySelector('[data-testid="topic-retry"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="topic-error"]')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(2);
    });

    it('shows a neutral file-text placeholder (never blank gray) for a structured question with no image', () => {
      const { compiled, fixture } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      const leaves = compiled.querySelectorAll('[data-testid="bank-question"]');
      const structuredLeaf = leaves[1]; // q2 is type: 'structured', imageAssetId: null
      const placeholder = structuredLeaf.querySelector('[data-testid="question-placeholder"]');
      expect(placeholder).toBeTruthy();
      expect(placeholder?.getAttribute('data-icon')).toBe('file-text');
    });

    it('shows an image placeholder icon (never blank gray) for an image-type question with no thumbnail asset', () => {
      const { compiled, fixture } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't2'); // q3: type 'image', imageAssetId null
      const leaf = compiled.querySelector('[data-testid="bank-question"]');
      const placeholder = leaf?.querySelector('[data-testid="question-placeholder"]');
      expect(placeholder).toBeTruthy();
      expect(placeholder?.getAttribute('data-icon')).toBe('image');
    });

    it('previews a structured question statement in the leaf instead of only its answer key', () => {
      const structured = makeQuestion({
        id: 'qs',
        courseId: 'c1',
        topicId: 't1',
        type: 'structured',
        imageAssetId: null,
        bodyTypst: '¿Cuál es el resultado de 2 + 3 × 4?',
        alternatives: ['14', '20', '24', '10'],
      });
      const { compiled, fixture } = setup({ listImpl: () => of([structured]) });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');

      const snippet = compiled.querySelector('[data-testid="question-snippet"]');
      expect(snippet?.textContent).toContain('¿Cuál es el resultado de 2 + 3 × 4?');
    });

    it('labels an image question with where it came from, since it has no statement', () => {
      // The bank now holds ~1500 whole-question images harvested from published
      // exams. Without their provenance every one of those rows reads "Clave: c"
      // and the teacher cannot tell them apart.
      const image = makeQuestion({
        id: 'qi',
        courseId: 'c1',
        topicId: 't1',
        type: 'image',
        bodyTypst: null,
        alternatives: null,
        sourceName: 'UNCP — Examen de Admisión 2021-I, Álgebra, pregunta 4 (clave E)',
      });
      const { compiled, fixture } = setup({ listImpl: () => of([image]) });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');

      const snippet = compiled.querySelector('[data-testid="question-snippet"]');
      expect(snippet?.textContent).toContain(
        'UNCP — Examen de Admisión 2021-I, Álgebra, pregunta 4',
      );
    });

    it('shows the source of a seeded question in the detail panel', () => {
      // The central bank mixes licensing channels, so "where is this from" has
      // to be answerable from the UI, not only from the database.
      const image = makeQuestion({
        id: 'qi3',
        courseId: 'c1',
        topicId: 't1',
        type: 'image',
        bodyTypst: null,
        alternatives: null,
        tenantId: null,
        sourceName: 'UNI — Examen de Admisión 2019-1, Física, pregunta 7 (clave C)',
      });
      // The panel renders the detail fetch, not the list row.
      const { compiled, fixture } = setup({
        listImpl: () => of([image]),
        getQuestionImpl: () => of(image),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      const source = compiled.querySelector('[data-testid="panel-source"]');
      expect(source?.textContent).toContain('UNI — Examen de Admisión 2019-1, Física, pregunta 7');
    });

    it('does not repeat the answer key inside the provenance label', () => {
      // The row already prints "Clave: e" underneath; the "(clave E)" tail the
      // harvest writes into sourceName would say it twice.
      const image = makeQuestion({
        id: 'qi2',
        courseId: 'c1',
        topicId: 't1',
        type: 'image',
        bodyTypst: null,
        alternatives: null,
        sourceName: 'UNI — Examen de Admisión 2019-1, Física, pregunta 7 (clave C)',
      });
      const { compiled, fixture } = setup({ listImpl: () => of([image]) });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');

      const snippet = compiled.querySelector('[data-testid="question-snippet"]');
      expect(snippet?.textContent).not.toContain('(clave C)');
    });
  });

  describe('search filter', () => {
    function searchInput(compiled: HTMLElement): HTMLInputElement {
      return compiled.querySelector('[data-testid="tree-search"] input') as HTMLInputElement;
    }

    function typeSearch(
      compiled: HTMLElement,
      fixture: { detectChanges(): void },
      value: string,
    ): void {
      const input = searchInput(compiled);
      input.value = value;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
    }

    it('filters the tree live by course name, hiding non-matching branches', () => {
      const { compiled, fixture } = setup();
      typeSearch(compiled, fixture, 'Álgebra');
      const headers = compiled.querySelectorAll('[data-testid="course-header"]');
      expect(headers.length).toBe(1);
      expect(courseHeader(compiled, 'c2')).toBeTruthy();
      expect(courseHeader(compiled, 'c1')).toBeFalsy();
    });

    it('auto-expands matching COURSES so the matching topic is visible without a click', () => {
      const { compiled, fixture } = setup();
      typeSearch(compiled, fixture, 'fracciones');

      expect(compiled.querySelectorAll('[data-testid="course-header"]').length).toBe(1);
      expect(topicHeader(compiled, 't1')).toBeTruthy();
      expect(topicHeader(compiled, 't2')).toBeFalsy();
    });

    it('does NOT auto-expand matching TOPICS — auto-opening every match would fire one request per topic', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      typeSearch(compiled, fixture, 'fracciones');

      expect(topicHeader(compiled, 't1').getAttribute('aria-expanded')).toBe('false');
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(0);
      expect(listQuestionsPaged).not.toHaveBeenCalled();
    });

    it('does NOT match a question clave — search scope is curso/tema only now that leaves load lazily', () => {
      const { compiled, fixture } = setup();
      typeSearch(compiled, fixture, 'a'); // 'a' is every fixture question's correctAnswer
      // 'a' still substring-matches the course names ("Aritmética"/"Álgebra"), so assert on
      // a clave that matches NO name instead.
      typeSearch(compiled, fixture, 'zzz-clave');
      expect(compiled.querySelector('[data-testid="tree-no-matches"]')).toBeTruthy();
    });

    it('restores the full tree when the search box is cleared', () => {
      const { compiled, fixture } = setup();
      typeSearch(compiled, fixture, 'Álgebra');
      expect(compiled.querySelectorAll('[data-testid="course-header"]').length).toBe(1);
      typeSearch(compiled, fixture, '');
      expect(compiled.querySelectorAll('[data-testid="course-header"]').length).toBe(2);
    });
  });

  describe('expand all / collapse all', () => {
    it('expand all opens every COURSE, revealing all topic lists without a single question request', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      (compiled.querySelector('[data-testid="expand-all"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(courseHeader(compiled, 'c1').getAttribute('aria-expanded')).toBe('true');
      expect(courseHeader(compiled, 'c2').getAttribute('aria-expanded')).toBe('true');
      expect(compiled.querySelectorAll('[data-testid="topic-header"]').length).toBe(3);
      // Topics stay closed on purpose: opening all 3 here means opening all 276 in production.
      expect(topicHeader(compiled, 't1').getAttribute('aria-expanded')).toBe('false');
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(0);
      expect(listQuestionsPaged).not.toHaveBeenCalled();
    });

    it('collapse all hides every topic', () => {
      const { compiled, fixture } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="collapse-all"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(compiled.querySelectorAll('[data-testid="topic-header"]').length).toBe(0);
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(0);
    });
  });

  describe('detail panel', () => {
    it('opens the detail panel with actions when a leaf question is selected', () => {
      const { compiled, fixture, getQuestion } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="bank-panel"]')).toBeTruthy();
      expect(getQuestion).toHaveBeenCalledWith('q1');
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeFalsy();
    });

    it('shows delete (not archive) for an own draft', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, status: 'draft' })),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeFalsy();
    });

    it('renders central-bank questions read-only (lock note, no actions)', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, tenantId: null })),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="panel-readonly"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeFalsy();
    });

    it('renders the statement + lettered alternatives (correct one marked) for a structured question', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) =>
          of(
            makeQuestion({
              id,
              type: 'structured',
              imageAssetId: null,
              correctAnswer: 'b',
              bodyTypst: 'Si un tren viaja a 60 km/h, ¿cuánto recorre en 2.5 horas?',
              alternatives: ['120 km', '150 km', '180 km', '90 km'],
            }),
          ),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      const enunciado = compiled.querySelector('[data-testid="panel-enunciado"]');
      expect(enunciado?.textContent).toContain('Si un tren viaja a 60 km/h');

      const alts = compiled.querySelector('[data-testid="panel-alternatives"]');
      expect(alts?.textContent).toContain('150 km');
      const correctRow = Array.from(alts!.querySelectorAll('li')).find((li) =>
        li.textContent?.includes('150 km'),
      );
      expect(correctRow?.className).toContain('bg-easy-bg');
    });

    it('marks the correct alternative via a 0-based INDEX correctAnswer (backend/AI format), not a letter', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) =>
          of(
            makeQuestion({
              id,
              type: 'structured',
              imageAssetId: null,
              correctAnswer: '1', // index 1 -> second alternative ("150 km")
              bodyTypst: 'Si un tren viaja a 60 km/h, ¿cuánto recorre en 2.5 horas?',
              alternatives: ['120 km', '150 km', '180 km', '90 km'],
            }),
          ),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      const alts = compiled.querySelector('[data-testid="panel-alternatives"]');
      const correctRow = Array.from(alts!.querySelectorAll('li')).find((li) =>
        li.textContent?.includes('150 km'),
      );
      expect(correctRow?.className).toContain('bg-easy-bg');
      const wrongRow = Array.from(alts!.querySelectorAll('li')).find((li) =>
        li.textContent?.includes('120 km'),
      );
      expect(wrongRow?.className).not.toContain('bg-easy-bg');
    });

    it('enters edit mode from panel-edit, edits the enunciado, and saves via updateQuestion', () => {
      const { compiled, fixture, updateQuestion } = setup({
        getQuestionImpl: (id) =>
          of(
            makeQuestion({
              id,
              type: 'structured',
              imageAssetId: null,
              bodyTypst: 'Enunciado original',
              alternatives: ['Uno', 'Dos'],
            }),
          ),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const form = compiled.querySelector('[data-testid="panel-edit-form"]');
      expect(form).toBeTruthy();
      const textarea = form!.querySelector('textarea') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Enunciado original');

      textarea.value = 'Enunciado editado';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(updateQuestion).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ bodyTypst: 'Enunciado editado' }),
      );
    });

    it('normalizes a legacy LETTER correctAnswer to an INDEX before saving — the backend 400s on letters', () => {
      const { compiled, fixture, updateQuestion } = setup({
        getQuestionImpl: (id) =>
          of(
            makeQuestion({
              id,
              type: 'structured',
              imageAssetId: null,
              correctAnswer: 'a', // legacy letter format — index 0
              bodyTypst: 'Enunciado original',
              alternatives: ['Uno', 'Dos'],
            }),
          ),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      // Save WITHOUT touching the clave control — startEdit must have already normalized it to an index.
      (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(updateQuestion).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ correctAnswer: '0' }),
      );
    });

    it('surfaces the server-side Typst compile error instead of a generic message — the teacher needs to know WHAT failed in their markup', () => {
      const { compiled, fixture } = setup({
        updateQuestionImpl: () =>
          throwError(
            () =>
              new HttpErrorResponse({
                status: 400,
                error: {
                  statusCode: 400,
                  message: 'Typst compile failed: unexpected token',
                  error: 'Bad Request',
                },
              }),
          ),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const error = compiled.querySelector('[data-testid="panel-edit-form"] [role="alert"]');
      expect(error?.textContent).toContain('Typst compile failed: unexpected token');
    });

    it('shows a used-in-exams warning in edit mode for an approved question already used in exams', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, status: 'approved', usedInExamCount: 2 })),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const warning = compiled.querySelector('[data-testid="edit-warning"]');
      expect(warning).toBeTruthy();
      expect(warning?.textContent).toMatch(/2 exámenes/);
    });

    it('tags an AI-authored question of this school with the IA chip', () => {
      // The template branch behind this was dead: it compared `q.origin`, a
      // field nothing ever sent (audit 2026-08-21, M13). Origin is derived now.
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, tenantId: 't1', aiGenerated: true })),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      const panel = compiled.querySelector('[data-testid="panel-edit"]')?.closest('div');
      expect(compiled.textContent).toContain('IA');
      expect(panel).toBeTruthy();
    });

    it('cancelling edit mode discards changes and restores the read-only panel', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) =>
          of(makeQuestion({ id, type: 'structured', imageAssetId: null, bodyTypst: 'Original' })),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeTruthy();

      (compiled.querySelector('[data-testid="edit-cancel"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="panel-edit-form"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="panel-enunciado"]')?.textContent).toContain(
        'Original',
      );
    });

    it('revises with AI: fills the edit form from the mocked response without auto-saving', () => {
      const { compiled, fixture, reviseQuestion, updateQuestion } = setup({
        getQuestionImpl: (id) =>
          of(
            makeQuestion({
              id,
              type: 'structured',
              imageAssetId: null,
              correctAnswer: 'a',
              bodyTypst: 'Enunciado original',
              alternatives: ['Uno', 'Dos'],
            }),
          ),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const instructionInput = compiled.querySelector(
        '[data-testid="ai-instruction"] input',
      ) as HTMLInputElement;
      instructionInput.value = 'más difícil';
      instructionInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="ai-revise"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(reviseQuestion).toHaveBeenCalledWith('q1', 'más difícil');

      const form = compiled.querySelector('[data-testid="panel-edit-form"]');
      const textarea = form!.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Enunciado revisado por IA');
      const alternatives = form!.querySelector(
        '[data-testid="edit-alternatives"]',
      ) as HTMLTextAreaElement;
      expect(alternatives.value).toBe('Uno revisado\nDos revisado');
      // correctAnswer '1' is ALREADY a 0-based index (AiRevisedQuestion's format = the edit form's
      // canonical format) — populated directly, no letter conversion.
      expect(
        (
          fixture.componentInstance as unknown as { editCorrectAnswer: { (): string } }
        ).editCorrectAnswer(),
      ).toBe('1');

      // AI revise never auto-saves — the teacher still has to click Guardar.
      expect(updateQuestion).not.toHaveBeenCalled();

      // Clicking Guardar afterward sends the AI's index straight through — no per-save conversion.
      (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(updateQuestion).toHaveBeenCalledWith(
        'q1',
        expect.objectContaining({ correctAnswer: '1' }),
      );
    });

    it('shows ai-error when reviseQuestion fails, without touching the edit form', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) =>
          of(
            makeQuestion({
              id,
              type: 'structured',
              imageAssetId: null,
              bodyTypst: 'Enunciado original',
              alternatives: ['Uno', 'Dos'],
            }),
          ),
        reviseQuestionImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const instructionInput = compiled.querySelector(
        '[data-testid="ai-instruction"] input',
      ) as HTMLInputElement;
      instructionInput.value = 'más difícil';
      instructionInput.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="ai-error"]')).toBeFalsy();

      (compiled.querySelector('[data-testid="ai-revise"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="ai-error"]')).toBeTruthy();
      const form = compiled.querySelector('[data-testid="panel-edit-form"]');
      const textarea = form!.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Enunciado original');
    });

    it('extracts from an uploaded image: fills the edit form from the mocked OCR response', () => {
      const { compiled, fixture, extractQuestionFromImage, updateQuestion } = setup({
        getQuestionImpl: (id) =>
          of(
            makeQuestion({
              id,
              type: 'structured',
              imageAssetId: null,
              correctAnswer: 'a',
              bodyTypst: 'Enunciado original',
              alternatives: ['Uno', 'Dos'],
            }),
          ),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const file = new File(['bytes'], 'foto.png', { type: 'image/png' });
      const fileInput = compiled.querySelector('[data-testid="ocr-upload"]') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
      fileInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="ocr-run"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(extractQuestionFromImage).toHaveBeenCalledWith(file);

      const form = compiled.querySelector('[data-testid="panel-edit-form"]');
      const textarea = form!.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Enunciado desde imagen');
      const alternatives = form!.querySelector(
        '[data-testid="edit-alternatives"]',
      ) as HTMLTextAreaElement;
      expect(alternatives.value).toBe('Alt A extraída\nAlt B extraída');
      // correctAnswer '1' is ALREADY a 0-based index — populated directly, no letter conversion.
      expect(
        (
          fixture.componentInstance as unknown as { editCorrectAnswer: { (): string } }
        ).editCorrectAnswer(),
      ).toBe('1');

      // OCR extraction never auto-saves — the teacher still has to click Guardar.
      expect(updateQuestion).not.toHaveBeenCalled();
    });

    it('shows ai-error when extractQuestionFromImage fails, without touching the edit form', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) =>
          of(
            makeQuestion({
              id,
              type: 'structured',
              imageAssetId: null,
              bodyTypst: 'Enunciado original',
              alternatives: ['Uno', 'Dos'],
            }),
          ),
        extractQuestionFromImageImpl: () =>
          throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const file = new File(['bytes'], 'foto.png', { type: 'image/png' });
      const fileInput = compiled.querySelector('[data-testid="ocr-upload"]') as HTMLInputElement;
      Object.defineProperty(fileInput, 'files', { value: [file], configurable: true });
      fileInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="ai-error"]')).toBeFalsy();

      (compiled.querySelector('[data-testid="ocr-run"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="ai-error"]')).toBeTruthy();
      const form = compiled.querySelector('[data-testid="panel-edit-form"]');
      const textarea = form!.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Enunciado original');
    });

    it('edits an IMAGE question: PATCHes the LETTER correctAnswer (no bodyTypst/alternatives) and swaps the picked image', () => {
      const { compiled, fixture, updateQuestion, replaceQuestionImage } = setup({
        getQuestionImpl: (id) =>
          of(
            makeQuestion({
              id,
              type: 'image',
              imageAssetId: 'asset-1',
              correctAnswer: 'b', // image clave is a LETTER, never an index
            }),
          ),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      // No structured content controls for an image question.
      expect(compiled.querySelector('[data-testid="edit-enunciado"]')).toBeFalsy();

      const file = new File(['bytes'], 'nueva.png', { type: 'image/png' });
      const imageInput = compiled.querySelector('[data-testid="edit-image"]') as HTMLInputElement;
      Object.defineProperty(imageInput, 'files', { value: [file], configurable: true });
      imageInput.dispatchEvent(new Event('change'));
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="edit-save"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(updateQuestion).toHaveBeenCalledTimes(1);
      const patch = updateQuestion.mock.calls[0][1] as Record<string, unknown>;
      // LETTER preserved (NOT normalized to an index), and NO structured content in the payload.
      expect(patch['correctAnswer']).toBe('b');
      expect(patch['bodyTypst']).toBeUndefined();
      expect(patch['alternatives']).toBeUndefined();
      // The picked replacement image is uploaded too — the swap is not gated out.
      expect(replaceQuestionImage).toHaveBeenCalledWith('q1', file);
    });

    it('does not save when the topic is empty (curso changed but tema not re-picked)', () => {
      const { compiled, fixture, updateQuestion } = setup({
        getQuestionImpl: (id) =>
          of(
            makeQuestion({
              id,
              type: 'structured',
              imageAssetId: null,
              bodyTypst: 'Original',
              alternatives: ['Uno', 'Dos'],
            }),
          ),
      });
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      // Changing curso resets tema to '' — the user must re-pick it before saving.
      (
        fixture.componentInstance as unknown as { onEditCourseChange(v: string | null): void }
      ).onEditCourseChange('c2');
      fixture.detectChanges();

      const saveButton = compiled.querySelector(
        '[data-testid="edit-save"] button',
      ) as HTMLButtonElement;
      expect(saveButton.disabled).toBe(true);

      saveButton.click();
      fixture.detectChanges();
      expect(updateQuestion).not.toHaveBeenCalled();
    });

    it('archives the selected approved question and reloads the tree, after confirming', () => {
      const { compiled, fixture, archiveQuestion, getQuestionCounts } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      getQuestionCounts.mockClear();
      (compiled.querySelector('[data-testid="panel-archive"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(archiveQuestion).not.toHaveBeenCalled();
      (
        compiled.querySelector('[data-testid="archive-confirm-yes"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      expect(archiveQuestion).toHaveBeenCalledWith('q1');
      expect(getQuestionCounts).toHaveBeenCalledTimes(1);
    });
  });

  describe('filters', () => {
    it('re-fetches the summary with the selected nivel (difficulty) filter on Buscar', () => {
      const { fixture, getQuestionCounts } = setup();
      getQuestionCounts.mockClear();
      (
        fixture.componentInstance as unknown as { difficulty: { set(v: Difficulty): void } }
      ).difficulty.set(Difficulty.Hard);
      (fixture.componentInstance as unknown as { search(): void }).search();
      fixture.detectChanges();
      expect(getQuestionCounts).toHaveBeenCalledWith(
        expect.objectContaining({ difficulty: Difficulty.Hard }),
      );
    });

    it('discards already-loaded topic pages on Buscar — they were fetched under the OLD filters', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(2);
      listQuestionsPaged.mockClear();

      (fixture.componentInstance as unknown as { search(): void }).search();
      fixture.detectChanges();

      // Everything collapsed again, nothing stale on screen, and no page re-fetched behind the scenes.
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(0);
      expect(listQuestionsPaged).not.toHaveBeenCalled();

      // Re-opening the same topic now goes back to the server, under the new filters.
      expandCourse(compiled, fixture, 'c1');
      expandTopic(compiled, fixture, 't1');
      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
    });
  });

  describe('loading', () => {
    it('shows a loading indicator while the initial fetch is pending and no stale tree', () => {
      const subject = new Subject<BankQuestion[]>();
      const { compiled, fixture } = setup({ listImpl: () => subject.asObservable() });
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeTruthy();
      subject.next(QUESTIONS);
      subject.complete();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="course-header"]').length).toBe(2);
    });
  });

  describe('empty states', () => {
    it('shows "banco vacío" with CTA when the bank has zero questions overall', () => {
      const { compiled } = setup({ listImpl: () => of([]) });
      expect(compiled.querySelector('[data-testid="empty-bank"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/banco vacío/i);
    });

    it('shows "sin resultados" when filters match none but bank is non-empty', () => {
      const listImpl = vi.fn().mockReturnValueOnce(of(QUESTIONS)).mockReturnValueOnce(of([]));
      const { compiled, fixture } = setup({ listImpl });
      (
        fixture.componentInstance as unknown as { difficulty: { set(v: Difficulty): void } }
      ).difficulty.set(Difficulty.Hard);
      (fixture.componentInstance as unknown as { search(): void }).search();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="empty-no-results"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/sin resultados|esos filtros/i);
    });
  });

  describe('error', () => {
    it('shows an error state with retry that reloads the tree', () => {
      const { compiled, fixture, questionSource } = setup({
        listImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      expect(compiled.querySelector('[data-testid="error-state"]')).toBeTruthy();
      expect(compiled.textContent).toMatch(/no se pudieron cargar/i);
      questionSource.mockClear();
      questionSource.mockReturnValue(of(QUESTIONS));
      (compiled.querySelector('[data-testid="retry-button"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(questionSource).toHaveBeenCalledTimes(1);
      expect(compiled.querySelectorAll('[data-testid="course-header"]').length).toBe(2);
    });
  });
});
