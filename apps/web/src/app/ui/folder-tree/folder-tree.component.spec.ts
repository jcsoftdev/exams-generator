import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LucideAngularModule, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-angular';
import { FolderTreeComponent } from './folder-tree.component';
import { FolderInlineError, FolderTreeNode } from './folder-tree.types';

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
      [inlineError]="inlineError()"
      (folderSelected)="lastSelected = $event"
      (expandedChange)="lastToggled = $event"
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
  readonly inlineError = signal<FolderInlineError | null>(null);
  lastSelected: string | null = null;
  lastCreated: { parentId: string | null; name: string } | null = null;
  lastRenamed: { id: string; name: string } | null = null;
  lastRemoved: string | null = null;
  lastToggled: string | null = null;
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

  /**
   * The `<cdk-tree-node>` host — the REAL keyboard focus target, per
   * `TreeKeyManager`'s roving tabindex. `(keydown)` lives here, not on the
   * inner `folder-row` div, so any spec that exercises Enter/Space/F2/Delete
   * must dispatch on this element, not on `rowFor(id)`. A click test stays on
   * `rowFor(id)` on purpose — the click bubbles up to the node either way.
   */
  function nodeFor(id: string): HTMLElement {
    return rowFor(id).closest<HTMLElement>('[role="treeitem"]')!;
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

  /**
   * The owner rebuilds this view model from scratch on EVERY write —
   * `toFolderTreeNodes` maps fresh objects out of the wire tree — so the array
   * that arrives after a create, a rename, a delete or a rollback reload has
   * the same ids and none of the same object identities. Keying expansion on
   * identity meant the whole tree snapped shut every time, which is worst
   * exactly where it hurts: renaming a folder six levels down.
   */
  it('keeps a node expanded when the tree is re-emitted as new objects with the same ids', () => {
    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-toggle"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();
    expect(rowFor('mate')).not.toBeNull();

    host.nodes.set(structuredClone(TREE));
    fixture.detectChanges();

    expect(rowFor('mate')).not.toBeNull();
    expect(rowFor('colegio').closest('[role="treeitem"]')!.getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('still collapses a node whose id is gone from the re-emitted tree', () => {
    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-toggle"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();

    // The child was deleted server-side: nothing to keep open under it.
    host.nodes.set([{ ...structuredClone(TREE[0]), children: [] }, structuredClone(TREE[1])]);
    fixture.detectChanges();

    expect(rowFor('mate')).toBeNull();
    expect(rowFor('colegio')).not.toBeNull();
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

  it('marks the selected treeitem with aria-selected', () => {
    host.selectedId.set('colegio');
    fixture.detectChanges();
    // `aria-selected` lives on the `cdk-tree-node` (the treeitem) — it
    // belongs on the ARIA role it modifies, not the presentational row div.
    expect(nodeFor('colegio').getAttribute('aria-selected')).toBe('true');
  });

  it('shows the cumulative count next to the name', () => {
    expect(rowFor('colegio').textContent).toContain('42');
  });

  it('renames inline: F2 opens the input, Enter emits rename', () => {
    const treeNode = nodeFor('colegio');
    treeNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
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
    const treeNode = nodeFor('colegio');
    treeNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    element
      .querySelector<HTMLInputElement>('[data-testid="folder-name-input"] input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastRenamed).toBeNull();
    expect(element.querySelector('[data-testid="folder-name-input"]')).toBeNull();
  });

  it('emits remove on the Delete key', () => {
    nodeFor('colegio').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );
    expect(host.lastRemoved).toBe('colegio');
  });

  it('never offers actions on a non-editable node', () => {
    const unfiled = rowFor('unfiled');
    expect(unfiled.querySelector('[data-testid="folder-menu"]')).toBeNull();

    nodeFor('unfiled').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );
    expect(host.lastRemoved).toBeNull();
  });

  it('in pick mode shows no actions and no central count', () => {
    host.mode.set('pick');
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="folder-menu"]')).toBeNull();
    nodeFor('colegio').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
    );
    expect(host.lastRemoved).toBeNull();
    // Selecting still works — picking a folder IS the point of this mode.
    // Click stays on the row div on purpose: it bubbles up to the node,
    // which is where `(click)` now lives.
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

  // --- REGRESSION fix: menu clicks bubbling into (click) on <cdk-tree-node> --
  //
  // Moving (click) up to the node (for the a11y guardian / real keyboard
  // focus fix above) made the node an ANCESTOR of the "Nueva
  // subcarpeta"/"Renombrar"/"Eliminar" popup too — a plain click on any of
  // those buttons started bubbling into folderSelected, so e.g. clicking
  // "Eliminar" both requested removal AND selected the folder.
  it('clicking "Nueva subcarpeta" in the menu does not also select the folder', () => {
    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-menu"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="folder-action-create"]')!.click();
    fixture.detectChanges();

    expect(host.lastSelected).toBeNull();
  });

  // UX fix: creating a subfolder under a COLLAPSED node used to leave the new
  // folder invisible until the teacher separately expanded the parent — the
  // "Nueva subcarpeta" input opened, but nothing showed where it would land.
  it('auto-expands a collapsed node when a subfolder is created under it', () => {
    expect(rowFor('mate')).toBeNull();

    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-menu"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="folder-action-create"]')!.click();
    fixture.detectChanges();

    const item = rowFor('colegio').closest<HTMLElement>('[role="treeitem"]')!;
    expect(item.getAttribute('aria-expanded')).toBe('true');
    expect(rowFor('mate')).not.toBeNull();
  });

  // --- root-level create (item 3: "+ Nueva carpeta") -----------------------
  //
  // There was no way to create a TOP-LEVEL folder from the UI: the tree only
  // ever offered "Nueva subcarpeta" UNDER an existing node. `startCreatingRoot`
  // is the primitive's own public entry point for that — the OWNER (bank-list)
  // calls it from a button that lives above the tree, outside any node's menu.

  function treeInstance(): FolderTreeComponent {
    return fixture.debugElement.query(By.directive(FolderTreeComponent))
      .componentInstance as FolderTreeComponent;
  }

  it('opens a root-level create editor via startCreatingRoot(), independent of any node', () => {
    treeInstance().startCreatingRoot();
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="folder-new-input-root"]')).not.toBeNull();
  });

  it('creates a root folder: Enter in the root editor emits create with parentId null', () => {
    treeInstance().startCreatingRoot();
    fixture.detectChanges();

    const input = element.querySelector<HTMLInputElement>(
      '[data-testid="folder-new-input-root"] input',
    )!;
    input.value = 'Otros';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastCreated).toEqual({ parentId: null, name: 'Otros' });
    expect(element.querySelector('[data-testid="folder-new-input-root"]')).toBeNull();
  });

  it('Escape cancels the root create editor without emitting', () => {
    treeInstance().startCreatingRoot();
    fixture.detectChanges();

    element
      .querySelector<HTMLInputElement>('[data-testid="folder-new-input-root"] input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="folder-new-input-root"]')).toBeNull();
    expect(host.lastCreated).toBeNull();
  });

  it('renders an empty tree without throwing', () => {
    host.nodes.set([]);
    fixture.detectChanges();
    expect(element.querySelectorAll('[data-testid="folder-row"]')).toHaveLength(0);
  });

  // --- Fix round 1 -----------------------------------------------------

  it('does not let Delete inside the rename input bubble to the row (would delete the folder)', () => {
    const treeNode = nodeFor('colegio');
    treeNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    const input = element.querySelector<HTMLInputElement>(
      '[data-testid="folder-name-input"] input',
    )!;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastRemoved).toBeNull();
    expect(element.querySelector('[data-testid="folder-name-input"]')).not.toBeNull();
  });

  it('does not let a second F2 inside the rename input discard the in-progress draft', () => {
    const treeNode = nodeFor('colegio');
    treeNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    const input = element.querySelector<HTMLInputElement>(
      '[data-testid="folder-name-input"] input',
    )!;
    input.value = 'En progreso';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    const stillInput = element.querySelector<HTMLInputElement>(
      '[data-testid="folder-name-input"] input',
    )!;
    expect(stillInput.value).toBe('En progreso');
  });

  it('emits select on Enter when the treeitem is focused and not being edited', () => {
    // Dispatched on the `cdk-tree-node` — the REAL focus target per
    // `TreeKeyManager`'s roving tabindex, not the inner row div. A keystroke
    // dispatched on the div (the old assertion) never proved anything: in a
    // real browser, keyboard focus lands on the node, never on the div.
    nodeFor('colegio').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(host.lastSelected).toBe('colegio');
  });

  it('emits select on Space when the treeitem is focused and not being edited', () => {
    nodeFor('colegio').dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(host.lastSelected).toBe('colegio');
  });

  it('emits toggle when a node is expanded via the keyboard, not just by click', () => {
    document.body.appendChild(fixture.nativeElement);
    try {
      const item = rowFor('colegio').closest<HTMLElement>('[role="treeitem"]')!;
      item.focus();
      item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      fixture.detectChanges();

      expect(host.lastToggled).toBe('colegio');
      expect(rowFor('mate')).not.toBeNull();
    } finally {
      fixture.nativeElement.remove();
    }
  });

  it('flips aria-expanded on the treeitem when a node is toggled', () => {
    const item = rowFor('colegio').closest<HTMLElement>('[role="treeitem"]')!;
    expect(item.getAttribute('aria-expanded')).toBe('false');

    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-toggle"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();

    expect(item.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes the action menu on Escape and returns focus to its trigger', () => {
    document.body.appendChild(fixture.nativeElement);
    try {
      const trigger = element.querySelector<HTMLButtonElement>(
        '[data-testid="folder-menu"][data-folder-id="colegio"]',
      )!;
      trigger.click();
      fixture.detectChanges();

      const menu = element.querySelector('[role="menu"]')!;
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      expect(element.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(trigger);
    } finally {
      fixture.nativeElement.remove();
    }
  });

  it('clicking "Renombrar" in the menu opens inline rename mode', () => {
    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-menu"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="folder-action-rename"]')!.click();
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="folder-name-input"]')).not.toBeNull();
    // REGRESSION fix: it must not ALSO select the folder — see the block above.
    expect(host.lastSelected).toBeNull();
  });

  it('clicking "Eliminar" in the menu emits remove, not also select', () => {
    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-menu"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="folder-action-remove"]')!.click();

    expect(host.lastRemoved).toBe('colegio');
    expect(host.lastSelected).toBeNull();
  });

  it('keeps role="menuitem" on the actual focusable button for each menu action', () => {
    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-menu"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();

    const removeButton = element.querySelector<HTMLButtonElement>(
      '[data-testid="folder-action-remove"]',
    )!;
    expect(removeButton.tagName).toBe('BUTTON');
    expect(removeButton.getAttribute('role')).toBe('menuitem');
  });

  // --- Fix round 2 -----------------------------------------------------

  it('does not emit select on Enter with focus on the toggle chevron (still toggles via the CDK)', () => {
    const toggle = element.querySelector<HTMLButtonElement>(
      '[data-testid="folder-toggle"][data-folder-id="colegio"]',
    )!;
    toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastSelected).toBeNull();
    expect(rowFor('mate')).not.toBeNull();
  });

  it('does not emit select on Enter with focus on the "…" menu trigger, and the menu opens', () => {
    const trigger = element.querySelector<HTMLButtonElement>(
      '[data-testid="folder-menu"][data-folder-id="colegio"]',
    )!;
    trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(host.lastSelected).toBeNull();
    expect(element.querySelector('[role="menu"]')).not.toBeNull();
  });

  // --- inline write errors (Task 10, fix round 1) -----------------------
  //
  // A 409 `folder_name_taken` has to land ON the name the teacher typed —
  // a paragraph above the tree makes her hunt for which of six folders it
  // is about, and closing the editor throws away the text she has to fix.

  function renameTo(id: string, name: string): void {
    nodeFor(id).dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();
    const input = element.querySelector<HTMLInputElement>(
      '[data-testid="folder-name-input"] input',
    )!;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();
  }

  it('keeps the rejected rename open on its own node, marked invalid, with the typed name intact', () => {
    renameTo('colegio', 'Sin carpeta');
    host.inlineError.set({ id: 'colegio', message: 'Ya existe una carpeta con ese nombre' });
    fixture.detectChanges();

    const wrapper = element.querySelector('[data-testid="folder-name-input"]')!;
    const input = wrapper.querySelector<HTMLInputElement>('input')!;
    expect(input.value).toBe('Sin carpeta');
    expect(input.getAttribute('aria-invalid')).toBe('true');

    const message = wrapper.querySelector('[data-testid="input-error"]')!;
    expect(message.textContent).toContain('Ya existe una carpeta con ese nombre');
    // The message is what `aria-describedby` points at, not merely adjacent text.
    expect(input.getAttribute('aria-describedby')).toBe(message.getAttribute('id'));
  });

  it('closes the editor once the next commit is accepted', () => {
    renameTo('colegio', 'Sin carpeta');
    host.inlineError.set({ id: 'colegio', message: 'Ya existe una carpeta con ese nombre' });
    fixture.detectChanges();

    const input = element.querySelector<HTMLInputElement>(
      '[data-testid="folder-name-input"] input',
    )!;
    input.value = 'Colegio corregido';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    host.inlineError.set(null);
    fixture.detectChanges();

    expect(host.lastRenamed).toEqual({ id: 'colegio', name: 'Colegio corregido' });
    expect(element.querySelector('[data-testid="folder-name-input"]')).toBeNull();
  });

  it('Escape abandons the edit even while the inline error is showing', () => {
    renameTo('colegio', 'Sin carpeta');
    host.inlineError.set({ id: 'colegio', message: 'Ya existe una carpeta con ese nombre' });
    fixture.detectChanges();

    element
      .querySelector<HTMLInputElement>('[data-testid="folder-name-input"] input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="folder-name-input"]')).toBeNull();
  });

  it('keeps a rejected NEW subfolder open under its parent, with its own message', () => {
    element
      .querySelector<HTMLButtonElement>('[data-testid="folder-menu"][data-folder-id="colegio"]')!
      .click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('[data-testid="folder-action-create"]')!.click();
    fixture.detectChanges();

    const input = element.querySelector<HTMLInputElement>(
      '[data-testid="folder-new-input"] input',
    )!;
    input.value = 'Matemática';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    host.inlineError.set({ id: 'colegio', message: 'Ya existe una carpeta con ese nombre' });
    fixture.detectChanges();

    const wrapper = element.querySelector('[data-testid="folder-new-input"]')!;
    expect(wrapper.querySelector<HTMLInputElement>('input')!.value).toBe('Matemática');
    expect(wrapper.querySelector('[data-testid="input-error"]')!.textContent).toContain(
      'Ya existe una carpeta con ese nombre',
    );
    // The rename editor of that same node must NOT open — the two editors
    // share a node id, only the one that was submitted comes back.
    expect(element.querySelector('[data-testid="folder-name-input"]')).toBeNull();
  });

  it('ignores an inline error aimed at a node this tree was not editing', () => {
    renameTo('colegio', 'Sin carpeta');
    host.inlineError.set({ id: 'mate', message: 'Ya existe una carpeta con ese nombre' });
    fixture.detectChanges();

    expect(element.querySelector('[data-testid="folder-name-input"]')).toBeNull();
    expect(element.querySelector('[data-testid="input-error"]')).toBeNull();
  });

  // --- CRITICAL fix: outputs renamed off native DOM event names -----------
  //
  // `select` collided with the native `select` event, which a text `<input>`
  // fires (and bubbles) whenever the user selects text inside it — including
  // the inline rename input this same primitive renders. A consumer bound to
  // `(select)="onFolderSelect($event)"` could receive that bubbled native
  // `Event` instead of a folder id. Renaming to `folderSelected`/
  // `expandedChange` removes the collision outright; this locks in that a
  // native `select` event reaching the host never reaches the renamed output.
  it('does not let a native "select" event bubbled from the rename input reach folderSelected', () => {
    const treeNode = nodeFor('colegio');
    treeNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', bubbles: true }));
    fixture.detectChanges();

    const input = element.querySelector<HTMLInputElement>(
      '[data-testid="folder-name-input"] input',
    )!;
    input.dispatchEvent(new Event('select', { bubbles: true }));
    fixture.detectChanges();

    expect(host.lastSelected).toBeNull();
  });
});

// --- CRITICAL fix: the primitive provides its own Lucide icons -----------
//
// `ui-folder-tree` used to import `LucideAngularModule` without ever calling
// `.pick(...)` — it rendered correctly ONLY when an ancestor happened to pick
// `chevron-down`/`chevron-right`/`more-horizontal` (bank-list does, by
// coincidence). Mounted anywhere that doesn't — `/app/bank/new`'s folder
// popover — the toggle threw `The "chevron-right" icon has not been
// provided`. A SEPARATE `describe`/TestBed here is the point: it must NOT
// inherit the outer suite's `LucideAngularModule.pick(...)`, or this test
// would pass for the wrong reason.
@Component({
  standalone: true,
  imports: [FolderTreeComponent],
  template: `<ui-folder-tree [nodes]="nodes()"></ui-folder-tree>`,
})
class BareHostComponent {
  readonly nodes = signal<readonly FolderTreeNode[]>(TREE);
}

describe('FolderTreeComponent (standalone icon provisioning)', () => {
  it('renders the toggle icon with no ancestor picking Lucide icons', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    TestBed.configureTestingModule({ imports: [BareHostComponent] });
    const fixture = TestBed.createComponent(BareHostComponent);
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;

    const toggle = element.querySelector('[data-testid="folder-toggle"]');
    expect(toggle?.querySelector('svg')).not.toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
  });
});
