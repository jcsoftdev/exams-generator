import { CdkTreeModule } from '@angular/cdk/tree';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
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
      <cdk-tree-node *cdkTreeNodeDef="let node" class="block">
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
              (click)="onToggleClick($event, node)"
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
            <div data-testid="folder-name-input" class="flex-1">
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
          <div role="menu" class="ml-8 flex gap-2 py-1 text-xs">
            <button
              type="button"
              role="menuitem"
              data-testid="folder-action-create"
              class="underline"
              (click)="startCreating(node)"
            >
              Nueva subcarpeta
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="folder-action-rename"
              class="underline"
              (click)="startEditing(node)"
            >
              Renombrar
            </button>
            <button
              type="button"
              role="menuitem"
              data-testid="folder-action-remove"
              class="underline text-hard-text"
              (click)="requestRemove(node)"
            >
              Eliminar
            </button>
          </div>
        }

        @if (creatingUnder() === node.id) {
          <div data-testid="folder-new-input" class="ml-8 py-1">
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

  /** CdkTree requires exactly one accessor; the data is already nested, so it is this one. */
  protected readonly childrenAccessor = (node: FolderTreeNode): FolderTreeNode[] =>
    node.children as FolderTreeNode[];

  protected onSelect(node: FolderTreeNode): void {
    this.select.emit(node.id);
  }

  /**
   * `cdkTreeNodeToggle` already drives the expand/collapse state through the
   * CDK's `TreeKeyManager` — this handler only stops the click from also
   * reaching the row's `onSelect`, and tells the outside world (e.g. a
   * caller persisting which folders are open) which node just toggled.
   */
  protected onToggleClick(event: Event, node: FolderTreeNode): void {
    event.stopPropagation();
    this.toggle.emit(node.id);
  }

  /**
   * F2 renames, Delete removes — the two shortcuts the spec asks for on top of
   * the CDK's own arrow/Home/End navigation. Guarded by the same rule as the
   * menu: nothing mutating in `pick` mode, nothing at all on a non-editable node.
   */
  protected onRowKeydown(event: KeyboardEvent, node: FolderTreeNode): void {
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
