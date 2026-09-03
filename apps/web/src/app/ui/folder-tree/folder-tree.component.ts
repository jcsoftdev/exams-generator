import { CdkTreeModule } from '@angular/cdk/tree';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { InputComponent } from '../input/input.component';
import {
  FolderCreateEvent,
  FolderRenameEvent,
  FolderTreeMode,
  FolderTreeNode,
} from './folder-tree.types';

/**
 * Design-system folder tree, built on `@angular/cdk/tree` with
 * `childrenAccessor` (the data already arrives nested, so there is nothing to
 * flatten). Presentational: it renders nodes and emits intent, it never calls
 * an HTTP service and never mutates the array it is given.
 *
 * ACCESSIBILITY COMES FROM THE CDK and must not be re-implemented here:
 * `role="tree"`/`role="treeitem"`, `aria-level`, `aria-expanded`, arrow-key
 * navigation, Home/End and — critically — `tabindex` management via
 * `TreeKeyManager`. Never set `tabindex` on a node by hand; the key manager
 * owns it and a manual value fights it. What this component adds on top is the
 * part the CDK cannot know: a Spanish `aria-label` on the toggle ("Expandir
 * Matemática"), `aria-selected` on the row, and F2/Delete as shortcuts for
 * rename/remove.
 *
 * Hierarchy is drawn with indentation plus one faint vertical guide per level —
 * no nested cards (design doc, "Dirección visual").
 */
@Component({
  selector: 'ui-folder-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkTreeModule, InputComponent, LucideAngularModule],
  template: `
    <cdk-tree
      #tree
      [dataSource]="mutableNodes()"
      [childrenAccessor]="childrenAccessor"
      class="block"
    >
      <cdk-tree-node
        *cdkTreeNodeDef="let node"
        [isExpandable]="node.children.length > 0"
        (expandedChange)="onExpandedChange(node)"
        class="block"
      >
        <div
          data-testid="folder-row"
          [attr.data-folder-id]="node.id"
          [attr.aria-selected]="node.id === selectedId() ? 'true' : 'false'"
          class="group flex cursor-pointer items-center gap-1 rounded-field px-2 py-1.5 text-sm transition-colors hover:bg-n50"
          [class.bg-tint-active]="node.id === selectedId()"
          (click)="onSelect(node)"
          (keydown)="onRowKeydown($event, node)"
        >
          @if (node.children.length > 0) {
            <button
              type="button"
              cdkTreeNodeToggle
              data-testid="folder-toggle"
              [attr.data-folder-id]="node.id"
              [attr.aria-label]="(tree.isExpanded(node) ? 'Colapsar ' : 'Expandir ') + node.name"
              class="shrink-0 rounded p-0.5 text-n500 hover:text-n700 focus:outline-none focus:ring-2 focus:ring-primary-300"
              (click)="$event.stopPropagation()"
            >
              <lucide-angular
                [name]="tree.isExpanded(node) ? 'chevron-down' : 'chevron-right'"
                class="h-4 w-4"
              ></lucide-angular>
            </button>
          } @else {
            <span class="w-5 shrink-0" aria-hidden="true"></span>
          }

          @if (editingId() === node.id) {
            <!--
              Stops ANY keydown from reaching the row's onRowKeydown while
              editing — Critical fix (review round 1): Delete/F2 typed here
              used to bubble up and delete the folder / discard the draft.
            -->
            <div
              data-testid="folder-name-input"
              class="flex-1"
              (keydown)="$event.stopPropagation()"
            >
              <ui-input
                [value]="draftName()"
                (valueChange)="draftName.set($event)"
                (keydown.enter)="commitRename(node)"
                (keydown.escape)="cancelEditing()"
              ></ui-input>
            </div>
          } @else {
            <span class="flex-1 truncate text-n800">{{ node.name }}</span>
            <span class="shrink-0 text-xs text-n500">{{ node.totalCount }}</span>
          }

          @if (mode() === 'browse' && node.editable && editingId() !== node.id) {
            <button
              type="button"
              data-testid="folder-menu"
              [attr.data-folder-id]="node.id"
              aria-haspopup="menu"
              [attr.aria-expanded]="menuFor() === node.id"
              [attr.aria-label]="'Acciones de ' + node.name"
              class="shrink-0 rounded p-0.5 text-n400 opacity-0 transition-opacity hover:text-n700 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary-300 group-hover:opacity-100"
              (click)="toggleMenu($event, node)"
            >
              <lucide-angular name="more-horizontal" class="h-4 w-4"></lucide-angular>
            </button>
          }
        </div>

        @if (menuFor() === node.id) {
          <div role="menu" class="ml-8 flex gap-2 py-1 text-xs" (keydown.escape)="closeMenu(node)">
            <button
              type="button"
              role="menuitem"
              data-testid="folder-action-create"
              [class]="menuItemClasses()"
              (click)="startCreating(node)"
            >
              Nueva subcarpeta
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="folder-action-rename"
              [class]="menuItemClasses()"
              (click)="startEditing(node)"
            >
              Renombrar
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="folder-action-remove"
              [class]="menuItemClasses(true)"
              (click)="requestRemove(node)"
            >
              Eliminar
            </button>
          </div>
        }

        @if (creatingUnder() === node.id) {
          <div
            data-testid="folder-new-input"
            class="ml-8 py-1"
            (keydown)="$event.stopPropagation()"
          >
            <ui-input
              placeholder="Nombre de la carpeta"
              [value]="draftName()"
              (valueChange)="draftName.set($event)"
              (keydown.enter)="commitCreate(node)"
              (keydown.escape)="cancelEditing()"
            ></ui-input>
          </div>
        }

        <!-- Children render here, and only while the node is expanded. -->
        <div class="ml-4 border-l border-n200 pl-1">
          <ng-container cdkTreeNodeOutlet></ng-container>
        </div>
      </cdk-tree-node>
    </cdk-tree>
  `,
})
export class FolderTreeComponent {
  readonly nodes = input<readonly FolderTreeNode[]>([]);
  readonly selectedId = input<string | null>(null);
  readonly mode = input<FolderTreeMode>('browse');

  readonly select = output<string>();
  readonly toggle = output<string>();
  readonly create = output<FolderCreateEvent>();
  readonly rename = output<FolderRenameEvent>();
  readonly remove = output<string>();

  /** Which node is being renamed inline, and which is having a child created under it. Never both. */
  protected readonly editingId = signal<string | null>(null);
  protected readonly creatingUnder = signal<string | null>(null);
  protected readonly menuFor = signal<string | null>(null);
  protected readonly draftName = signal('');

  /** Actions are gone in `pick` mode and on the virtual "Sin carpeta" node. */
  protected readonly actionsEnabled = computed(() => this.mode() === 'browse');

  /**
   * `CdkTree`'s generics want a mutable `T[]`, not the `readonly T[]` this
   * primitive's own contract promises callers (it never mutates what it is
   * given). The cast is confined to this boundary — `nodes()` itself, and
   * every method in this class, keeps treating the array as read-only.
   */
  protected readonly mutableNodes = computed(() => this.nodes() as FolderTreeNode[]);

  /**
   * CdkTree requires exactly one accessor; the data is already nested, so it
   * is this one. Cast for the same reason as `mutableNodes` above — `T[]`,
   * not `readonly T[]`, at this one boundary only.
   */
  protected readonly childrenAccessor = (node: FolderTreeNode): FolderTreeNode[] =>
    node.children as FolderTreeNode[];

  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  /**
   * Review round 1, Important #2: the three text-labelled menu actions were
   * meant to use `ui-button` (ghost/danger variants), but `ButtonComponent`
   * renders its real interactive `<button>` inside its OWN template — a
   * static `role="menuitem"` placed on `<ui-button>` lands on the outer
   * custom-element host, not on the focusable inner `<button>`, which breaks
   * the WAI-ARIA menu pattern (role and focus target must be the same
   * element). `ui-button` has no `[attr.role]` pass-through to fix that
   * without changing the shared primitive itself, which is out of scope
   * here. Kept as raw `<button role="menuitem">`, sharing one class
   * constant so the visual language still matches `ui-button`'s ghost/danger
   * variants (mirrors `ButtonComponent.classes()`'s own BASE + variant
   * pattern).
   */
  private static readonly MENU_ITEM_BASE =
    'rounded-field px-2 py-1 text-left text-tint-text hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-300';
  private static readonly MENU_ITEM_DANGER = 'text-hard-text hover:opacity-90';

  protected menuItemClasses(danger = false): string {
    return danger
      ? `${FolderTreeComponent.MENU_ITEM_BASE} ${FolderTreeComponent.MENU_ITEM_DANGER}`
      : FolderTreeComponent.MENU_ITEM_BASE;
  }

  protected onSelect(node: FolderTreeNode): void {
    this.select.emit(node.id);
  }

  /**
   * Bound to `CdkTreeNode`'s `(expandedChange)` (review round 1, Important
   * #3) rather than the toggle button's `(click)` — `expandedChange` fires
   * for BOTH the mouse click (via `cdkTreeNodeToggle`) and keyboard-driven
   * expansion (ArrowRight/ArrowLeft through the CDK's `TreeKeyManager`), so
   * `toggle` now reflects every way a node can expand or collapse, not just
   * the mouse. Emits only the id, matching this primitive's frozen contract
   * (`toggle: OutputEmitterRef<string>`).
   */
  protected onExpandedChange(node: FolderTreeNode): void {
    this.toggle.emit(node.id);
  }

  /**
   * F2 renames, Delete removes, Enter/Space select — shortcuts on top of the
   * CDK's own arrow/Home/End navigation.
   *
   * Critical fix (review round 1): this guard used to be reachable from the
   * rename/create `<ui-input>`, whose keydown events bubble up through this
   * same row — pressing Delete while renaming deleted the folder, and a
   * second F2 reset the in-progress draft. The inputs now `stopPropagation`
   * on their own wrapper so this handler never even runs for them; this
   * early return is a second line of defense in case that wrapper ever moves.
   */
  protected onRowKeydown(event: KeyboardEvent, node: FolderTreeNode): void {
    if (this.editingId() === node.id || this.creatingUnder() === node.id) {
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.onSelect(node);
      return;
    }
    if (!this.actionsEnabled() || !node.editable) {
      return;
    }
    if (event.key === 'F2') {
      event.preventDefault();
      this.startEditing(node);
    } else if (event.key === 'Delete') {
      event.preventDefault();
      this.requestRemove(node);
    }
  }

  protected toggleMenu(event: Event, node: FolderTreeNode): void {
    event.stopPropagation();
    this.menuFor.update((current) => (current === node.id ? null : node.id));
  }

  /** Minor fix (review round 1): Escape closes the action menu and returns focus to its trigger. */
  protected closeMenu(node: FolderTreeNode): void {
    this.menuFor.set(null);
    this.elementRef.nativeElement
      .querySelector<HTMLButtonElement>(`[data-testid="folder-menu"][data-folder-id="${node.id}"]`)
      ?.focus();
  }

  protected startEditing(node: FolderTreeNode): void {
    this.menuFor.set(null);
    this.creatingUnder.set(null);
    this.draftName.set(node.name);
    this.editingId.set(node.id);
  }

  protected startCreating(node: FolderTreeNode): void {
    this.menuFor.set(null);
    this.editingId.set(null);
    this.draftName.set('');
    this.creatingUnder.set(node.id);
  }

  protected cancelEditing(): void {
    this.editingId.set(null);
    this.creatingUnder.set(null);
    this.draftName.set('');
  }

  /** A blank name is a cancel, not a request — the server would 422 it anyway. */
  protected commitRename(node: FolderTreeNode): void {
    const name = this.draftName().trim();
    if (name && name !== node.name) {
      this.rename.emit({ id: node.id, name });
    }
    this.cancelEditing();
  }

  protected commitCreate(node: FolderTreeNode): void {
    const name = this.draftName().trim();
    if (name) {
      this.create.emit({ parentId: node.id, name });
    }
    this.cancelEditing();
  }

  protected requestRemove(node: FolderTreeNode): void {
    this.menuFor.set(null);
    this.remove.emit(node.id);
  }
}
