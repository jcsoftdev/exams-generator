import { CdkTree, CdkTreeModule } from '@angular/cdk/tree';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  output,
  signal,
  TrackByFunction,
  viewChild,
} from '@angular/core';
import { ChevronDown, ChevronRight, LucideAngularModule, MoreHorizontal } from 'lucide-angular';
import { InputComponent } from '../input/input.component';
import {
  FolderCreateEvent,
  FolderInlineError,
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
 * Matemática"), `aria-selected` on the treeitem, and F2/Delete as shortcuts
 * for rename/remove.
 *
 * CRITICAL fix: `(click)`/`(keydown)` live on `<cdk-tree-node>` itself, NOT on
 * the inner `.folder-row` div. `TreeKeyManager` (the CDK's roving-tabindex
 * controller) focuses the `cdk-tree-node` host — that element carries the
 * real `tabindex`/`role="treeitem"` — so a keyboard Enter/Space/F2/Delete
 * fires ITS keydown, not the inner div's. A `(keydown)` on the div only ever
 * looked correct because the old spec dispatched events directly on the div,
 * bypassing the CDK's actual focus target entirely; a real keyboard user's
 * keystroke would bubble UP past the div (it was never the target) and never
 * reach the handler. The inner div stays purely presentational — no
 * `role`/`tabindex`/keyboard binding of its own is needed there.
 *
 * This also satisfies `a11y-click-handlers.guard.spec.ts` for free, not via a
 * new exemption: `cdk-tree-node` is a custom component tag (contains a `-`),
 * which the guardian already treats as out of scope because a custom
 * component "manage[s] their own host accessibility" — true here in the
 * fullest sense, since the CDK statically sets `role="treeitem"` and drives
 * `tabindex` via `TreeKeyManager`'s roving-tabindex host binding on that exact
 * element (verified in `@angular/cdk/tree`'s host metadata: `attributes:
 * { role: 'treeitem' }`, `properties: { tabindex: '_tabindex' }`). No new
 * allowlist entry, unlike the guardian's one documented `role="option"`
 * exemption — this is the existing custom-component rule doing its job.
 *
 * Hierarchy is drawn with indentation plus one faint vertical guide per level —
 * no nested cards (design doc, "Dirección visual").
 */
@Component({
  selector: 'ui-folder-tree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CdkTreeModule, InputComponent, LucideAngularModule],
  // CRITICAL fix: a PRIMITIVE must render standalone, on its own, without
  // depending on an ancestor happening to pick the icons it uses. This used
  // to import bare `LucideAngularModule` (usable in the template, but no icon
  // registered) and rely on whichever consumer mounted it — bank-list, by
  // coincidence — to `pick()` chevron-down/chevron-right/more-horizontal at
  // its own component level. `/app/bank/new`'s folder popover mounts this
  // with no such ancestor and threw `The "chevron-right" icon has not been
  // provided`. `providers` (not `imports`) mirrors bank-list's own working
  // pattern — see that component's doc: Angular's Lucide icon token is NOT a
  // multi-provider, so a local `pick()` SHADOWS (does not merge with) an
  // ancestor's, which is exactly the isolation a primitive needs.
  providers: [
    LucideAngularModule.pick({ ChevronDown, ChevronRight, MoreHorizontal }).providers ?? [],
  ],
  template: `
    @if (creatingRoot()) {
      <!--
        Root-level create (item 3): rendered OUTSIDE \`<cdk-tree>\` on purpose —
        it has no parent node to attach to (an empty tree, zero folders yet,
        still has to be able to create its first one), so it can't reuse
        \`isCreatingUnder\`/\`folder-new-input\`, which are keyed by a node id.
      -->
      <div data-testid="folder-new-input-root" class="py-1" (keydown)="$event.stopPropagation()">
        <ui-input
          placeholder="Nombre de la carpeta"
          [value]="draftName()"
          (valueChange)="draftName.set($event)"
          (keydown.enter)="commitCreateRoot()"
          (keydown.escape)="cancelEditing()"
        ></ui-input>
      </div>
    }
    <cdk-tree
      #tree
      [dataSource]="mutableNodes()"
      [childrenAccessor]="childrenAccessor"
      [expansionKey]="expansionKey"
      [trackBy]="trackNodeById"
      class="block"
    >
      <cdk-tree-node
        *cdkTreeNodeDef="let node"
        [isExpandable]="node.children.length > 0"
        (expandedChange)="onExpandedChange(node)"
        [attr.aria-selected]="node.id === selectedId() ? 'true' : 'false'"
        class="block"
        (click)="onSelect(node)"
        (keydown)="onRowKeydown($event, node)"
      >
        <div
          data-testid="folder-row"
          [attr.data-folder-id]="node.id"
          class="group flex cursor-pointer items-center gap-1 rounded-field px-2 py-1.5 text-sm transition-colors hover:bg-n50"
          [class.bg-tint-active]="node.id === selectedId()"
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

          @if (isRenaming(node)) {
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
                [error]="rejectedMessage(node, 'rename')"
                (valueChange)="draftName.set($event)"
                (keydown.enter)="commitRename(node)"
                (keydown.escape)="cancelEditing()"
              ></ui-input>
            </div>
          } @else {
            <span class="flex-1 truncate text-n800">{{ node.name }}</span>
            <span class="shrink-0 text-xs text-n500">{{ node.totalCount }}</span>
          }

          @if (mode() === 'browse' && node.editable && !isRenaming(node)) {
            <button
              type="button"
              data-testid="folder-menu"
              [attr.data-folder-id]="node.id"
              aria-haspopup="menu"
              [attr.aria-expanded]="menuFor() === node.id"
              [attr.aria-label]="'Acciones de ' + node.name"
              class="shrink-0 rounded p-0.5 text-n400 opacity-0 transition-opacity hover:text-n700 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary-300 group-hover:opacity-100"
              (click)="toggleMenu($event, node)"
              (keydown.enter)="toggleMenu($event, node)"
              (keydown.space)="toggleMenu($event, node)"
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

        @if (isCreatingUnder(node)) {
          <div
            data-testid="folder-new-input"
            class="ml-8 py-1"
            (keydown)="$event.stopPropagation()"
          >
            <ui-input
              placeholder="Nombre de la carpeta"
              [value]="draftName()"
              [error]="rejectedMessage(node, 'create')"
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
  /**
   * A write the OWNER rejected, so the message can land on the input that
   * caused it. See `FolderInlineError`. The tree stays presentational: it does
   * not decide what is wrong, it only puts the owner's verdict back where the
   * teacher was typing.
   */
  readonly inlineError = input<FolderInlineError | null>(null);

  /**
   * CRITICAL fix: renamed off `select`/`toggle` (review round 3). A native
   * text `<input>` fires (and bubbles) its own `select`/`toggle`-adjacent DOM
   * events — `select` in particular fires whenever text inside it is
   * selected, including the inline rename `<input>` this same primitive
   * renders. With no matching component output named `select`, Angular falls
   * back to treating `(select)="…"` on a consumer as a NATIVE event
   * listener — so a consumer bound to `(select)="onFolderSelect($event)"`
   * could receive the bubbled native `Event` object instead of a folder id
   * (observed: `GET /bank/questions?folderId=[object Event]`). Renaming to
   * names no native DOM event uses removes the collision outright.
   */
  readonly folderSelected = output<string>();
  readonly expandedChange = output<string>();
  readonly create = output<FolderCreateEvent>();
  readonly rename = output<FolderRenameEvent>();
  readonly remove = output<string>();

  /** Which node is being renamed inline, and which is having a child created under it. Never both. */
  protected readonly editingId = signal<string | null>(null);
  protected readonly creatingUnder = signal<string | null>(null);
  /** A ROOT-level create editor, open via `startCreatingRoot()` — see that method's doc. Mutually exclusive with the above, same as they are with each other. */
  protected readonly creatingRoot = signal(false);
  protected readonly menuFor = signal<string | null>(null);
  protected readonly draftName = signal('');
  /**
   * The editor most recently SUBMITTED — which node, and which of its two
   * editors. Kept because a commit closes the editor optimistically (the write
   * usually succeeds, and leaving the input open would read as "nothing
   * happened"), so when an `inlineError` comes back this is the only record of
   * WHICH editor to re-open. Cleared by Escape and by starting a fresh edit,
   * which is what stops a stale error from re-opening an abandoned editor.
   */
  private readonly submitted = signal<{ id: string; kind: 'rename' | 'create' } | null>(null);

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

  /**
   * Expansion is keyed by folder ID, never by object identity.
   *
   * The owner rebuilds this whole view model on every write —
   * `toFolderTreeNodes` maps fresh objects out of the wire tree — so the array
   * arriving after a create, a rename, a delete, or a failed write's rollback
   * reload has the same ids and not one of the same object references. With the
   * CDK's default (identity) key that read as "every node is new", and the tree
   * snapped shut on each one: renaming a folder six levels down closed the six
   * levels the teacher had just opened to reach it. Keying on `id` is also
   * exactly right for the case that SHOULD collapse — a node whose id is gone
   * from the new tree has no expansion left to restore.
   */
  protected readonly expansionKey = (node: FolderTreeNode): string => node.id;

  /** Same reasoning one layer down: let the CDK REUSE a row whose id it already rendered instead of tearing it out. */
  protected readonly trackNodeById: TrackByFunction<FolderTreeNode> = (_index, node) => node.id;

  /**
   * The `#tree` template reference, read from the class — same instance the
   * template already reads for `tree.isExpanded(node)`. Used by
   * `startCreating` to programmatically EXPAND a collapsed node (see its
   * doc): the template variable alone can't be reached from a `(click)`
   * handler defined on the class.
   */
  private readonly treeRef = viewChild<CdkTree<FolderTreeNode>>('tree');

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
    this.folderSelected.emit(node.id);
  }

  /**
   * Bound to `CdkTreeNode`'s `(expandedChange)` (review round 1, Important
   * #3) rather than the toggle button's `(click)` — `expandedChange` fires
   * for BOTH the mouse click (via `cdkTreeNodeToggle`) and keyboard-driven
   * expansion (ArrowRight/ArrowLeft through the CDK's `TreeKeyManager`), so
   * `expandedChange` now reflects every way a node can expand or collapse,
   * not just the mouse. Emits only the id, matching this primitive's frozen
   * contract (`expandedChange: OutputEmitterRef<string>`).
   */
  protected onExpandedChange(node: FolderTreeNode): void {
    this.expandedChange.emit(node.id);
  }

  /**
   * F2 renames, Delete removes, Enter/Space select — shortcuts on top of the
   * CDK's own arrow/Home/End navigation.
   *
   * Bound to `<cdk-tree-node>`'s `(keydown)`, NOT the inner row div — see the
   * class doc's "CRITICAL fix" note. `TreeKeyManager` focuses the node
   * itself, so that is where a real keyboard event's `target` lands.
   *
   * Critical fix (review round 1): this guard used to be reachable from the
   * rename/create `<ui-input>`, whose keydown events bubble up through this
   * same node — pressing Delete while renaming deleted the folder, and a
   * second F2 reset the in-progress draft. The inputs now `stopPropagation`
   * on their own wrapper so this handler never even runs for them; this
   * early return is a second line of defense in case that wrapper ever moves.
   *
   * Fix (review round 2): the toggle chevron and the "…" menu trigger also
   * live inside this node, and neither one used to stop its own keydown from
   * bubbling here. Enter/Space on either of them was (a) also emitting
   * `select`, and (b) hitting `event.preventDefault()` below, which can
   * suppress the button's own native Enter/Space activation (the CDK's own
   * `cdkTreeNodeToggle` handles this correctly via its own keydown listener,
   * but the menu trigger's native button activation was left exposed to
   * this handler's `preventDefault()`). This handler now only acts on
   * keydowns that originate on the node itself (`event.target ===
   * event.currentTarget`) — not on any descendant button/input/menu, which
   * is also exactly what makes a real focused-node Enter/Space/F2/Delete
   * work: the CDK never moves DOM focus onto a descendant, so a genuine
   * keystroke always has the node as its target.
   */
  protected onRowKeydown(event: KeyboardEvent, node: FolderTreeNode): void {
    if (event.target !== event.currentTarget) {
      return;
    }
    if (this.isRenaming(node) || this.isCreatingUnder(node)) {
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

  /**
   * Bound to the trigger's `(click)`, `(keydown.enter)` and `(keydown.space)`
   * (review round 2) rather than relying on the browser's native Enter/Space
   * button-activation default action — `onRowKeydown` above no longer
   * `preventDefault()`s a bubbled event from this button, but a real native
   * activation still isn't something a unit test can observe, so this
   * mirrors the CDK's own `CdkTreeNodeToggle` pattern of listening to the
   * keys directly. `event.stopPropagation()` also keeps the keydown from
   * ever reaching the row.
   */
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

  /** True while `node`'s name input should render — open by the teacher, or re-opened by a rejected commit. */
  protected isRenaming(node: FolderTreeNode): boolean {
    return this.editingId() === node.id || this.wasRejected(node.id, 'rename');
  }

  protected isCreatingUnder(node: FolderTreeNode): boolean {
    return this.creatingUnder() === node.id || this.wasRejected(node.id, 'create');
  }

  /** The message to show under `node`'s editor, or `undefined` — `ui-input`'s `error` already wires `aria-invalid`/`aria-describedby`. */
  protected rejectedMessage(node: FolderTreeNode, kind: 'rename' | 'create'): string | undefined {
    return this.wasRejected(node.id, kind) ? this.inlineError()!.message : undefined;
  }

  /**
   * Both halves must agree: the OWNER points at a node, and this tree
   * remembers submitting that node's editor of this kind. Without the second
   * half an error would open BOTH editors of the node (they share an id), and
   * an error left over from another screen state would open an editor the
   * teacher never asked for.
   */
  private wasRejected(id: string, kind: 'rename' | 'create'): boolean {
    const submitted = this.submitted();
    return this.inlineError()?.id === id && submitted?.id === id && submitted.kind === kind;
  }

  protected startEditing(node: FolderTreeNode): void {
    this.menuFor.set(null);
    this.creatingUnder.set(null);
    this.creatingRoot.set(false);
    this.submitted.set(null);
    this.draftName.set(node.name);
    this.editingId.set(node.id);
  }

  /**
   * UX fix: a subfolder created under a COLLAPSED node used to be invisible
   * — the "Nueva subcarpeta" input opened, the teacher typed a name and
   * pressed Enter, and nothing on screen showed where it landed until she
   * separately expanded the parent. Expanding it here, the moment the create
   * editor opens, means the new row is already inside an open branch by the
   * time it exists. Only expandable nodes (`children.length > 0`) can even
   * BE collapsed — a leaf has no toggle to begin with — and `isExpanded`
   * guards against re-collapsing (`CdkTree.expand` is not idempotent-safe to
   * assume about) an already-open one.
   */
  protected startCreating(node: FolderTreeNode): void {
    this.menuFor.set(null);
    this.editingId.set(null);
    this.creatingRoot.set(false);
    this.submitted.set(null);
    this.draftName.set('');
    this.creatingUnder.set(node.id);
    const tree = this.treeRef();
    if (tree && node.children.length > 0 && !tree.isExpanded(node)) {
      tree.expand(node);
    }
  }

  /**
   * Opens a ROOT-level create editor — item 3: "there was no way to create a
   * top-level folder from the UI", every existing entry point ("Nueva
   * subcarpeta") only ever creates UNDER an existing node. PUBLIC (not
   * `protected`, unlike every other `start*`/`commit*` method here): the
   * OWNER calls this directly, via a template-ref `viewChild`, from a button
   * that lives ABOVE the tree — outside any node's own menu, since a root
   * folder has no node to hang that menu off of.
   */
  startCreatingRoot(): void {
    this.menuFor.set(null);
    this.editingId.set(null);
    this.creatingUnder.set(null);
    this.submitted.set(null);
    this.draftName.set('');
    this.creatingRoot.set(true);
  }

  protected cancelEditing(): void {
    this.editingId.set(null);
    this.creatingUnder.set(null);
    this.creatingRoot.set(false);
    this.submitted.set(null);
    this.draftName.set('');
  }

  /**
   * A blank or unchanged name is a cancel, not a request — the server would
   * 422 it anyway. A real one closes the editor and emits; `draftName` is
   * deliberately NOT cleared, so a rejection can re-open the editor with the
   * teacher's own text still in it instead of an empty box.
   */
  protected commitRename(node: FolderTreeNode): void {
    const name = this.draftName().trim();
    if (!name || name === node.name) {
      this.cancelEditing();
      return;
    }
    this.editingId.set(null);
    this.submitted.set({ id: node.id, kind: 'rename' });
    this.rename.emit({ id: node.id, name });
  }

  protected commitCreate(node: FolderTreeNode): void {
    const name = this.draftName().trim();
    if (!name) {
      this.cancelEditing();
      return;
    }
    this.creatingUnder.set(null);
    this.submitted.set({ id: node.id, kind: 'create' });
    this.create.emit({ parentId: node.id, name });
  }

  /**
   * Root-level counterpart of `commitCreate` — no node to key `submitted`/an
   * inline error against, so a rejected root create simply closes (this
   * primitive's inline-error re-open only ever applies to a create UNDER an
   * existing node — see `FolderInlineError`'s doc).
   */
  protected commitCreateRoot(): void {
    const name = this.draftName().trim();
    if (!name) {
      this.cancelEditing();
      return;
    }
    this.creatingRoot.set(false);
    this.create.emit({ parentId: null, name });
  }

  protected requestRemove(node: FolderTreeNode): void {
    this.menuFor.set(null);
    this.remove.emit(node.id);
  }
}
