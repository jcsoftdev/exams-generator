import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, Observable, Subject, map, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { ActivatedRoute, ParamMap, Router, convertToParamMap } from '@angular/router';
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
  MoreHorizontal,
  X,
} from 'lucide-angular';
import {
  BankFolderNode,
  BankFolderErrorCode,
  Difficulty,
  UNFILED_FOLDER_ID,
} from '@exams-generator/shared';
import { BankListComponent } from './bank-list.component';
import { BankService } from '../bank.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { BankQuestion, BankQuestionFilters } from '../bank.models';
import { Course, Topic } from '../../taxonomy/taxonomy.models';
import { AiService } from '../../ai/ai.service';
import { AiRevisedQuestion } from '../../ai/ai.models';
import { LiveAnnouncerService } from '../../../ui/live-region/live-announcer.service';

/**
 * The tenant's folder tree, as `GET /bank/folders` sends it (DIRECT counts per
 * folder — the roll-up into `totalCount` is `toFolderTreeNodes`' job).
 * `trigo`'s 7 + 30 is where the "37 preguntas" of the removal copy comes from.
 */
const FOLDERS: BankFolderNode[] = [
  {
    id: 'colegio',
    name: 'Colegio',
    parentId: null,
    topicId: null,
    position: 0,
    ownCount: 0,
    centralCount: 0,
    children: [
      {
        id: 'trigo',
        name: 'Trigonometría',
        parentId: 'colegio',
        topicId: 't1',
        position: 0,
        ownCount: 7,
        centralCount: 30,
        children: [],
      },
    ],
  },
];

/** Mirrors `apps/api/src/modules/bank/folders/bank-folders.errors.ts` — the server sends `{ statusCode, code, message }`. */
const FOLDER_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  folder_name_invalid: 'El nombre de la carpeta debe tener entre 1 y 80 caracteres.',
  folder_name_taken: 'Ya existe una carpeta con ese nombre en el mismo nivel.',
  folder_not_found: 'La carpeta no existe.',
  folder_depth_exceeded: 'Las carpetas admiten como máximo 6 niveles.',
};

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
    // Defaults to the fixture's leaf folder rather than null: the screen lists
    // questions BY FOLDER now, so a fixture question with no folder would be
    // unreachable from the tree. `null` (unfiled) is still expressible.
    folderId: o.folderId === undefined ? 'trigo' : o.folderId,
  };
}

const COURSES: Course[] = [
  { id: 'c1', name: 'Aritmética', stage: 'preuniversitario' },
  { id: 'c2', name: 'Álgebra', stage: 'preuniversitario' },
];
const TOPICS_C1: Topic[] = [
  { id: 't1', name: 'Fracciones', courseId: 'c1', gradeLevels: [] },
  { id: 't2', name: 'Porcentajes', courseId: 'c1', gradeLevels: [] },
];
const TOPICS_C2: Topic[] = [{ id: 't3', name: 'Ecuaciones', courseId: 'c2', gradeLevels: [] }];

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
  makeQuestion({
    id: 'q3',
    courseId: 'c1',
    topicId: 't2',
    difficulty: Difficulty.Hard,
    folderId: 'colegio',
  }),
  makeQuestion({ id: 'q4', courseId: 'c2', topicId: 't3', folderId: null }),
];

/** The `:folderId` this screen is currently mounted on — reassigned by every `setup()`. */
let routeParams: BehaviorSubject<ParamMap>;

function setup(
  over: {
    /** The fake bank's FULL contents — every per-folder page is derived from it. */
    listImpl?: (...a: unknown[]) => unknown;
    getQuestionImpl?: (id: string) => unknown;
    archiveImpl?: (id: string) => unknown;
    deleteImpl?: (id: string) => unknown;
    getCoursesImpl?: () => unknown;
    getAllTopicsImpl?: () => unknown;
    getFoldersImpl?: () => unknown;
    reviseQuestionImpl?: (id: string, instruction: string) => unknown;
    extractQuestionFromImageImpl?: (image: File) => unknown;
    updateQuestionImpl?: (id: string, patch: unknown) => unknown;
    /** The `:folderId` the /app/bank/carpeta/:folderId route landed on. `null` (the default) keeps every pre-existing test on the old "nothing selected yet" entry state. */
    routeFolderId?: string | null;
    /** D1: what `router.getCurrentNavigation()?.extras.state` looks like on entry. `undefined` -> no current navigation (falls back to `history.state`). */
    getCurrentNavigationImpl?: () => unknown;
    /**
     * Overrides `listQuestionsPaged` directly instead of deriving it from
     * `listImpl`'s shared `questionSource` (audit #13/#11 — needed to delay
     * or control a SPECIFIC folder page fetch without also delaying the
     * folder tree that gates the whole screen).
     */
    listQuestionsPagedImpl?: (
      filters: BankQuestionFilters,
      page: number,
      pageSize: number,
    ) => unknown;
    /** The virtual "Sin carpeta" node's count — > 0 makes the node render. */
    unfiledCount?: number;
  } = {},
) {
  const questionSource = vi.fn(over.listImpl ?? (() => of(QUESTIONS)));
  const listQuestionsPaged = vi.fn(
    over.listQuestionsPagedImpl ??
      ((filters: BankQuestionFilters, page: number, pageSize: number) =>
        (questionSource() as Observable<BankQuestion[]>).pipe(
          map((all) => {
            const inFolder = all.filter(
              (q) => (q.folderId ?? UNFILED_FOLDER_ID) === filters.folderId,
            );
            return {
              items: inFolder.slice((page - 1) * pageSize, page * pageSize),
              total: inFolder.length,
            };
          }),
        )),
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
  const fetchQuestionThumbnail = vi.fn((id: string) =>
    of(new Blob([`t-${id}`], { type: 'image/webp' })),
  );

  // --- folder endpoints ---------------------------------------------------
  const getFolders = vi.fn(
    over.getFoldersImpl ?? (() => of({ folders: FOLDERS, unfiledCount: over.unfiledCount ?? 4 })),
  );
  /**
   * Errors the NEXT folder write must fail with, in order — one shift per
   * create/rename/delete, so a test can make exactly one write fail without
   * also breaking the reload the store fires right after it.
   */
  const folderWriteFailures: HttpErrorResponse[] = [];
  function failNextFolderWrite(o: {
    status: number;
    code: BankFolderErrorCode;
    message?: string;
  }): void {
    folderWriteFailures.push(
      new HttpErrorResponse({
        status: o.status,
        error: {
          statusCode: o.status,
          code: o.code,
          message: o.message ?? FOLDER_ERROR_MESSAGES[o.code] ?? 'Error',
        },
      }),
    );
  }
  function nextFolderWrite<T>(value: T): Observable<T> {
    const failure = folderWriteFailures.shift();
    return failure ? throwError(() => failure) : of(value);
  }

  const createdFolders: { parentId: string | null; name: string }[] = [];
  const createFolder = vi.fn((body: { name: string; parentId: string | null }) => {
    createdFolders.push({ parentId: body.parentId, name: body.name });
    return nextFolderWrite<BankFolderNode>({
      id: `created-${body.name}`,
      name: body.name,
      parentId: body.parentId,
      topicId: null,
      position: 0,
      ownCount: 0,
      centralCount: 0,
      children: [],
    });
  });
  const renamedFolders: { id: string; name: string | undefined }[] = [];
  const updateFolder = vi.fn((id: string, patch: { name?: string }) => {
    renamedFolders.push({ id, name: patch.name });
    return nextFolderWrite<BankFolderNode>({
      id,
      name: patch.name ?? 'x',
      parentId: null,
      topicId: null,
      position: 0,
      ownCount: 0,
      centralCount: 0,
      children: [],
    });
  });
  const deletedFolderIds: string[] = [];
  const deleteFolder = vi.fn((id: string) => {
    deletedFolderIds.push(id);
    return nextFolderWrite({ deletedFolders: 1, unfiledQuestions: 12 });
  });

  const getCourses = vi.fn(over.getCoursesImpl ?? (() => of(COURSES)));
  const getAllTopics = vi.fn(over.getAllTopicsImpl ?? (() => of([...TOPICS_C1, ...TOPICS_C2])));
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
  const getCurrentNavigation = vi.fn(over.getCurrentNavigationImpl ?? (() => null));
  let n = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${n++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  routeParams = new BehaviorSubject<ParamMap>(
    convertToParamMap({ folderId: over.routeFolderId ?? null }),
  );

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
          MoreHorizontal,
          X,
        }),
      ),
      {
        provide: BankService,
        useValue: {
          listQuestionsPaged,
          getQuestion,
          archiveQuestion,
          deleteQuestion,
          updateQuestion,
          replaceQuestionImage,
          buildImageAssetUrl,
          fetchQuestionImage,
          fetchQuestionThumbnail,
          getFolders,
          createFolder,
          updateFolder,
          deleteFolder,
        },
      },
      { provide: TaxonomyService, useValue: { getCourses, getAllTopics } },
      { provide: AiService, useValue: { reviseQuestion, extractQuestionFromImage } },
      { provide: Router, useValue: { navigate, getCurrentNavigation } },
      {
        provide: ActivatedRoute,
        useValue: { paramMap: routeParams.asObservable() },
      },
    ],
  });
  const fixture = TestBed.createComponent(BankListComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    questionSource,
    listQuestionsPaged,
    getQuestion,
    archiveQuestion,
    deleteQuestion,
    updateQuestion,
    replaceQuestionImage,
    fetchQuestionImage,
    fetchQuestionThumbnail,
    getFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    createdFolders,
    renamedFolders,
    deletedFolderIds,
    failNextFolderWrite,
    getCourses,
    getAllTopics,
    reviseQuestion,
    extractQuestionFromImage,
    navigate,
    getCurrentNavigation,
  };
}

/** The component's protected surface, reachable from a spec without loosening the class itself. */
type Internals = {
  difficulty: { set(value: Difficulty): void };
  editCorrectAnswer: { (): string };
  selected: { (): BankQuestion | null };
  courseOptions(): { value: string; label: string }[];
  search(): void;
  onEditCourseChange(value: string | null): void;
};

function internals(fixture: { componentInstance: unknown }): Internals {
  return fixture.componentInstance as Internals;
}

/**
 * Opening a folder is a NAVIGATION now: the grid at /app/bank owns the folders
 * and hands this screen a `:folderId`. The route stub is a subject rather than
 * a fixed `of(...)` precisely so a test can move between folders the way the
 * router does — Angular REUSES the component on a param change, which is the
 * bug this screen already paid for once.
 */
function openFolder(
  _compiled: HTMLElement,
  fixture: { detectChanges(): void },
  folderId: string,
): void {
  routeParams.next(convertToParamMap({ folderId }));
  fixture.detectChanges();
}

describe('BankListComponent', () => {
  describe('folder tree', () => {
    it('loads the tree from GET /bank/folders alone — not a single question row is fetched on entry', () => {
      const { getFolders, listQuestionsPaged } = setup();

      expect(getFolders).toHaveBeenCalledTimes(1);
      expect(listQuestionsPaged).not.toHaveBeenCalled();
    });

    it('lists the questions of the folder the route names', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      openFolder(compiled, fixture, 'colegio');

      expect(listQuestionsPaged.mock.calls.at(-1)?.[0]).toMatchObject({ folderId: 'colegio' });
    });

    /**
     * The trail is built from the folder tree, so a failed load costs the
     * breadcrumb — not the questions, which come from the route. Saying so is
     * a line, never the whole-screen error state.
     */
    it('says the folders failed to load without blanking the screen', () => {
      const { compiled } = setup({
        getFoldersImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });

      expect(compiled.querySelector('[data-testid="folders-error"]')!.textContent).toMatch(
        /No se pudieron cargar las carpetas/i,
      );
      expect(compiled.querySelector('[data-testid="error-state"]')).toBeNull();
    });
  });

  describe('folder questions', () => {
    it('lists the selected folder’s questions with clave and a difficulty tag', () => {
      const { compiled, fixture } = setup();
      openFolder(compiled, fixture, 'trigo');

      const leaves = compiled.querySelectorAll('[data-testid="bank-question"]');
      expect(leaves.length).toBe(2);
      expect(leaves[0].textContent).toMatch(/Clave: a/);
      expect(leaves[0].querySelector('[data-testid="tag"]')).toBeTruthy();
    });

    it('asks the API for exactly that folder, paginated', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      openFolder(compiled, fixture, 'trigo');

      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
      expect(listQuestionsPaged).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: 'trigo' }),
        1,
        expect.any(Number),
      );
    });

    it('lists the unfiled bucket through the "unfiled" sentinel', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      openFolder(compiled, fixture, UNFILED_FOLDER_ID);

      expect(listQuestionsPaged).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: UNFILED_FOLDER_ID }),
        1,
        expect.any(Number),
      );
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(1);
    });

    it('prompts for a folder instead of listing the whole bank when nothing is selected', () => {
      const { compiled, listQuestionsPaged } = setup();

      expect(compiled.querySelector('[data-testid="no-folder-selected"]')).toBeTruthy();
      expect(listQuestionsPaged).not.toHaveBeenCalled();
    });

    /**
     * A teacher on a school connection clicks folder A, sees nothing happen,
     * and clicks B. Whichever request the network hands back FIRST used to
     * decide what she looked at — and a global in-flight guard was worse
     * still: B's request was never sent at all, so A's rows rendered under
     * B's highlighted row with no way back except re-clicking.
     */
    it('shows the folder she landed on, not the one she left, when two selections overlap', () => {
      const pages: Record<string, Subject<{ items: BankQuestion[]; total: number }>> = {
        colegio: new Subject(),
        trigo: new Subject(),
      };
      const { compiled, fixture, listQuestionsPaged } = setup({
        listQuestionsPagedImpl: (filters) => pages[filters.folderId as string],
      });

      openFolder(compiled, fixture, 'colegio');
      openFolder(compiled, fixture, 'trigo');

      // Both folders were actually asked for — one request each, none dropped.
      expect(listQuestionsPaged).toHaveBeenCalledTimes(2);

      // The abandoned folder answers FIRST, then the current one.
      pages['colegio'].next({
        items: [makeQuestion({ id: 'stale', folderId: 'colegio' })],
        total: 1,
      });
      pages['trigo'].next({
        items: [makeQuestion({ id: 'b1' }), makeQuestion({ id: 'b2' })],
        total: 2,
      });
      fixture.detectChanges();

      const ids = Array.from(compiled.querySelectorAll('[data-testid="bank-question"]')).map(
        (row) => row.getAttribute('data-question-id'),
      );
      expect(ids).toEqual(['b1', 'b2']);
    });

    it('drops a stale answer that arrives LAST, too', () => {
      const pages: Record<string, Subject<{ items: BankQuestion[]; total: number }>> = {
        colegio: new Subject(),
        trigo: new Subject(),
      };
      const { compiled, fixture } = setup({
        listQuestionsPagedImpl: (filters) => pages[filters.folderId as string],
      });

      openFolder(compiled, fixture, 'colegio');
      openFolder(compiled, fixture, 'trigo');

      pages['trigo'].next({ items: [makeQuestion({ id: 'b1' })], total: 1 });
      pages['colegio'].next({
        items: [makeQuestion({ id: 'stale', folderId: 'colegio' })],
        total: 1,
      });
      fixture.detectChanges();

      const ids = Array.from(compiled.querySelectorAll('[data-testid="bank-question"]')).map(
        (row) => row.getAttribute('data-question-id'),
      );
      expect(ids).toEqual(['b1']);
    });

    /**
     * The leaf row asks for the THUMBNAIL, never the original. It renders one
     * per question for a page of 50, and the originals are full-resolution
     * scans — that row is where the ~3MB per opened branch came from
     * (docs/audit-2026-08-26-prod-latency.md §3.2).
     */
    it('fetches the thumbnail — not the original — through an authenticated blob for a leaf question', () => {
      const { compiled, fixture, fetchQuestionThumbnail, fetchQuestionImage } = setup();
      openFolder(compiled, fixture, 'trigo');

      expect(fetchQuestionThumbnail).toHaveBeenCalledWith('asset-1');
      expect(fetchQuestionImage).not.toHaveBeenCalled();
      expect(compiled.querySelector('img')?.getAttribute('src')).toMatch(/^blob:/);
    });

    /**
     * ...and selecting one upgrades it. The detail panel is a view a teacher
     * READS — the statement is inside the image — so it must end up on the
     * original, not the 320px stand-in it paints with first.
     */
    it('fetches the ORIGINAL once a question is selected', () => {
      const { compiled, fixture, fetchQuestionImage } = setup();
      openFolder(compiled, fixture, 'trigo');
      expect(fetchQuestionImage).not.toHaveBeenCalled();

      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      expect(fetchQuestionImage).toHaveBeenCalledWith('asset-1');
    });

    it('does NOT fetch thumbnails for a folder that has never been opened (lazy-load)', () => {
      const { fetchQuestionThumbnail } = setup();
      expect(fetchQuestionThumbnail).not.toHaveBeenCalled();
    });

    it('offers "Ver más" when the folder holds more than one page, and appends the next page on click', () => {
      const many = [
        makeQuestion({ id: 'm1' }),
        makeQuestion({ id: 'm2' }),
        makeQuestion({ id: 'm3' }),
      ];
      const { compiled, fixture, listQuestionsPaged } = setup({ listImpl: () => of(many) });
      listQuestionsPaged.mockImplementation((_filters: BankQuestionFilters, page: number) =>
        of({ items: many.slice((page - 1) * 2, page * 2), total: many.length }),
      );

      openFolder(compiled, fixture, 'trigo');
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(2);

      const loadMore = compiled.querySelector(
        '[data-testid="folder-load-more"]',
      ) as HTMLButtonElement;
      expect(loadMore.textContent).toMatch(/1/);
      loadMore.click();
      fixture.detectChanges();

      expect(listQuestionsPaged).toHaveBeenLastCalledWith(
        expect.objectContaining({ folderId: 'trigo' }),
        2,
        expect.any(Number),
      );
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(3);
      expect(compiled.querySelector('[data-testid="folder-load-more"]')).toBeFalsy();
    });

    it('a failed page shows an inline retry, leaving the rest of the screen intact', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      listQuestionsPaged.mockReturnValueOnce(
        throwError(() => new HttpErrorResponse({ status: 500 })),
      );

      openFolder(compiled, fixture, 'trigo');

      expect(compiled.querySelector('[data-testid="folder-questions-error"]')).toBeTruthy();
      // The whole-screen error state is NOT used — the trail still renders.
      expect(compiled.querySelector('[data-testid="error-state"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="breadcrumb-crumb"]')).toBeTruthy();

      (
        compiled.querySelector('[data-testid="folder-questions-retry"]') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="folder-questions-error"]')).toBeFalsy();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(2);
    });

    it('shows a neutral file-text placeholder (never blank gray) for a structured question with no image', () => {
      const { compiled, fixture } = setup();
      openFolder(compiled, fixture, 'trigo');
      const leaves = compiled.querySelectorAll('[data-testid="bank-question"]');
      const structuredLeaf = leaves[1]; // q2 is type: 'structured', imageAssetId: null
      const placeholder = structuredLeaf.querySelector('[data-testid="question-placeholder"]');
      expect(placeholder).toBeTruthy();
      expect(placeholder?.getAttribute('data-icon')).toBe('file-text');
    });

    it('shows an image placeholder icon (never blank gray) for an image-type question with no thumbnail asset', () => {
      const { compiled, fixture } = setup();
      openFolder(compiled, fixture, 'colegio'); // q3: type 'image', imageAssetId null
      const leaf = compiled.querySelector('[data-testid="bank-question"]');
      const placeholder = leaf?.querySelector('[data-testid="question-placeholder"]');
      expect(placeholder).toBeTruthy();
      expect(placeholder?.getAttribute('data-icon')).toBe('image');
    });

    it('previews a structured question statement in the leaf instead of only its answer key', () => {
      const structured = makeQuestion({
        id: 'qs',
        type: 'structured',
        imageAssetId: null,
        bodyTypst: '¿Cuál es el resultado de 2 + 3 × 4?',
        alternatives: ['14', '20', '24', '10'],
      });
      const { compiled, fixture } = setup({ listImpl: () => of([structured]) });
      openFolder(compiled, fixture, 'trigo');

      const snippet = compiled.querySelector('[data-testid="question-snippet"]');
      expect(snippet?.textContent).toContain('¿Cuál es el resultado de 2 + 3 × 4?');
    });

    // audit bank-list #14: the "Pregunta con imagen" fallback used to fire
    // for ANY leaf with no statement/no source, image question or not — a
    // structured question with a genuinely empty body would get the same
    // "it has an image" copy despite never having one.
    it('never shows "Pregunta con imagen" for a structured question with an empty body — falls back to the answer key instead (audit #14)', () => {
      const structuredBlank = makeQuestion({
        id: 'qs-blank',
        type: 'structured',
        imageAssetId: null,
        bodyTypst: null,
        alternatives: null,
        sourceName: null,
      });
      const { compiled, fixture } = setup({ listImpl: () => of([structuredBlank]) });
      openFolder(compiled, fixture, 'trigo');

      expect(compiled.querySelector('[data-testid="question-snippet"]')).toBeFalsy();
      const row = compiled.querySelector('[data-question-id="qs-blank"]');
      expect(row?.textContent).not.toContain('Pregunta con imagen');
      expect(row?.textContent).toContain('Clave:');
    });

    it('shows a neutral "Pregunta con imagen" fallback when a leaf has no statement AND no sourceName (D2a — a web-created image question)', () => {
      const image = makeQuestion({
        id: 'qi-blank',
        type: 'image',
        bodyTypst: null,
        alternatives: null,
        sourceName: null,
      });
      const { compiled, fixture } = setup({ listImpl: () => of([image]) });
      openFolder(compiled, fixture, 'trigo');

      const snippet = compiled.querySelector('[data-testid="question-snippet"]');
      expect(snippet?.textContent).toContain('Pregunta con imagen');
    });

    it('strips the file extension off sourceName before showing it as the snippet (D2a)', () => {
      const image = makeQuestion({
        id: 'qi-ext',
        type: 'image',
        bodyTypst: null,
        alternatives: null,
        sourceName: '1d.PNG',
      });
      const { compiled, fixture } = setup({ listImpl: () => of([image]) });
      openFolder(compiled, fixture, 'trigo');

      const snippet = compiled.querySelector('[data-testid="question-snippet"]');
      expect(snippet?.textContent?.trim()).toBe('1d');
    });

    it('labels an image question with where it came from, since it has no statement', () => {
      // The bank now holds ~1500 whole-question images harvested from published
      // exams. Without their provenance every one of those rows reads "Clave: c"
      // and the teacher cannot tell them apart.
      const image = makeQuestion({
        id: 'qi',
        type: 'image',
        bodyTypst: null,
        alternatives: null,
        sourceName: 'UNCP — Examen de Admisión 2021-I, Álgebra, pregunta 4 (clave E)',
      });
      const { compiled, fixture } = setup({ listImpl: () => of([image]) });
      openFolder(compiled, fixture, 'trigo');

      const snippet = compiled.querySelector('[data-testid="question-snippet"]');
      expect(snippet?.textContent).toContain(
        'UNCP — Examen de Admisión 2021-I, Álgebra, pregunta 4',
      );
    });

    it('does not repeat the answer key inside the provenance label', () => {
      // The row already prints "Clave: e" underneath; the "(clave E)" tail the
      // harvest writes into sourceName would say it twice.
      const image = makeQuestion({
        id: 'qi2',
        type: 'image',
        bodyTypst: null,
        alternatives: null,
        sourceName: 'UNI — Examen de Admisión 2019-1, Física, pregunta 7 (clave C)',
      });
      const { compiled, fixture } = setup({ listImpl: () => of([image]) });
      openFolder(compiled, fixture, 'trigo');

      const snippet = compiled.querySelector('[data-testid="question-snippet"]');
      expect(snippet?.textContent).not.toContain('(clave C)');
    });
  });

  describe('taxonomy', () => {
    it('fetches the whole topic catalog in ONE request, not one per course', () => {
      const { getAllTopics } = setup();
      expect(getAllTopics).toHaveBeenCalledTimes(1);
    });

    /**
     * The ordering, not just the count. Topics used to be fetched by handing
     * `getCourses()`'s ids back as a filter, which made the second request wait
     * on the first for a result that excluded nothing — a wasted round-trip
     * against an origin ~620ms away (docs/audit-2026-08-26-prod-latency.md §2).
     */
    it('does not wait for the courses response before asking for topics', () => {
      const courses = new Subject<Course[]>();
      const { getAllTopics } = setup({ getCoursesImpl: () => courses.asObservable() });

      expect(getAllTopics).toHaveBeenCalledTimes(1);

      courses.next(COURSES);
      courses.complete();
    });

    /**
     * Audit 2026-08-20 M2: "Comunicación" ×3 with no way to tell them apart.
     * The tree no longer shows courses at all, but the edit form's curso
     * select still does — so the stage suffix has to survive there.
     */
    it('tells two same-named courses apart by their stage in the edit form’s curso options', () => {
      const courses: Course[] = [
        { id: 'c1', name: 'Comunicación', stage: 'colegio' },
        { id: 'c2', name: 'Comunicación', stage: 'preuniversitario' },
      ];
      const { fixture } = setup({ getCoursesImpl: () => of(courses) });

      expect(internals(fixture).courseOptions()).toEqual([
        { value: 'c1', label: 'Comunicación · Colegio' },
        { value: 'c2', label: 'Comunicación · Preuniversitario' },
      ]);
    });

    it('leaves a course name alone when nothing else shares it', () => {
      const { fixture } = setup();
      expect(internals(fixture).courseOptions()).toEqual([
        { value: 'c1', label: 'Aritmética' },
        { value: 'c2', label: 'Álgebra' },
      ]);
    });
  });

  describe('detail panel', () => {
    it('opens the detail panel with actions when a leaf question is selected', () => {
      const { compiled, fixture, getQuestion } = setup();
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="panel-delete"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="panel-archive"]')).toBeFalsy();
    });

    it('renders central-bank questions read-only (lock note, no actions)', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, tenantId: null })),
      });
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const warning = compiled.querySelector('[data-testid="edit-warning"]');
      expect(warning).toBeTruthy();
      expect(warning?.textContent).toMatch(/2 exámenes/);
    });

    it('dice "1 examen" en singular, en el detalle y en el aviso de edición', () => {
      // Con el conteo clavado en 0 nadie veía el plural mal; en cuanto llegó el
      // número real aparecieron dos "1 exámenes" (audit M13).
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) =>
          of(makeQuestion({ id, tenantId: 't1', status: 'approved', usedInExamCount: 1 })),
      });
      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      expect(compiled.textContent).toContain('1 examen');
      expect(compiled.textContent).not.toContain('1 exámenes');

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      const warning = compiled.querySelector('[data-testid="edit-warning"]');
      expect(warning!.textContent).toContain('1 examen');
      expect(warning!.textContent).not.toContain('1 exámenes');
    });

    it('tags an AI-authored question of this school with the IA chip', () => {
      // The template branch behind this was dead: it compared `q.origin`, a
      // field nothing ever sent (audit 2026-08-21, M13). Origin is derived now.
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, tenantId: 't1', aiGenerated: true })),
      });
      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      const panel = compiled.querySelector('[data-testid="panel-edit"]')?.closest('div');
      expect(compiled.textContent).toContain('IA');
      expect(panel).toBeTruthy();
    });

    it('shows the source of a seeded question in the detail panel', () => {
      // The central bank mixes licensing channels, so "where is this from" has
      // to be answerable from the UI, not only from the database.
      const image = makeQuestion({
        id: 'qi3',
        type: 'image',
        bodyTypst: null,
        alternatives: null,
        tenantId: null,
        sourceName: 'UNI — Examen de Admisión 2019-1, Física, pregunta 7 (clave C)',
      });
      const { compiled, fixture } = setup({
        listImpl: () => of([image]),
        getQuestionImpl: () => of(image),
      });
      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      const source = compiled.querySelector('[data-testid="panel-source"]');
      expect(source?.textContent).toContain('UNI — Examen de Admisión 2019-1, Física, pregunta 7');
    });

    it('cancelling edit mode discards changes and restores the read-only panel', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) =>
          of(makeQuestion({ id, type: 'structured', imageAssetId: null, bodyTypst: 'Original' })),
      });
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
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
      expect(internals(fixture).editCorrectAnswer()).toBe('1');

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
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
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
      expect(internals(fixture).editCorrectAnswer()).toBe('1');

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
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
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
      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      (compiled.querySelector('[data-testid="panel-edit"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      // Changing curso resets tema to '' — the user must re-pick it before saving.
      internals(fixture).onEditCourseChange('c2');
      fixture.detectChanges();

      const saveButton = compiled.querySelector(
        '[data-testid="edit-save"] button',
      ) as HTMLButtonElement;
      expect(saveButton.disabled).toBe(true);

      saveButton.click();
      fixture.detectChanges();
      expect(updateQuestion).not.toHaveBeenCalled();
    });

    it('archives the selected approved question, then re-lists the folder and refreshes its counts', () => {
      const { compiled, fixture, archiveQuestion, listQuestionsPaged, getFolders } = setup();
      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      listQuestionsPaged.mockClear();
      getFolders.mockClear();

      (compiled.querySelector('[data-testid="panel-archive"] button') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(archiveQuestion).not.toHaveBeenCalled();

      (
        compiled.querySelector('[data-testid="archive-confirm-yes"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(archiveQuestion).toHaveBeenCalledWith('q1');
      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
      expect(getFolders).toHaveBeenCalledTimes(1);
    });
  });

  describe('filters', () => {
    it('re-lists the selected folder with the nivel (difficulty) filter on Buscar', () => {
      const { compiled, fixture, listQuestionsPaged } = setup();
      openFolder(compiled, fixture, 'trigo');
      listQuestionsPaged.mockClear();

      internals(fixture).difficulty.set(Difficulty.Hard);
      internals(fixture).search();
      fixture.detectChanges();

      expect(listQuestionsPaged).toHaveBeenCalledWith(
        expect.objectContaining({ difficulty: Difficulty.Hard, folderId: 'trigo' }),
        1,
        expect.any(Number),
      );
    });

    it('starts over from page 1 on Buscar — the loaded pages came from the OLD filters', () => {
      const many = [
        makeQuestion({ id: 'm1' }),
        makeQuestion({ id: 'm2' }),
        makeQuestion({ id: 'm3' }),
      ];
      const { compiled, fixture, listQuestionsPaged } = setup({ listImpl: () => of(many) });
      listQuestionsPaged.mockImplementation((_filters: BankQuestionFilters, page: number) =>
        of({ items: many.slice((page - 1) * 2, page * 2), total: many.length }),
      );

      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-testid="folder-load-more"]') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(3);

      internals(fixture).search();
      fixture.detectChanges();

      expect(listQuestionsPaged).toHaveBeenLastCalledWith(
        expect.objectContaining({ folderId: 'trigo' }),
        1,
        expect.any(Number),
      );
      expect(compiled.querySelectorAll('[data-testid="bank-question"]').length).toBe(2);
    });

    it('is a no-op with no folder selected — an unscoped list over the 64k central bank is what this screen exists to avoid', () => {
      const { fixture, listQuestionsPaged } = setup();
      internals(fixture).search();
      fixture.detectChanges();

      expect(listQuestionsPaged).not.toHaveBeenCalled();
    });

    /** …and the button says so, instead of being a control that silently does nothing. */
    it('disables Buscar until a folder is selected', () => {
      const { compiled, fixture } = setup();
      const buscar = () =>
        compiled.querySelector('[data-testid="bank-search"] button') as HTMLButtonElement;

      expect(buscar().disabled).toBe(true);

      openFolder(compiled, fixture, 'trigo');
      expect(buscar().disabled).toBe(false);
    });
  });

  describe('loading', () => {
    it('shows a loading indicator while the initial taxonomy fetch is pending, and no stale list', () => {
      const courses = new Subject<Course[]>();
      const { compiled, fixture } = setup({ getCoursesImpl: () => courses.asObservable() });
      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="folder-questions"]')).toBeFalsy();

      courses.next(COURSES);
      courses.complete();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="folder-questions"]')).toBeTruthy();
    });
  });

  describe('empty states', () => {
    it('says a folder is empty rather than leaving the list silently blank', () => {
      const { compiled, fixture } = setup({ listImpl: () => of([]) });
      openFolder(compiled, fixture, 'trigo');

      expect(compiled.querySelector('[data-testid="folder-empty"]')).toBeTruthy();
    });
  });

  describe('error', () => {
    it('shows an error state with retry that reloads the screen', () => {
      const { compiled, fixture, getCourses } = setup({
        getCoursesImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      expect(compiled.querySelector('[data-testid="error-state"]')).toBeTruthy();
      // Names what actually failed: this branch is now the TAXONOMY fetch (the
      // edit form's cursos/temas), never the question list.
      expect(compiled.querySelector('[data-testid="error-state"]')!.textContent).toMatch(
        /no se pudo cargar el banco/i,
      );

      getCourses.mockReturnValue(of(COURSES));
      (compiled.querySelector('[data-testid="retry-button"] button') as HTMLButtonElement).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="error-state"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="folder-questions"]')).toBeTruthy();
    });
  });

  describe('created question banner (D1)', () => {
    it('reveals the question just created: selects its folder, opens it, and shows a dismissible banner', () => {
      const { compiled, fixture, getQuestion, listQuestionsPaged } = setup({
        getCurrentNavigationImpl: () => ({ extras: { state: { createdQuestionId: 'q1' } } }),
        getQuestionImpl: (id) => of(makeQuestion({ id, folderId: 'trigo' })),
      });
      fixture.detectChanges();

      expect(getQuestion).toHaveBeenCalledWith('q1');
      // audit #12: `select()` used to re-fetch the very same question a
      // second time even though `revealCreatedQuestion` already had the
      // full record in hand.
      expect(getQuestion).toHaveBeenCalledTimes(1);
      expect(listQuestionsPaged).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: 'trigo' }),
        1,
        expect.any(Number),
      );
      expect(compiled.querySelector('[data-testid="bank-panel"]')).toBeTruthy();

      const banner = compiled.querySelector('[data-testid="created-banner"]');
      expect(banner?.textContent).toContain('Pregunta guardada.');

      const row = compiled.querySelector('[data-question-id="q1"]');
      expect(row?.getAttribute('data-highlight')).toBe('true');
    });

    it('reveals an unfiled question through the "Sin carpeta" bucket', () => {
      const { listQuestionsPaged } = setup({
        getCurrentNavigationImpl: () => ({ extras: { state: { createdQuestionId: 'q4' } } }),
        getQuestionImpl: (id) => of(makeQuestion({ id, folderId: null })),
      });

      expect(listQuestionsPaged).toHaveBeenCalledWith(
        expect.objectContaining({ folderId: UNFILED_FOLDER_ID }),
        1,
        expect.any(Number),
      );
    });

    it('falls back to history.state when there is no current Angular navigation', () => {
      history.replaceState({ createdQuestionId: 'q1' }, '');
      try {
        const { compiled } = setup({
          getCurrentNavigationImpl: () => null,
          getQuestionImpl: (id) => of(makeQuestion({ id, folderId: 'trigo' })),
        });

        expect(compiled.querySelector('[data-testid="created-banner"]')).toBeTruthy();
        expect(compiled.querySelector('[data-question-id="q1"]')).toBeTruthy();
      } finally {
        history.replaceState(null, '');
      }
    });

    it('dismisses the banner on click, without touching the highlighted row', () => {
      const { compiled, fixture } = setup({
        getCurrentNavigationImpl: () => ({ extras: { state: { createdQuestionId: 'q1' } } }),
        getQuestionImpl: (id) => of(makeQuestion({ id, folderId: 'trigo' })),
      });

      (
        compiled.querySelector('[data-testid="created-banner-dismiss"]') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="created-banner"]')).toBeFalsy();
    });

    it('clears the row highlight after 4s (fake timers)', () => {
      vi.useFakeTimers();
      try {
        const { compiled, fixture } = setup({
          getCurrentNavigationImpl: () => ({ extras: { state: { createdQuestionId: 'q1' } } }),
          getQuestionImpl: (id) => of(makeQuestion({ id, folderId: 'trigo' })),
        });
        fixture.detectChanges();

        expect(
          compiled.querySelector('[data-question-id="q1"]')?.getAttribute('data-highlight'),
        ).toBe('true');

        vi.advanceTimersByTime(4000);
        fixture.detectChanges();

        expect(
          compiled.querySelector('[data-question-id="q1"]')?.getAttribute('data-highlight'),
        ).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    it('shows neither the banner nor any highlight when there is no created-question state', () => {
      const { compiled } = setup();
      expect(compiled.querySelector('[data-testid="created-banner"]')).toBeFalsy();
      expect(compiled.querySelector('[data-highlight="true"]')).toBeFalsy();
    });

    // audit #13: the highlight's 4s clear-timer used to start the instant
    // `revealCreatedQuestion` ran, BEFORE the folder's page (and so the row)
    // had actually loaded — on a slow fetch, part or all of the window could
    // burn before the teacher ever saw the highlight. It must instead start
    // once the page has resolved.
    it('starts the 4s highlight window only once the folder page resolves, not the instant the question is fetched (audit #13)', () => {
      vi.useFakeTimers();
      try {
        const folderPage = new Subject<{ items: BankQuestion[]; total: number }>();
        const { compiled, fixture } = setup({
          getCurrentNavigationImpl: () => ({ extras: { state: { createdQuestionId: 'q1' } } }),
          getQuestionImpl: (id) => of(makeQuestion({ id, folderId: 'trigo' })),
          // The folder tree resolves synchronously — only THIS folder's own
          // page fetch is held open, so the tree exists but the row does not.
          listQuestionsPagedImpl: () => folderPage,
        });
        fixture.detectChanges();

        expect(compiled.querySelector('[data-question-id="q1"]')).toBeNull();

        // Advancing the clock before the page ever resolves must NOT clear
        // anything — with the bug, the timer would already be running.
        vi.advanceTimersByTime(4000);
        fixture.detectChanges();

        folderPage.next({ items: [makeQuestion({ id: 'q1', folderId: 'trigo' })], total: 1 });
        folderPage.complete();
        fixture.detectChanges();

        expect(
          compiled.querySelector('[data-question-id="q1"]')?.getAttribute('data-highlight'),
        ).toBe('true');

        vi.advanceTimersByTime(4000);
        fixture.detectChanges();
        expect(
          compiled.querySelector('[data-question-id="q1"]')?.getAttribute('data-highlight'),
        ).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    // audit #11: both `setTimeout`s `revealCreatedQuestion` schedules must
    // be cleared if the component is destroyed before they fire — otherwise
    // a fast navigation away leaves a stray timer trying to mutate a
    // destroyed component's signals.
    it('clears its highlight-clear timer on destroy — the exact handle setTimeout(4000) returned reaches clearTimeout (audit #11)', () => {
      const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
      const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

      const { fixture } = setup({
        getCurrentNavigationImpl: () => ({ extras: { state: { createdQuestionId: 'q1' } } }),
        getQuestionImpl: (id) => of(makeQuestion({ id, folderId: 'trigo' })),
      });
      fixture.detectChanges();

      const highlightCallIndex = setTimeoutSpy.mock.calls.findIndex((call) => call[1] === 4000);
      expect(highlightCallIndex).toBeGreaterThanOrEqual(0);
      const highlightHandle = setTimeoutSpy.mock.results[highlightCallIndex].value;

      fixture.destroy();

      expect(clearTimeoutSpy).toHaveBeenCalledWith(highlightHandle);

      setTimeoutSpy.mockRestore();
      clearTimeoutSpy.mockRestore();
    });

    // audit bank-list #10: `history.state` (unlike Angular's one-shot
    // navigation extras) survives a reload / back-forward navigation to the
    // same entry — so leaving `createdQuestionId` in it meant the SAME
    // question got revealed again on every future visit to this history
    // entry, not just the one right after saving it.
    it('consumes createdQuestionId from history.state — a second component built against the same entry does not reveal it again (audit #10)', () => {
      history.replaceState({ createdQuestionId: 'q1' }, '');
      try {
        const first = setup({
          getCurrentNavigationImpl: () => null,
          getQuestionImpl: (id) => of(makeQuestion({ id, folderId: 'trigo' })),
        });
        expect(first.compiled.querySelector('[data-testid="created-banner"]')).toBeTruthy();

        TestBed.resetTestingModule();
        const second = setup({
          getCurrentNavigationImpl: () => null,
          getQuestionImpl: (id) => of(makeQuestion({ id, folderId: 'trigo' })),
        });
        expect(second.compiled.querySelector('[data-testid="created-banner"]')).toBeFalsy();
      } finally {
        history.replaceState(null, '');
      }
    });
  });

  describe('accessibility (D3)', () => {
    // `ui-live-region` itself moved to the app shell at integration (mounted
    // once app-wide instead of once per bank-list instance) — this component
    // no longer renders a sink locally, it only calls the root-provided
    // `LiveAnnouncerService.announce()`. Assert against the service's own
    // signals rather than a local DOM node.
    it('announces "Pregunta guardada." through the root LiveAnnouncerService when the created-question banner shows', () => {
      setup({
        getCurrentNavigationImpl: () => ({ extras: { state: { createdQuestionId: 'q1' } } }),
        getQuestionImpl: (id) => of(makeQuestion({ id, folderId: 'trigo' })),
      });

      const announcer = TestBed.inject(LiveAnnouncerService);
      expect(announcer.message()).toBe('Pregunta guardada.');
      expect(announcer.politeness()).toBe('polite');
    });
  });

  /**
   * `app-question-folder-picker` owns its own popover mechanics — those are
   * covered end-to-end in `question-folder-picker.component.spec.ts`. What
   * belongs here is the INTEGRATION contract: bank-list gates the field on
   * `isCentral`, and reacts to the child's `moved` output.
   */
  describe('question folder picker (integration)', () => {
    it('hides the entire "Carpeta" field for a CENTRAL question — not just the trigger', () => {
      const { compiled, fixture } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, tenantId: null, folderId: null })),
      });
      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="question-folder"]')).toBeNull();
    });

    it('applies `moved` to `selected` and refreshes the tree + open folder when it matches the selection', () => {
      const { compiled, fixture, listQuestionsPaged, getFolders, updateQuestion } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, tenantId: 't1', folderId: null })),
        updateQuestionImpl: (id, patch) =>
          of(
            makeQuestion({
              id: id as string,
              tenantId: 't1',
              folderId: (patch as { folderId: string | null }).folderId,
            }),
          ),
      });
      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-testid="bank-question"]') as HTMLElement).click();
      fixture.detectChanges();
      listQuestionsPaged.mockClear();
      getFolders.mockClear();

      (
        compiled.querySelector('[data-testid="question-folder-edit"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        compiled.querySelector(
          '[data-testid="question-folder-picker"] [data-folder-id="colegio"]',
        ) as HTMLElement
      ).click();
      fixture.detectChanges();
      (
        compiled.querySelector('[data-testid="question-folder-save"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      expect(updateQuestion).toHaveBeenCalledWith('q1', { folderId: 'colegio' });
      expect(internals(fixture).selected()?.folderId).toBe('colegio');
      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
      expect(getFolders).toHaveBeenCalledTimes(1);
    });

    /**
     * The race this whole fix round exists for: a slow PATCH response for
     * question A must not land on question B just because the teacher picked
     * a different row while it was in flight. Both A and B start in 'trigo'
     * (the fixture default) so a bug that applies A's response to `selected`
     * regardless of id is distinguishable from correct behavior — A's response
     * moves it to 'colegio', a folder B was never in.
     */
    it('ignores a stale `moved` for a question no longer selected, but still reloads the tree + folder', () => {
      const pending = new Subject<BankQuestion>();
      const { compiled, fixture, getFolders, listQuestionsPaged } = setup({
        getQuestionImpl: (id) => of(makeQuestion({ id, tenantId: 't1', folderId: 'trigo' })),
        updateQuestionImpl: () => pending,
      });
      openFolder(compiled, fixture, 'trigo');
      (compiled.querySelector('[data-question-id="q1"]') as HTMLElement).click();
      fixture.detectChanges();

      (
        compiled.querySelector('[data-testid="question-folder-edit"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();
      (
        compiled.querySelector(
          '[data-testid="question-folder-picker"] [data-folder-id="colegio"]',
        ) as HTMLElement
      ).click();
      fixture.detectChanges();
      (
        compiled.querySelector('[data-testid="question-folder-save"] button') as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      // the teacher picks question B (q2) while A's (q1's) save is still pending
      (compiled.querySelector('[data-question-id="q2"]') as HTMLElement).click();
      fixture.detectChanges();
      expect(compiled.querySelector('[data-testid="question-folder-picker"]')).toBeNull();

      getFolders.mockClear();
      listQuestionsPaged.mockClear();
      pending.next(makeQuestion({ id: 'q1', tenantId: 't1', folderId: 'colegio' }));
      pending.complete();
      fixture.detectChanges();

      expect(internals(fixture).selected()?.id).toBe('q2');
      expect(compiled.querySelector('[data-testid="question-folder"]')!.textContent).toContain(
        'Trigonometría',
      );
      expect(compiled.querySelector('[data-testid="question-folder-picker"]')).toBeNull();
      expect(getFolders).toHaveBeenCalledTimes(1);
      expect(listQuestionsPaged).toHaveBeenCalledTimes(1);
    });
  });
  /**
   * The bank landing is the folder grid now; this screen is reached at
   * /app/bank/carpeta/:folderId, already scoped. Waiting for a click that the
   * teacher already made one screen earlier would show her an empty prompt
   * over the folder she just opened.
   */
  describe('opened from the folder route', () => {
    it('loads the folder in the url without waiting for a click on the tree', () => {
      const { compiled } = setup({ routeFolderId: 'trigo' });

      expect(compiled.querySelector('[data-testid="no-folder-selected"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="folder-questions"]')).toBeTruthy();
    });

    it('shows the trail back to the grid, ending on the open folder', () => {
      const { compiled } = setup({ routeFolderId: 'trigo' });

      const crumbs = Array.from(compiled.querySelectorAll('[data-testid="breadcrumb-crumb"]')).map(
        (crumb) => crumb.textContent?.trim(),
      );
      expect(crumbs[0]).toBe('Mi banco');
      expect(crumbs[crumbs.length - 1]).toContain('Trigonometría');
    });

    it('still shows the prompt when no folder is named in the url', () => {
      const { compiled } = setup();

      expect(compiled.querySelector('[data-testid="no-folder-selected"]')).toBeTruthy();
    });
  });
});
