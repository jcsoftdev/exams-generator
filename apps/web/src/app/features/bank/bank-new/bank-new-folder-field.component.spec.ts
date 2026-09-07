import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { BankNewFolderFieldComponent } from './bank-new-folder-field.component';

const NODES: FolderTreeNode[] = [
  {
    id: 'trigo',
    name: 'Trigonometría',
    topicId: 't1',
    ownCount: 2,
    centralCount: 0,
    totalCount: 2,
    editable: true,
    children: [],
  },
  {
    id: UNFILED_FOLDER_ID,
    name: 'Sin carpeta',
    topicId: null,
    ownCount: 3,
    centralCount: 0,
    totalCount: 3,
    editable: false,
    children: [],
  },
];

@Component({
  standalone: true,
  imports: [BankNewFolderFieldComponent],
  template: `
    <app-bank-new-folder-field
      idPrefix="photo"
      [value]="value()"
      [nodes]="nodes()"
      [loading]="loading()"
      [mismatch]="mismatch()"
      [creating]="creating()"
      [createError]="createError()"
      (valueChange)="onValueChange($event)"
      (createRequested)="onCreateRequested($event)"
    ></app-bank-new-folder-field>
  `,
})
class HostComponent {
  readonly value = signal<string | null>(null);
  readonly nodes = signal<readonly FolderTreeNode[]>(NODES);
  readonly loading = signal(false);
  readonly mismatch = signal(false);
  readonly creating = signal(false);
  readonly createError = signal<string | null>(null);
  readonly onValueChange = vi.fn<(value: string | null) => void>();
  readonly onCreateRequested =
    vi.fn<(request: { parentId: string | null; name: string }) => void>();
}

function setup() {
  TestBed.configureTestingModule({ imports: [HostComponent] });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;
  const root = () => compiled.querySelector('[data-testid="folder-field-photo"]') as HTMLElement;
  const trigger = () => root().querySelector('button') as HTMLButtonElement;
  const openPicker = () => {
    trigger().click();
    fixture.detectChanges();
  };
  return { fixture, host: fixture.componentInstance, compiled, root, trigger, openPicker };
}

describe('BankNewFolderFieldComponent', () => {
  it('names the field by its idPrefix so both tabs can mount one without colliding', () => {
    const { root } = setup();

    expect(root()).not.toBeNull();
  });

  it('shows "Sin carpeta" with no value, and the folder name once one is picked', () => {
    const { fixture, host, trigger } = setup();
    expect(trigger().textContent?.trim()).toBe('Sin carpeta');

    host.value.set('trigo');
    fixture.detectChanges();

    expect(trigger().textContent?.trim()).toBe('Trigonometría');
  });

  it('gives the trigger a dialog-shaped, labelled accessible name', () => {
    const { root, trigger, openPicker } = setup();
    const label = root().querySelector('[data-testid="folder-field-photo-label"]')!;

    expect(label.textContent?.trim()).toBe('Carpeta');
    expect(trigger().getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    // The name a screen reader reads out is "Carpeta" + the current value.
    expect(trigger().getAttribute('aria-labelledby')).toBe(
      `${label.id} ${trigger().id}`.replace('  ', ' '),
    );

    openPicker();
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(
      root().querySelector('[role="dialog"]')!.id,
    );
  });

  it('moves focus into the popover on open so Escape works immediately', () => {
    const { root, openPicker } = setup();

    openPicker();

    const dialog = root().querySelector('[role="dialog"]') as HTMLElement;
    expect(dialog.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(dialog);
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const { fixture, root, trigger, openPicker } = setup();
    openPicker();

    (root().querySelector('[role="dialog"]') as HTMLElement).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();

    expect(root().querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('emits the picked folder id and closes', () => {
    const { fixture, host, root, openPicker } = setup();
    openPicker();

    (root().querySelector('[data-folder-id="trigo"]') as HTMLElement).click();
    fixture.detectChanges();

    expect(host.onValueChange).toHaveBeenCalledWith('trigo');
    expect(root().querySelector('[role="dialog"]')).toBeNull();
  });

  it('emits null for the virtual "Sin carpeta" node — it is a view, never a folder id on the wire', () => {
    const { fixture, host, root, openPicker } = setup();
    openPicker();

    (root().querySelector(`[data-folder-id="${UNFILED_FOLDER_ID}"]`) as HTMLElement).click();
    fixture.detectChanges();

    expect(host.onValueChange).toHaveBeenCalledWith(null);
  });

  it('shows the mismatch hint only when the owner says the topic disagrees', () => {
    const { fixture, host, root } = setup();
    expect(root().querySelector('[data-testid="folder-topic-mismatch-photo"]')).toBeNull();

    host.mismatch.set(true);
    fixture.detectChanges();

    expect(
      root().querySelector('[data-testid="folder-topic-mismatch-photo"]')!.textContent,
    ).toContain('El Tema no coincide con la carpeta');
  });

  it('says the tree is still loading instead of showing an empty popover', () => {
    const { fixture, host, root, openPicker } = setup();
    host.nodes.set([]);
    host.loading.set(true);
    fixture.detectChanges();

    openPicker();

    expect(
      root().querySelector('[data-testid="folder-field-photo-loading"]')?.textContent,
    ).toContain('Cargando carpetas…');
  });

  describe('creating a folder without leaving the form', () => {
    /** Opens the picker, then its inline "Nueva carpeta" editor. */
    function openCreator(t: ReturnType<typeof setup>): HTMLInputElement {
      t.openPicker();
      (t.root().querySelector('[data-testid="folder-create-photo"]') as HTMLElement).click();
      t.fixture.detectChanges();
      return t
        .root()
        .querySelector('[data-testid="folder-create-name-photo"] input') as HTMLInputElement;
    }

    function submit(t: ReturnType<typeof setup>, name: string): void {
      const input = openCreator(t);
      input.value = name;
      input.dispatchEvent(new Event('input'));
      t.fixture.detectChanges();
      t.root()
        .querySelector('[data-testid="folder-create-name-photo"]')!
        .dispatchEvent(new Event('submit'));
      t.fixture.detectChanges();
    }

    it('asks the owner to create the folder at the root when nothing is picked', () => {
      const t = setup();

      submit(t, 'Repaso');

      expect(t.host.onCreateRequested).toHaveBeenCalledWith({ parentId: null, name: 'Repaso' });
    });

    it('creates UNDER the folder currently picked, which is the one she is filing into', () => {
      const t = setup();
      t.host.value.set('trigo');
      t.fixture.detectChanges();

      submit(t, 'Identidades');

      expect(t.host.onCreateRequested).toHaveBeenCalledWith({
        parentId: 'trigo',
        name: 'Identidades',
      });
    });

    it('treats the unfiled bucket as the root, never as a parent', () => {
      const t = setup();
      t.host.value.set(UNFILED_FOLDER_ID);
      t.fixture.detectChanges();

      submit(t, 'Repaso');

      expect(t.host.onCreateRequested).toHaveBeenCalledWith({ parentId: null, name: 'Repaso' });
    });

    it('refuses a blank name rather than asking for an untitled folder', () => {
      const t = setup();

      submit(t, '   ');

      expect(t.host.onCreateRequested).not.toHaveBeenCalled();
    });

    it('keeps the name on screen while the owner is saving it', () => {
      const t = setup();
      submit(t, 'Repaso');

      t.host.creating.set(true);
      t.fixture.detectChanges();

      expect(t.root().querySelector('[data-testid="folder-create-name-photo"]')).not.toBeNull();
    });

    it('closes the editor once the owner reports the folder saved', () => {
      const t = setup();
      submit(t, 'Repaso');
      t.host.creating.set(true);
      t.fixture.detectChanges();

      t.host.creating.set(false);
      t.fixture.detectChanges();

      expect(t.root().querySelector('[data-testid="folder-create-name-photo"]')).toBeNull();
    });

    it('keeps the editor open with the name intact when the save is refused', () => {
      const t = setup();
      submit(t, 'Repaso');
      t.host.creating.set(true);
      t.fixture.detectChanges();

      t.host.createError.set('Ya existe una carpeta con ese nombre.');
      t.host.creating.set(false);
      t.fixture.detectChanges();

      const input = t
        .root()
        .querySelector('[data-testid="folder-create-name-photo"] input') as HTMLInputElement;
      expect(input.value).toBe('Repaso');
      expect(
        t.root().querySelector('[data-testid="folder-create-error-photo"]')?.textContent?.trim(),
      ).toBe('Ya existe una carpeta con ese nombre.');
    });
  });
});
