import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { BankFolderNode, BankFoldersResponse, UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { BankService } from '../bank.service';
import { TaxonomyService } from '../../taxonomy/taxonomy.service';
import { Topic } from '../../taxonomy/taxonomy.models';
import { BankBrowserComponent } from './bank-browser.component';

@Component({ selector: 'app-list-stub', standalone: true, template: 'lista' })
class ListStubComponent {}

function folder(
  id: string,
  name: string,
  children: BankFolderNode[] = [],
  counts: { own?: number; central?: number; topicId?: string } = {},
): BankFolderNode {
  return {
    id,
    name,
    parentId: null,
    topicId: counts.topicId ?? null,
    position: 0,
    ownCount: counts.own ?? 0,
    centralCount: counts.central ?? 0,
    children,
  };
}

const FOLDERS: BankFolderNode[] = [
  folder('colegio', 'Colegio', [
    folder(
      'mate',
      'Matemática',
      [folder('cuad', 'Ecuaciones cuadráticas', [], { own: 18, topicId: 't-cuad' })],
      { own: 142, central: 1208, topicId: 't-mate' },
    ),
  ]),
  folder('preuni', 'Preuniversitario'),
];

/** The catalog behind the grade chips: a folder has no grade, its TOPIC does. */
const TOPICS: Topic[] = [
  { id: 't-mate', name: 'Números', courseId: 'c1', gradeLevels: ['primaria_5'] },
  { id: 't-cuad', name: 'Ecuaciones', courseId: 'c1', gradeLevels: ['secundaria_4'] },
];

async function setup(
  url = '/app/bank',
  over: {
    getFoldersImpl?: () => ReturnType<BankService['getFolders']>;
    createFolderImpl?: () => ReturnType<BankService['createFolder']>;
    updateFolderImpl?: () => ReturnType<BankService['updateFolder']>;
    getAllTopicsImpl?: () => ReturnType<TaxonomyService['getAllTopics']>;
    deleteFolderImpl?: () => ReturnType<BankService['deleteFolder']>;
  } = {},
) {
  const getFolders = vi.fn(
    over.getFoldersImpl ?? (() => of<BankFoldersResponse>({ folders: FOLDERS, unfiledCount: 0 })),
  );

  const createFolder = vi.fn(
    over.createFolderImpl ??
      ((body: { parentId: string | null; name: string }) =>
        of({
          id: 'nueva',
          name: body.name,
          parentId: body.parentId,
          topicId: null,
          position: 0,
          ownCount: 0,
          centralCount: 0,
          children: [],
        } satisfies BankFolderNode)),
  );

  const updateFolder = vi.fn(
    over.updateFolderImpl ??
      ((id: string, patch: { name?: string }) =>
        of({
          id,
          name: patch.name ?? 'sin nombre',
          parentId: null,
          topicId: null,
          position: 0,
          ownCount: 0,
          centralCount: 0,
          children: [],
        } satisfies BankFolderNode)),
  );

  const deleteFolder = vi.fn(
    over.deleteFolderImpl ?? (() => of({ deletedFolders: 1, unfiledQuestions: 3 })),
  );

  const getAllTopics = vi.fn(over.getAllTopicsImpl ?? (() => of(TOPICS)));

  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'app/bank', component: BankBrowserComponent },
        { path: 'app/bank/carpeta/:folderId', component: ListStubComponent },
      ]),
      { provide: BankService, useValue: { getFolders, createFolder, updateFolder, deleteFolder } },
      { provide: TaxonomyService, useValue: { getAllTopics } },
    ],
  });

  const harness = await RouterTestingHarness.create(url);
  harness.detectChanges();
  return {
    harness,
    getFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    getAllTopics,
    router: TestBed.inject(Router),
    el: () => harness.routeNativeElement as HTMLElement,
  };
}

async function clickCard(
  harness: RouterTestingHarness,
  el: () => HTMLElement,
  label: string,
): Promise<void> {
  const card = Array.from(
    el().querySelectorAll<HTMLButtonElement>('[data-testid="folder-card"]'),
  ).find((button) => button.textContent?.includes(label));
  card!.click();
  await harness.fixture.whenStable();
  harness.detectChanges();
}

describe('BankBrowserComponent', () => {
  it('shows the root folders as cards', async () => {
    const { el } = await setup();

    const cards = el().querySelectorAll('[data-testid="folder-card"]');
    expect(cards.length).toBe(2);
    expect(cards[0].textContent).toContain('Colegio');
    expect(cards[1].textContent).toContain('Preuniversitario');
  });

  it('drills into a folder and paints its children instead', async () => {
    const { harness, el } = await setup();

    await clickCard(harness, el, 'Colegio');

    const cards = el().querySelectorAll('[data-testid="folder-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Matemática');
  });

  /**
   * The open folder lives in the URL, not in a signal: that is what makes the
   * link shareable, the browser's back button work, and a refresh land where
   * the teacher was.
   */
  it('records the open folder in the carpeta query param', async () => {
    const { harness, el, router } = await setup();

    await clickCard(harness, el, 'Colegio');

    expect(router.url).toBe('/app/bank?carpeta=colegio');
  });

  it('grows the breadcrumb as the teacher goes deeper', async () => {
    const { harness, el } = await setup();

    await clickCard(harness, el, 'Colegio');
    await clickCard(harness, el, 'Matemática');

    const crumbs = Array.from(el().querySelectorAll('[data-testid="breadcrumb-crumb"]')).map(
      (crumb) => crumb.textContent?.trim(),
    );
    expect(crumbs).toEqual(['Mi banco', 'Colegio', 'Matemática']);
  });

  it('goes back up when a crumb is clicked', async () => {
    const { harness, el, router } = await setup();

    await clickCard(harness, el, 'Colegio');
    await clickCard(harness, el, 'Matemática');
    el().querySelector<HTMLButtonElement>('[data-testid="breadcrumb-crumb"]')!.click();
    await harness.fixture.whenStable();
    harness.detectChanges();

    expect(router.url).toBe('/app/bank');
    expect(el().querySelectorAll('[data-testid="folder-card"]').length).toBe(2);
  });

  /**
   * A folder with no subfolders is where browsing stops and the question list
   * takes over — the grid must not render an empty screen there.
   */
  it('leaves the grid for the question list when the folder is a leaf', async () => {
    const { harness, el, router } = await setup();

    await clickCard(harness, el, 'Colegio');
    await clickCard(harness, el, 'Matemática');
    await clickCard(harness, el, 'Ecuaciones cuadráticas');

    expect(router.url).toBe('/app/bank/carpeta/cuad');
  });

  it('opens straight into a folder named by the url', async () => {
    const { el } = await setup('/app/bank?carpeta=colegio');

    const cards = el().querySelectorAll('[data-testid="folder-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Matemática');
  });

  /** A shared link whose folder was deleted since must not blank the screen. */
  it('falls back to the root for a folder id that is no longer in the tree', async () => {
    const { el } = await setup('/app/bank?carpeta=borrada');

    expect(el().querySelectorAll('[data-testid="folder-card"]').length).toBe(0);
    expect(el().querySelector('[data-testid="browser-empty"]')).toBeTruthy();
  });

  /**
   * Questions with no folder are only reachable through this bucket. Once the
   * grid is the only way in, dropping it would strand them.
   */
  it('shows the unfiled bucket among the root cards when something is in it', async () => {
    const { el } = await setup('/app/bank', {
      getFoldersImpl: () => of<BankFoldersResponse>({ folders: FOLDERS, unfiledCount: 4 }),
    });

    const cards = Array.from(el().querySelectorAll('[data-testid="folder-card"]'));
    expect(cards.map((c) => c.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('Sin carpeta')]),
    );
  });

  it('does not show an empty unfiled bucket', async () => {
    const { el } = await setup();

    const cards = Array.from(el().querySelectorAll('[data-testid="folder-card"]'));
    expect(cards.some((c) => c.textContent?.includes('Sin carpeta'))).toBe(false);
  });

  it('opens the unfiled bucket like any other leaf', async () => {
    const { harness, el, router } = await setup('/app/bank', {
      getFoldersImpl: () => of<BankFoldersResponse>({ folders: FOLDERS, unfiledCount: 4 }),
    });

    await clickCard(harness, el, 'Sin carpeta');

    expect(router.url).toBe('/app/bank/carpeta/' + UNFILED_FOLDER_ID);
  });

  describe('creating a folder', () => {
    /**
     * Creation belongs to the level the teacher is looking at, not to a menu
     * inside one of the cards: a sibling is what she is about to make, and a
     * per-card menu would ask her to pick a parent she is already standing in.
     */
    it('creates the new folder under the folder currently open', async () => {
      const { harness, el, createFolder } = await setup('/app/bank?carpeta=colegio');

      el().querySelector<HTMLButtonElement>('[data-testid="new-folder"] button')!.click();
      harness.detectChanges();
      const input = el().querySelector<HTMLInputElement>('[data-testid="new-folder-name"] input')!;
      input.value = 'Simulacros';
      input.dispatchEvent(new Event('input'));
      harness.detectChanges();
      el()
        .querySelector<HTMLFormElement>('[data-testid="new-folder-form"]')!
        .dispatchEvent(new Event('submit'));
      harness.detectChanges();

      expect(createFolder).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: 'colegio', name: 'Simulacros' }),
      );
    });

    it('creates at the root when no folder is open', async () => {
      const { harness, el, createFolder } = await setup();

      el().querySelector<HTMLButtonElement>('[data-testid="new-folder"] button')!.click();
      harness.detectChanges();
      const input = el().querySelector<HTMLInputElement>('[data-testid="new-folder-name"] input')!;
      input.value = 'Colegio B';
      input.dispatchEvent(new Event('input'));
      harness.detectChanges();
      el()
        .querySelector<HTMLFormElement>('[data-testid="new-folder-form"]')!
        .dispatchEvent(new Event('submit'));
      harness.detectChanges();

      expect(createFolder).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: null, name: 'Colegio B' }),
      );
    });

    it('ignores a blank name instead of creating an untitled folder', async () => {
      const { harness, el, createFolder } = await setup();

      el().querySelector<HTMLButtonElement>('[data-testid="new-folder"] button')!.click();
      harness.detectChanges();
      el()
        .querySelector<HTMLFormElement>('[data-testid="new-folder-form"]')!
        .dispatchEvent(new Event('submit'));
      harness.detectChanges();

      expect(createFolder).not.toHaveBeenCalled();
    });

    it('closes the editor on Escape without creating anything', async () => {
      const { harness, el, createFolder } = await setup();

      el().querySelector<HTMLButtonElement>('[data-testid="new-folder"] button')!.click();
      harness.detectChanges();
      el()
        .querySelector('[data-testid="new-folder-name"] input')!
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      harness.detectChanges();

      expect(el().querySelector('[data-testid="new-folder-form"]')).toBeFalsy();
      expect(createFolder).not.toHaveBeenCalled();
    });

    it('shows the reason when the server refuses the name', async () => {
      const { harness, el } = await setup('/app/bank', {
        createFolderImpl: () =>
          throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Ya existe' } })),
      });

      el().querySelector<HTMLButtonElement>('[data-testid="new-folder"] button')!.click();
      harness.detectChanges();
      const input = el().querySelector<HTMLInputElement>('[data-testid="new-folder-name"] input')!;
      input.value = 'Colegio';
      input.dispatchEvent(new Event('input'));
      harness.detectChanges();
      el()
        .querySelector<HTMLFormElement>('[data-testid="new-folder-form"]')!
        .dispatchEvent(new Event('submit'));
      harness.detectChanges();

      expect(el().querySelector('[data-testid="new-folder-error"]')!.textContent).toContain(
        'Ya existe',
      );
    });
  });

  it('surfaces a failed folder load instead of showing an empty bank', async () => {
    const { el } = await setup('/app/bank', {
      getFoldersImpl: () => throwError(() => new Error('boom')),
    });

    expect(el().querySelector('[data-testid="browser-error"]')).toBeTruthy();
    expect(el().querySelectorAll('[data-testid="folder-card"]').length).toBe(0);
  });
});

/**
 * The card's own menu is where a folder is maintained now that the grid
 * replaced the tree: rename, add a subfolder under it, remove it. Creation of
 * a SIBLING still lives in the header, because that one belongs to the level
 * the teacher is standing in rather than to any card.
 */
describe('BankBrowserComponent — maintaining a folder from its card', () => {
  function openCardMenu(harness: RouterTestingHarness, el: () => HTMLElement, id: string): void {
    el()
      .querySelector<HTMLButtonElement>(`[data-testid="card-menu"][data-folder-id="${id}"]`)!
      .click();
    harness.detectChanges();
  }

  function clickMenuItem(
    harness: RouterTestingHarness,
    el: () => HTMLElement,
    testid: string,
  ): void {
    el().querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)!.click();
    harness.detectChanges();
  }

  it('renames the folder the menu belongs to', async () => {
    const { harness, el, updateFolder } = await setup();

    openCardMenu(harness, el, 'colegio');
    clickMenuItem(harness, el, 'card-menu-rename');
    const input = el().querySelector<HTMLInputElement>('[data-testid="card-rename-input"]')!;
    input.value = 'Colegio San Juan';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    el()
      .querySelector<HTMLFormElement>('[data-testid="card-rename-form"]')!
      .dispatchEvent(new Event('submit'));
    harness.detectChanges();

    expect(updateFolder).toHaveBeenCalledWith('colegio', { name: 'Colegio San Juan' });
    expect(el().textContent).toContain('Colegio San Juan');
  });

  it('says why the server refused the new name', async () => {
    const { harness, el } = await setup('/app/bank', {
      updateFolderImpl: () =>
        throwError(() => new HttpErrorResponse({ status: 409, error: { message: 'Ya existe' } })),
    });

    openCardMenu(harness, el, 'colegio');
    clickMenuItem(harness, el, 'card-menu-rename');
    const input = el().querySelector<HTMLInputElement>('[data-testid="card-rename-input"]')!;
    input.value = 'Preuniversitario';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    el()
      .querySelector<HTMLFormElement>('[data-testid="card-rename-form"]')!
      .dispatchEvent(new Event('submit'));
    harness.detectChanges();

    expect(el().querySelector('[data-testid="folder-action-error"]')!.textContent).toContain(
      'Ya existe',
    );
  });

  /** "Nueva subcarpeta" is the one creation that names its parent explicitly. */
  it('creates a subfolder under the card, not under the open level', async () => {
    const { harness, el, createFolder } = await setup();

    openCardMenu(harness, el, 'colegio');
    clickMenuItem(harness, el, 'card-menu-subfolder');
    const input = el().querySelector<HTMLInputElement>('[data-testid="new-folder-name"] input')!;
    input.value = 'Secundaria';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    el()
      .querySelector<HTMLFormElement>('[data-testid="new-folder-form"]')!
      .dispatchEvent(new Event('submit'));
    harness.detectChanges();

    expect(createFolder).toHaveBeenCalledWith({ parentId: 'colegio', name: 'Secundaria' });
  });

  /** Removing a folder unfiles every question under it — never silently. */
  it('confirms before removing, naming the folder', async () => {
    const { harness, el, deleteFolder } = await setup();

    openCardMenu(harness, el, 'colegio');
    clickMenuItem(harness, el, 'card-menu-delete');

    expect(el().querySelector('[data-testid="folder-delete-confirm"]')!.textContent).toContain(
      'Colegio',
    );
    expect(deleteFolder).not.toHaveBeenCalled();
  });

  it('removes the folder once the teacher confirms', async () => {
    const { harness, el, deleteFolder } = await setup();

    openCardMenu(harness, el, 'colegio');
    clickMenuItem(harness, el, 'card-menu-delete');
    el()
      .querySelector<HTMLButtonElement>('[data-testid="folder-delete-confirm-yes"] button')!
      .click();
    harness.detectChanges();

    expect(deleteFolder).toHaveBeenCalledWith('colegio');
    expect(el().querySelector('[data-testid="folder-removed-notice"]')!.textContent).toContain('3');
  });

  it('keeps the folder when the confirmation is dismissed', async () => {
    const { harness, el, deleteFolder } = await setup();

    openCardMenu(harness, el, 'colegio');
    clickMenuItem(harness, el, 'card-menu-delete');
    el().querySelector<HTMLButtonElement>('[data-testid="folder-delete-cancel"] button')!.click();
    harness.detectChanges();

    expect(deleteFolder).not.toHaveBeenCalled();
    expect(el().querySelectorAll('[data-testid="folder-card"]').length).toBe(2);
  });

  it('gives the unfiled bucket no menu at all', async () => {
    const { el } = await setup('/app/bank', {
      getFoldersImpl: () => of<BankFoldersResponse>({ folders: FOLDERS, unfiledCount: 4 }),
    });

    expect(
      el().querySelector(`[data-testid="card-menu"][data-folder-id="${UNFILED_FOLDER_ID}"]`),
    ).toBeFalsy();
  });
});

/**
 * A school ends up with more folders than fit on one screen, and the teacher
 * knows the name of the one she wants. Search looks DOWNWARD from the level
 * she is standing in, so the results are folders, never questions — the
 * questions of an unopened folder are not in the browser, and pretending
 * otherwise would silently mean "the part you already opened".
 */
describe('BankBrowserComponent — searching for a folder', () => {
  function search(harness: RouterTestingHarness, el: () => HTMLElement, query: string): void {
    const input = el().querySelector<HTMLInputElement>('[data-testid="folder-search"] input')!;
    input.value = query;
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
  }

  it('finds a folder that lives several levels down', async () => {
    const { harness, el } = await setup();

    search(harness, el, 'cuadr');

    const cards = el().querySelectorAll('[data-testid="folder-card"]');
    expect(cards.length).toBe(1);
    expect(cards[0].textContent).toContain('Ecuaciones cuadráticas');
  });

  /** Two folders can share a name; the trail is what tells them apart. */
  it('shows where each result lives', async () => {
    const { harness, el } = await setup();

    search(harness, el, 'cuadr');

    expect(el().querySelector('[data-testid="card-trail"]')!.textContent).toContain('Matemática');
  });

  it('searches only below the folder that is open', async () => {
    const { harness, el } = await setup('/app/bank?carpeta=preuni');

    search(harness, el, 'cuadr');

    expect(el().querySelectorAll('[data-testid="folder-card"]').length).toBe(0);
    expect(el().querySelector('[data-testid="browser-no-results"]')).toBeTruthy();
  });

  it('opens a result the same way as a card in the grid', async () => {
    const { harness, el, router } = await setup();

    search(harness, el, 'cuadr');
    await clickCard(harness, el, 'Ecuaciones cuadráticas');

    expect(router.url).toBe('/app/bank/carpeta/cuad');
  });

  it('goes back to the level being browsed once the query is cleared', async () => {
    const { harness, el } = await setup();

    search(harness, el, 'cuadr');
    search(harness, el, '');

    expect(el().querySelectorAll('[data-testid="folder-card"]').length).toBe(2);
  });

  /** Drilling with a query still on screen would show results that ignore it. */
  it('drops the query when the teacher navigates', async () => {
    const { harness, el } = await setup();

    search(harness, el, 'mate');
    await clickCard(harness, el, 'Matemática');

    expect(el().querySelector<HTMLInputElement>('[data-testid="folder-search"] input')!.value).toBe(
      '',
    );
  });
});

/**
 * A teacher preparing 4° secundaria does not want the primaria half of the
 * bank on screen. The chips come from `topic_grades`: a folder has no grade of
 * its own, its TOPIC is what is taught at one or more grades, so the grid asks
 * the topic catalog once and filters locally.
 */
describe('BankBrowserComponent — filtering by grade', () => {
  function chip(el: () => HTMLElement, grade: string): HTMLButtonElement {
    return el().querySelector<HTMLButtonElement>(
      `[data-testid="grade-chip"][data-grade="${grade}"]`,
    )!;
  }

  it('offers only the grades the bank actually reaches', async () => {
    const { el } = await setup();

    const grades = Array.from(el().querySelectorAll('[data-testid="grade-chip"]')).map((c) =>
      c.getAttribute('data-grade'),
    );
    expect(grades).toEqual(['primaria_5', 'secundaria_4']);
  });

  it('names each chip the way a teacher says it', async () => {
    const { el } = await setup();

    expect(chip(el, 'secundaria_4').textContent).toContain('4° secundaria');
  });

  it('keeps only the folders that lead to that grade', async () => {
    const { harness, el } = await setup();

    chip(el, 'secundaria_4').click();
    harness.detectChanges();

    const cards = Array.from(el().querySelectorAll('[data-testid="folder-card"]')).map(
      (card) => card.textContent,
    );
    expect(cards.length).toBe(1);
    expect(cards[0]).toContain('Colegio');
  });

  it('shows everything again when the chip is switched off', async () => {
    const { harness, el } = await setup();

    chip(el, 'secundaria_4').click();
    harness.detectChanges();
    chip(el, 'secundaria_4').click();
    harness.detectChanges();

    expect(el().querySelectorAll('[data-testid="folder-card"]').length).toBe(2);
  });

  it('says so when the open folder has nothing at that grade', async () => {
    const { harness, el } = await setup('/app/bank?carpeta=preuni');

    chip(el, 'secundaria_4').click();
    harness.detectChanges();

    expect(el().querySelector('[data-testid="browser-no-results"]')).toBeTruthy();
  });

  /** The filter is about grades, and the bucket has no topic to be taught at one. */
  it('drops the unfiled bucket while a grade is chosen', async () => {
    const { harness, el } = await setup('/app/bank', {
      getFoldersImpl: () => of<BankFoldersResponse>({ folders: FOLDERS, unfiledCount: 4 }),
    });

    chip(el, 'secundaria_4').click();
    harness.detectChanges();

    const cards = Array.from(el().querySelectorAll('[data-testid="folder-card"]'));
    expect(cards.some((c) => c.textContent?.includes('Sin carpeta'))).toBe(false);
  });

  it('narrows a search by the chosen grade too', async () => {
    const { harness, el } = await setup();

    const input = el().querySelector<HTMLInputElement>('[data-testid="folder-search"] input')!;
    input.value = 'a';
    input.dispatchEvent(new Event('input'));
    harness.detectChanges();
    chip(el, 'primaria_5').click();
    harness.detectChanges();

    const cards = Array.from(el().querySelectorAll('[data-testid="folder-card"]')).map(
      (card) => card.textContent,
    );
    expect(cards.every((text) => !text?.includes('Ecuaciones cuadráticas'))).toBe(true);
  });

  /** No catalog, no chips — never a row of empty buttons. */
  it('shows no chip row when the topics never arrive', async () => {
    const { el } = await setup('/app/bank', {
      getAllTopicsImpl: () => throwError(() => new Error('boom')),
    });

    expect(el().querySelector('[data-testid="grade-chips"]')).toBeFalsy();
  });
});
