import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FolderPlus, LucideAngularModule, MoreVertical, Pencil, Trash2 } from 'lucide-angular';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { GLYPH_ICONS, glyphFor } from '../folders/folder-glyph';

/**
 * One of the school's folders, drawn as a card in the bank grid.
 *
 * Deliberately NOT a folder icon: the teacher is looking for a subject, not
 * for file-manager furniture, so the tile carries a subject glyph and the
 * card leads with the name. The two counts are the ones the API already
 * sends per folder — `ownCount` is what this school wrote, `centralCount`
 * what the shared bank contributes through the folder's topic.
 *
 * Presentational only: it never reads the store and never navigates, it
 * emits. The outputs are NOT called `select`, `rename` or `remove` where a
 * native DOM name would clash — Angular refuses an output named after a
 * native event, a gotcha this codebase already paid for once.
 *
 * The "⋮" menu is a SIBLING of the card button, never a descendant: a button
 * inside a button is invalid HTML, and browsers resolve it by dropping the
 * inner one, which would take rename and delete with it.
 */
@Component({
  selector: 'bank-folder-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    LucideAngularModule.pick({ ...GLYPH_ICONS, FolderPlus, MoreVertical, Pencil, Trash2 })
      .providers ?? [],
  ],
  template: `
    <div class="relative">
      <button
        type="button"
        data-testid="folder-card"
        [attr.data-variant]="variant()"
        class="flex w-full flex-col gap-3 rounded-card p-4 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
        [class.border]="true"
        [class.border-n200]="node().editable"
        [class.bg-surface]="node().editable"
        [class.hover:border-primary-300]="node().editable"
        [class.hover:bg-primary-50]="node().editable"
        [class.border-dashed]="!node().editable"
        [class.border-n300]="!node().editable"
        [class.bg-n50]="!node().editable"
        [class.hover:bg-n100]="!node().editable"
        (click)="open.emit(node().id)"
      >
        <span
          aria-hidden="true"
          data-testid="card-glyph"
          [attr.data-glyph]="glyph()"
          class="flex h-10 w-10 items-center justify-center rounded-field"
          [class.bg-primary-50]="node().editable"
          [class.text-tint-text]="node().editable"
          [class.bg-n100]="!node().editable"
          [class.text-n600]="!node().editable"
        >
          <lucide-angular [name]="glyph()" class="h-5 w-5"></lucide-angular>
        </span>

        <span class="flex flex-col gap-0.5">
          @if (trail().length > 0) {
            <span data-testid="card-trail" class="text-[12px] text-n500">{{ trailLabel() }}</span>
          }
          <span class="text-[15px] font-semibold text-n900">{{ node().name }}</span>
          @if (node().editable) {
            <span data-testid="card-children" class="text-[13px] text-n600">{{
              childrenLabel()
            }}</span>
          } @else {
            <span class="text-[13px] text-n600">Preguntas que aún no tienen carpeta</span>
          }
        </span>

        <span class="flex items-center gap-1.5 border-t border-n100 pt-2.5 text-xs text-n600">
          <span data-testid="card-own">
            <span class="font-semibold text-n700">{{ node().ownCount }}</span> propias
          </span>
          @if (node().centralCount > 0) {
            <span aria-hidden="true" class="text-n300">·</span>
            <span data-testid="card-central">
              <span class="font-semibold text-n700">{{ node().centralCount }}</span> del banco
            </span>
          }
        </span>
      </button>

      @if (node().editable) {
        <button
          type="button"
          data-testid="card-menu"
          [attr.data-folder-id]="node().id"
          [attr.aria-expanded]="menuOpen()"
          [attr.aria-label]="'Acciones de ' + node().name"
          aria-haspopup="menu"
          class="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-field text-n600 hover:bg-n100 hover:text-n900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
          (click)="toggleMenu()"
        >
          <lucide-angular name="more-vertical" class="h-4 w-4"></lucide-angular>
        </button>
      }

      @if (menuOpen()) {
        <div
          role="menu"
          data-testid="card-menu-items"
          class="absolute right-2 top-11 z-10 flex w-48 flex-col rounded-card border border-n200 bg-surface py-1 shadow-lg"
          (keydown.escape)="closeMenu()"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="card-menu-subfolder"
            [class]="menuItemClasses()"
            (click)="requestSubfolder()"
          >
            <lucide-angular name="folder-plus" class="h-4 w-4"></lucide-angular>
            Nueva subcarpeta
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="card-menu-rename"
            [class]="menuItemClasses()"
            (click)="startRename()"
          >
            <lucide-angular name="pencil" class="h-4 w-4"></lucide-angular>
            Renombrar
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="card-menu-delete"
            [class]="menuItemClasses(true)"
            (click)="requestRemove()"
          >
            <lucide-angular name="trash-2" class="h-4 w-4"></lucide-angular>
            Eliminar
          </button>
        </div>
      }

      @if (renaming()) {
        <form
          data-testid="card-rename-form"
          class="absolute inset-x-2 bottom-2 top-auto"
          (submit)="submitRename($event)"
        >
          <label class="sr-only" [attr.for]="renameInputId">Nombre de la carpeta</label>
          <input
            data-testid="card-rename-input"
            [id]="renameInputId"
            class="w-full rounded-field border border-primary-300 bg-surface px-2 py-1 text-sm text-n900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-300"
            [value]="draftName()"
            (input)="draftName.set($any($event.target).value)"
            (keydown)="onRenameKeydown($event)"
          />
        </form>
      }
    </div>
  `,
})
export class BankFolderCardComponent {
  private static instanceCounter = 0;

  readonly node = input.required<FolderTreeNode>();

  /**
   * Where this folder lives, relative to the level being browsed. Empty in the
   * grid itself, where every card is a direct child and the breadcrumb already
   * says where they are; filled in for a search result, which may come from
   * anywhere below and would otherwise be a name with no address.
   */
  readonly trail = input<readonly string[]>([]);

  /** The id of the folder the teacher asked to open. */
  readonly open = output<string>();

  /** The folder's new name, already trimmed and known to differ from the old one. */
  readonly renamed = output<string>();

  /** The id of the folder a new subfolder should hang under. */
  readonly subfolderRequested = output<string>();

  /** The id of the folder the teacher asked to remove — asking only; the parent confirms. */
  readonly removeRequested = output<string>();

  protected readonly renameInputId = `bank-folder-rename-${BankFolderCardComponent.instanceCounter++}`;

  protected readonly menuOpen = signal(false);
  protected readonly renaming = signal(false);
  protected readonly draftName = signal('');

  /**
   * "Sin carpeta" arrives as a node with `editable: false`. It is a view over
   * `folder_id IS NULL`, not a folder — it cannot be renamed, moved or
   * deleted — so it is drawn apart rather than inviting actions that would
   * fail, and it carries no menu at all.
   */
  protected readonly variant = computed(() => (this.node().editable ? 'folder' : 'unfiled'));

  /**
   * The subject the folder is about, read off its name — never a folder icon,
   * which is exactly the file-manager furniture the grid took out. The unfiled
   * bucket is not a subject, so it keeps the mark that says it is a leftover.
   */
  protected readonly glyph = computed(() =>
    this.node().editable ? glyphFor(this.node().name) : 'help-circle',
  );

  protected readonly trailLabel = computed(() => this.trail().join(' › '));

  protected readonly childrenLabel = computed(() => {
    const count = this.node().children.length;
    if (count === 0) return 'Sin subcarpetas';
    return count === 1 ? '1 tema' : `${count} temas`;
  });

  /**
   * One class string for the three items rather than three copies. Raw
   * `<button role="menuitem">` on purpose, as in `ui-folder-tree`: the ARIA
   * menu pattern wants the role and the focus target to be the same element,
   * which a wrapper component would split.
   */
  protected menuItemClasses(danger = false): string {
    return [
      'flex items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-n50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-300',
      danger ? 'text-hard-text' : 'text-n700',
    ].join(' ');
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    this.menuOpen.set(false);
  }

  protected requestSubfolder(): void {
    this.closeMenu();
    this.subfolderRequested.emit(this.node().id);
  }

  protected requestRemove(): void {
    this.closeMenu();
    this.removeRequested.emit(this.node().id);
  }

  protected startRename(): void {
    this.closeMenu();
    this.draftName.set(this.node().name);
    this.renaming.set(true);
  }

  /** Escape abandons the editor — the same gesture the rest of the bank uses. */
  protected onRenameKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.renaming.set(false);
    }
  }

  /**
   * A blank name is a no-op rather than an unnamed folder, and a name that did
   * not change is not a rename: firing one would cost a round-trip and could
   * come back as `folder_name_taken` against the folder itself.
   */
  protected submitRename(event: Event): void {
    event.preventDefault();
    const name = this.draftName().trim();
    this.renaming.set(false);
    if (name === '' || name === this.node().name) {
      return;
    }
    this.renamed.emit(name);
  }
}
