import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BankFolderNode } from '@exams-generator/shared';
import { BankFoldersStore } from './bank-folders.store';
import { environment } from '../../../../environments/environment';

function wire(partial: Partial<BankFolderNode> & { id: string; name: string }): BankFolderNode {
  return {
    parentId: partial.parentId ?? null,
    topicId: partial.topicId ?? null,
    position: partial.position ?? 0,
    ownCount: partial.ownCount ?? 0,
    centralCount: partial.centralCount ?? 0,
    children: partial.children ?? [],
    ...partial,
  };
}

const TREE: BankFolderNode[] = [
  wire({
    id: 'colegio',
    name: 'Colegio',
    children: [
      wire({ id: 'mate', name: 'Matemática', parentId: 'colegio', topicId: 't-1', ownCount: 3 }),
    ],
  }),
];

describe('BankFoldersStore', () => {
  let store: BankFoldersStore;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), BankFoldersStore],
    });
    store = TestBed.inject(BankFoldersStore);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  function flushLoad(unfiledCount = 0): void {
    store.load();
    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders`)
      .flush({ folders: TREE, unfiledCount });
  }

  it('loads the tree and exposes it as the render view model', () => {
    flushLoad(4);

    expect(store.loading()).toBe(false);
    expect(store.tree().map((node) => node.id)).toEqual(['colegio', 'unfiled']);
    expect(store.tree()[0]!.totalCount).toBe(3);
    expect(store.unfiledCount()).toBe(4);
  });

  it('surfaces a load failure as an error message and leaves the tree empty', () => {
    store.load();
    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders`)
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(store.error()).toBe('No se pudieron cargar las carpetas. Inténtalo de nuevo.');
    expect(store.tree()).toEqual([]);
  });

  it('creates optimistically: the node is in the tree BEFORE the response arrives', () => {
    flushLoad();

    store.create('colegio', 'Nueva').subscribe({ error: () => {} });
    const names = store.tree()[0]!.children.map((node) => node.name);
    expect(names).toContain('Nueva');

    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders`)
      .flush(wire({ id: 'real', name: 'Nueva', parentId: 'colegio' }));

    expect(store.tree()[0]!.children.map((node) => node.id)).toContain('real');
  });

  it('rolls a failed create back to the previous tree', () => {
    flushLoad();
    const before = store.tree();

    store.create('colegio', 'Nueva').subscribe({ error: () => {} });
    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders`)
      .flush({ code: 'folder_name_taken' }, { status: 409, statusText: 'Conflict' });

    expect(store.tree()).toEqual(before);
  });

  it('renames optimistically and rolls back on failure', () => {
    flushLoad();

    store.rename('mate', 'Matemáticas').subscribe({ error: () => {} });
    expect(store.tree()[0]!.children[0]!.name).toBe('Matemáticas');

    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders/mate`)
      .flush({ code: 'folder_name_taken' }, { status: 409, statusText: 'Conflict' });

    expect(store.tree()[0]!.children[0]!.name).toBe('Matemática');
  });

  it('moves a folder with a PATCH carrying parentId', () => {
    flushLoad();

    store.move('mate', null).subscribe({ error: () => {} });
    const request = httpMock.expectOne(`${environment.apiBaseUrl}/bank/folders/mate`);
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ parentId: null });
    request.flush(wire({ id: 'mate', name: 'Matemática', parentId: null }));

    expect(store.tree().map((node) => node.id)).toEqual(['colegio', 'mate']);
  });

  it('removes optimistically and returns the server counts', () => {
    flushLoad();
    let result: { deletedFolders: number; unfiledQuestions: number } | null = null;

    store.remove('mate').subscribe({ next: (value) => (result = value), error: () => {} });
    expect(store.tree()[0]!.children).toEqual([]);

    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders/mate`)
      .flush({ deletedFolders: 1, unfiledQuestions: 3 });

    expect(result).toEqual({ deletedFolders: 1, unfiledQuestions: 3 });
  });

  it('rolls a failed remove back — the folder reappears', () => {
    flushLoad();

    store.remove('mate').subscribe({ error: () => {} });
    httpMock
      .expectOne(`${environment.apiBaseUrl}/bank/folders/mate`)
      .flush({ code: 'folder_not_found' }, { status: 404, statusText: 'Not Found' });

    expect(store.tree()[0]!.children.map((node) => node.id)).toEqual(['mate']);
  });

  it('answers name and topic lookups by id', () => {
    flushLoad();
    expect(store.folderName('mate')).toBe('Matemática');
    expect(store.folderTopicId('mate')).toBe('t-1');
    expect(store.folderName('nope')).toBeNull();
  });
});
