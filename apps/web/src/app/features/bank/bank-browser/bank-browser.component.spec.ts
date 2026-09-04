import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { HttpErrorResponse } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { BankFolderNode, BankFoldersResponse, UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { BankService } from '../bank.service';
import { BankBrowserComponent } from './bank-browser.component';

@Component({ selector: 'app-list-stub', standalone: true, template: 'lista' })
class ListStubComponent {}

function folder(
  id: string,
  name: string,
  children: BankFolderNode[] = [],
  counts: { own?: number; central?: number } = {},
): BankFolderNode {
  return {
    id,
    name,
    parentId: null,
    topicId: null,
    position: 0,
    ownCount: counts.own ?? 0,
    centralCount: counts.central ?? 0,
    children,
  };
}

const FOLDERS: BankFolderNode[] = [
  folder('colegio', 'Colegio', [
    folder('mate', 'Matemática', [folder('cuad', 'Ecuaciones cuadráticas', [], { own: 18 })], {
      own: 142,
      central: 1208,
    }),
  ]),
  folder('preuni', 'Preuniversitario'),
];

async function setup(
  url = '/app/bank',
  over: {
    getFoldersImpl?: () => ReturnType<BankService['getFolders']>;
    createFolderImpl?: () => ReturnType<BankService['createFolder']>;
  } = {},
) {
  const getFolders = vi.fn(
    over.getFoldersImpl ??
      (() => of<BankFoldersResponse>({ folders: FOLDERS, unfiledCount: 0 })),
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

  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'app/bank', component: BankBrowserComponent },
        { path: 'app/bank/carpeta/:folderId', component: ListStubComponent },
      ]),
      { provide: BankService, useValue: { getFolders, createFolder } },
    ],
  });

  const harness = await RouterTestingHarness.create(url);
  harness.detectChanges();
  return {
    harness,
    getFolders,
    createFolder,
    router: TestBed.inject(Router),
    el: () => harness.routeNativeElement as HTMLElement,
  };
}

async function clickCard(
  harness: RouterTestingHarness,
  el: () => HTMLElement,
  label: string,
): Promise<void> {
  const card = Array.from(el().querySelectorAll<HTMLButtonElement>('[data-testid="folder-card"]')).find(
    (button) => button.textContent?.includes(label),
  );
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
      el().querySelector<HTMLFormElement>('[data-testid="new-folder-form"]')!.dispatchEvent(
        new Event('submit'),
      );
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
      el().querySelector<HTMLFormElement>('[data-testid="new-folder-form"]')!.dispatchEvent(
        new Event('submit'),
      );
      harness.detectChanges();

      expect(createFolder).toHaveBeenCalledWith(
        expect.objectContaining({ parentId: null, name: 'Colegio B' }),
      );
    });

    it('ignores a blank name instead of creating an untitled folder', async () => {
      const { harness, el, createFolder } = await setup();

      el().querySelector<HTMLButtonElement>('[data-testid="new-folder"] button')!.click();
      harness.detectChanges();
      el().querySelector<HTMLFormElement>('[data-testid="new-folder-form"]')!.dispatchEvent(
        new Event('submit'),
      );
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
      el().querySelector<HTMLFormElement>('[data-testid="new-folder-form"]')!.dispatchEvent(
        new Event('submit'),
      );
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
