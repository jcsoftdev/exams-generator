import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { BankFolderCardComponent } from './bank-folder-card.component';

function child(id: string): FolderTreeNode {
  return {
    id,
    name: id,
    topicId: null,
    ownCount: 0,
    centralCount: 0,
    totalCount: 0,
    editable: true,
    children: [],
  };
}

const NODE: FolderTreeNode = {
  id: 'mate',
  name: 'Matemática',
  topicId: 't1',
  ownCount: 142,
  centralCount: 1208,
  totalCount: 1350,
  editable: true,
  children: [child('cuad')],
};

function setup(node: FolderTreeNode = NODE) {
  TestBed.configureTestingModule({ imports: [BankFolderCardComponent] });
  const fixture = TestBed.createComponent(BankFolderCardComponent);
  fixture.componentRef.setInput('node', node);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('BankFolderCardComponent', () => {
  it('shows the name, how many subfolders are inside and both counts', () => {
    const { compiled } = setup();

    expect(compiled.textContent).toContain('Matemática');
    expect(compiled.querySelector('[data-testid="card-children"]')!.textContent).toContain('1 tema');
    expect(compiled.querySelector('[data-testid="card-own"]')!.textContent).toContain('142');
    expect(compiled.querySelector('[data-testid="card-central"]')!.textContent).toContain('1208');
  });

  it('pluralises the subfolder count', () => {
    const { compiled } = setup({ ...NODE, children: [child('a'), child('b')] });

    expect(compiled.querySelector('[data-testid="card-children"]')!.textContent).toContain(
      '2 temas',
    );
  });

  it('says so when a folder holds no subfolders at all', () => {
    const { compiled } = setup({ ...NODE, children: [] });

    expect(compiled.querySelector('[data-testid="card-children"]')!.textContent).toContain(
      'Sin subcarpetas',
    );
  });

  /**
   * Most of a school's own folders start with zero central questions. A "0 del
   * banco" on every card is noise that trains the teacher to stop reading the
   * line that matters.
   */
  it('hides the central count when the folder has none', () => {
    const { compiled } = setup({ ...NODE, centralCount: 0 });

    expect(compiled.querySelector('[data-testid="card-central"]')).toBeFalsy();
    expect(compiled.querySelector('[data-testid="card-own"]')).toBeTruthy();
  });

  it('emits open with the folder id when the card is activated', () => {
    const { fixture, compiled } = setup();
    const seen: string[] = [];
    fixture.componentInstance.open.subscribe((id: string) => seen.push(id));

    compiled.querySelector<HTMLButtonElement>('[data-testid="folder-card"]')!.click();

    expect(seen).toEqual(['mate']);
  });

  /** A card is one keyboard stop, so it has to be a real button. */
  it('is a button, not a div with a click handler', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="folder-card"]')!.tagName).toBe('BUTTON');
  });
});
