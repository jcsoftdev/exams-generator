import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { describe, it, expect, vi } from 'vitest';
import { BankFolderNode, BankFoldersResponse } from '@exams-generator/shared';
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
  over: { getFoldersImpl?: () => ReturnType<BankService['getFolders']> } = {},
) {
  const getFolders = vi.fn(
    over.getFoldersImpl ??
      (() => of<BankFoldersResponse>({ folders: FOLDERS, unfiledCount: 0 })),
  );

  TestBed.configureTestingModule({
    providers: [
      provideRouter([
        { path: 'app/bank', component: BankBrowserComponent },
        { path: 'app/bank/carpeta/:folderId', component: ListStubComponent },
      ]),
      { provide: BankService, useValue: { getFolders } },
    ],
  });

  const harness = await RouterTestingHarness.create(url);
  harness.detectChanges();
  return {
    harness,
    getFolders,
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

  it('surfaces a failed folder load instead of showing an empty bank', async () => {
    const { el } = await setup('/app/bank', {
      getFoldersImpl: () => throwError(() => new Error('boom')),
    });

    expect(el().querySelector('[data-testid="browser-error"]')).toBeTruthy();
    expect(el().querySelectorAll('[data-testid="folder-card"]').length).toBe(0);
  });
});
