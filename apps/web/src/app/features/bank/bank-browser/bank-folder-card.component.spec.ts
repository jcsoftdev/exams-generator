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

  /**
   * "Sin carpeta" is a view over `folder_id IS NULL`, not a folder — it cannot
   * be renamed, moved or deleted. Drawing it like a real folder invites the
   * teacher to try, so it is marked apart.
   */
  it('marks a non-editable node as the unfiled bucket rather than a folder', () => {
    const { compiled } = setup({ ...NODE, editable: false, children: [] });

    expect(compiled.querySelector('[data-testid="folder-card"]')!.getAttribute('data-variant')).toBe(
      'unfiled',
    );
  });

  it('marks a real folder as one', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="folder-card"]')!.getAttribute('data-variant')).toBe(
      'folder',
    );
  });

  /** The bucket holds loose questions, never subfolders — the line would be a lie. */
  it('does not talk about subfolders on the unfiled bucket', () => {
    const { compiled } = setup({ ...NODE, editable: false, children: [] });

    expect(compiled.querySelector('[data-testid="card-children"]')).toBeFalsy();
  });

  /** A card is one keyboard stop, so it has to be a real button. */
  it('is a button, not a div with a click handler', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="folder-card"]')!.tagName).toBe('BUTTON');
  });

  /**
   * The grid stretches its items, but the card is drawn on the inner button —
   * so without an explicit full height the border stops at the text and a row
   * of cards ends up ragged, one short card beside a two-line title (audit
   * 2026-09-06). Every box from the host down to the button has to inherit the
   * row's height for the borders to line up.
   */
  it('carries the row height all the way down to the drawn card', () => {
    const { fixture, compiled } = setup();

    const host = fixture.nativeElement as HTMLElement;
    const card = compiled.querySelector<HTMLElement>('[data-testid="folder-card"]')!;

    expect(host.className).toContain('h-full');
    expect(card.parentElement!.className).toContain('h-full');
    expect(card.className).toContain('h-full');
  });

  /**
   * With the card stretched, the two counts have to sit on the bottom edge of
   * every card instead of floating right under a short title — otherwise the
   * cards are the same height but the footers still read as a ragged line.
   */
  it('pins the counts to the bottom of the card', () => {
    const { compiled } = setup();

    const body = compiled.querySelector('[data-testid="card-body"]')!;
    const footer = compiled.querySelector('[data-testid="card-own"]')!.parentElement!;

    expect(body.className).toContain('flex-1');
    expect(footer.className).toContain('mt-auto');
  });
});

describe('BankFolderCardComponent — the per-card menu', () => {
  function openMenu(compiled: HTMLElement, fixture: { detectChanges(): void }): void {
    compiled.querySelector<HTMLButtonElement>('[data-testid="card-menu"]')!.click();
    fixture.detectChanges();
  }

  it('offers a menu on a real folder', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="card-menu"]')).toBeTruthy();
  });

  /** Nothing in the menu can succeed on a bucket that is not a row anywhere. */
  it('offers no menu on the unfiled bucket', () => {
    const { compiled } = setup({ ...NODE, editable: false, children: [] });

    expect(compiled.querySelector('[data-testid="card-menu"]')).toBeFalsy();
  });

  it('asks for a subfolder of this folder', () => {
    const { fixture, compiled } = setup();
    const seen: string[] = [];
    fixture.componentInstance.subfolderRequested.subscribe((id: string) => seen.push(id));

    openMenu(compiled, fixture);
    compiled.querySelector<HTMLButtonElement>('[data-testid="card-menu-subfolder"]')!.click();

    expect(seen).toEqual(['mate']);
  });

  it('asks for removal of this folder', () => {
    const { fixture, compiled } = setup();
    const seen: string[] = [];
    fixture.componentInstance.removeRequested.subscribe((id: string) => seen.push(id));

    openMenu(compiled, fixture);
    compiled.querySelector<HTMLButtonElement>('[data-testid="card-menu-delete"]')!.click();

    expect(seen).toEqual(['mate']);
  });

  /**
   * Renaming happens on the card itself: the teacher is looking at the name
   * she wants to change, and a dialog would take it off screen to type it.
   */
  it('renames inline, starting from the name already there', () => {
    const { fixture, compiled } = setup();
    const seen: string[] = [];
    fixture.componentInstance.renamed.subscribe((name: string) => seen.push(name));

    openMenu(compiled, fixture);
    compiled.querySelector<HTMLButtonElement>('[data-testid="card-menu-rename"]')!.click();
    fixture.detectChanges();

    const input = compiled.querySelector<HTMLInputElement>('[data-testid="card-rename-input"]')!;
    expect(input.value).toBe('Matemática');

    input.value = 'Matemáticas';
    input.dispatchEvent(new Event('input'));
    compiled
      .querySelector<HTMLFormElement>('[data-testid="card-rename-form"]')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(seen).toEqual(['Matemáticas']);
  });

  it('does not emit a rename that changes nothing', () => {
    const { fixture, compiled } = setup();
    const seen: string[] = [];
    fixture.componentInstance.renamed.subscribe((name: string) => seen.push(name));

    openMenu(compiled, fixture);
    compiled.querySelector<HTMLButtonElement>('[data-testid="card-menu-rename"]')!.click();
    fixture.detectChanges();
    compiled
      .querySelector<HTMLFormElement>('[data-testid="card-rename-form"]')!
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(seen).toEqual([]);
  });

  it('abandons the rename on Escape', () => {
    const { fixture, compiled } = setup();
    const seen: string[] = [];
    fixture.componentInstance.renamed.subscribe((name: string) => seen.push(name));

    openMenu(compiled, fixture);
    compiled.querySelector<HTMLButtonElement>('[data-testid="card-menu-rename"]')!.click();
    fixture.detectChanges();
    compiled
      .querySelector('[data-testid="card-rename-input"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="card-rename-form"]')).toBeFalsy();
    expect(seen).toEqual([]);
  });

  /** Opening the menu must not also open the folder behind it. */
  it('does not open the folder when the menu is used', () => {
    const { fixture, compiled } = setup();
    const seen: string[] = [];
    fixture.componentInstance.open.subscribe((id: string) => seen.push(id));

    openMenu(compiled, fixture);
    compiled.querySelector<HTMLButtonElement>('[data-testid="card-menu-rename"]')!.click();
    fixture.detectChanges();

    expect(seen).toEqual([]);
  });
});

/**
 * The redesign's rule: no folder icons. A teacher scanning the grid is looking
 * for a subject, and the glyph is what she reads before the name.
 */
describe('BankFolderCardComponent — the subject glyph', () => {
  it('gives a folder the glyph of its subject', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="card-glyph"]')!.getAttribute('data-glyph')).toBe(
      'sigma',
    );
  });

  it('tells two subjects apart', () => {
    const { compiled } = setup({ ...NODE, name: 'Historia' });

    expect(compiled.querySelector('[data-testid="card-glyph"]')!.getAttribute('data-glyph')).toBe(
      'landmark',
    );
  });

  /** The bucket is not a subject — it keeps the mark that says it is a leftover. */
  it('keeps its own mark on the unfiled bucket', () => {
    const { compiled } = setup({ ...NODE, name: 'Sin carpeta', editable: false, children: [] });

    expect(compiled.querySelector('[data-testid="card-glyph"]')!.getAttribute('data-glyph')).toBe(
      'help-circle',
    );
  });
});
