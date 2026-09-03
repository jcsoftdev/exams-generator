import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { LucideAngularModule, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-angular';
import { FolderTreeComponent } from './folder-tree.component';
import { FolderTreeNode } from './folder-tree.types';

function node(partial: Partial<FolderTreeNode> & { id: string; name: string }): FolderTreeNode {
  return {
    topicId: partial.topicId ?? null,
    ownCount: partial.ownCount ?? 0,
    centralCount: partial.centralCount ?? 0,
    totalCount: partial.totalCount ?? 0,
    editable: partial.editable ?? true,
    children: partial.children ?? [],
    ...partial,
  };
}

const TREE: FolderTreeNode[] = [
  node({
    id: 'colegio',
    name: 'Colegio',
    totalCount: 42,
    children: [
      node({
        id: 'mate',
        name: 'Matemática',
        totalCount: 42,
        ownCount: 2,
        centralCount: 40,
        topicId: 't-1',
      }),
    ],
  }),
  node({ id: 'unfiled', name: 'Sin carpeta', totalCount: 3, ownCount: 3, editable: false }),
];

@Component({
  standalone: true,
  imports: [FolderTreeComponent],
  template: `
    <ui-folder-tree
      [nodes]="nodes()"
      [selectedId]="selectedId()"
      [mode]="mode()"
      (select)="lastSelected = $event"
      (create)="lastCreated = $event"
      (rename)="lastRenamed = $event"
      (remove)="lastRemoved = $event"
    ></ui-folder-tree>
  `,
})
class HostComponent {
  readonly nodes = signal<readonly FolderTreeNode[]>(TREE);
  readonly selectedId = signal<string | null>(null);
  readonly mode = signal<'browse' | 'pick'>('browse');
  lastSelected: string | null = null;
  lastCreated: { parentId: string | null; name: string } | null = null;
  lastRenamed: { id: string; name: string } | null = null;
  lastRemoved: string | null = null;
}

describe('FolderTreeComponent', () => {
  let fixture: ReturnType<typeof TestBed.createComponent<HostComponent>>;
  let host: HostComponent;
  let element: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [
        HostComponent,
        LucideAngularModule.pick({ ChevronDown, ChevronRight, MoreHorizontal }),
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    element = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  function rowFor(id: string): HTMLElement {
    return element.querySelector<HTMLElement>(
      `[data-testid="folder-row"][data-folder-id="${id}"]`,
    )!;
  }

  it('renders the roots and the CDK tree role', () => {
    expect(element.querySelector('[role="tree"]')).not.toBeNull();
    expect(rowFor('colegio')).not.toBeNull();
    expect(rowFor('unfiled')).not.toBeNull();
  });

  it('hides children until the node is expanded, then shows them', () => {
    expect(rowFor('mate')).toBeNull();

    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-toggle"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();

    expect(rowFor('mate')).not.toBeNull();
  });

  it('labels the toggle for assistive tech', () => {
    const toggle = element.querySelector<HTMLButtonElement>(
      '[data-testid="folder-toggle"][data-folder-id="colegio"]',
    )!;
    expect(toggle.getAttribute('aria-label')).toBe('Expandir Colegio');
  });

  it('gives every row the CDK treeitem role and an aria-level', () => {
    const row = rowFor('colegio').closest('[role="treeitem"]');
    expect(row).not.toBeNull();
    expect(row!.getAttribute('aria-level')).toBe('1');
  });

  it('emits select with the folder id when a row is clicked', () => {
    rowFor('colegio').click();
    expect(host.lastSelected).toBe('colegio');
  });

  it('marks the selected row with aria-selected', () => {
    host.selectedId.set('colegio');
    fixture.detectChanges();
    expect(rowFor('colegio').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the cumulative count next to the name', () => {
    expect(rowFor('colegio').textContent).toContain('42');
  });

  it('renames inline: F2 opens the input, Enter emits rename', () => {
    const row = rowFor('colegio');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    const input = element.querySelector<HTMLInputElement>(
      '[data-testid="folder-name-input"] input',
    )!;
    input.value = 'Colegio renombrado';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastRenamed).toEqual({ id: 'colegio', name: 'Colegio renombrado' });
  });

  it('cancels the inline edit on Escape without emitting', () => {
    const row = rowFor('colegio');
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    element
      .querySelector<HTMLInputElement>('[data-testid="folder-name-input"] input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastRenamed).toBeNull();
    expect(element.querySelector('[data-testid="folder-name-input"]')).toBeNull();
  });

  it('emits remove on the Delete key', () => {
    rowFor('colegio').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(host.lastRemoved).toBe('colegio');
  });

  it('never offers actions on a non-editable node', () => {
    const unfiled = rowFor('unfiled');
    expect(unfiled.querySelector('[data-testid="folder-menu"]')).toBeNull();

    unfiled.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(host.lastRemoved).toBeNull();
  });

  it('in pick mode shows no actions and no central count', () => {
    host.mode.set('pick');
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="folder-menu"]')).toBeNull();
    rowFor('colegio').dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(host.lastRemoved).toBeNull();
    // Selecting still works — picking a folder IS the point of this mode.
    rowFor('colegio').click();
    expect(host.lastSelected).toBe('colegio');
  });

  it('creates a subfolder: the menu action opens an input whose Enter emits create', () => {
    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-menu"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="folder-action-create"]')!.click();
    fixture.detectChanges();

    const input = element.querySelector<HTMLInputElement>(
      '[data-testid="folder-new-input"] input',
    )!;
    input.value = 'Subcarpeta';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastCreated).toEqual({ parentId: 'colegio', name: 'Subcarpeta' });
  });

  it('renders an empty tree without throwing', () => {
    host.nodes.set([]);
    fixture.detectChanges();
    expect(element.querySelectorAll('[data-testid="folder-row"]')).toHaveLength(0);
  });
});
