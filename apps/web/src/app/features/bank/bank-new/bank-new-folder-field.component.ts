import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { InputComponent } from '../../../ui/input/input.component';
import { FolderTreeComponent } from '../../../ui/folder-tree/folder-tree.component';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';

/** Shown for "no folder", both on the trigger and as the tree's own virtual node. */
const UNFILED_LABEL = 'Sin carpeta';

/** Depth-first name lookup over the RENDER tree — the field never needs the wire shape. */
function findNodeName(nodes: readonly FolderTreeNode[], id: string): string | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node.name;
    }
    const found = findNodeName(node.children, id);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

/**
 * The "Carpeta" field of `bank-new` — label, trigger, and the `pick`-mode
 * popover — mounted once per tab. Extracted in fix round 1: the same 70 lines
 * of markup were copy-pasted for the photo and structured tabs, which is two
 * places for the same accessibility bug to live.
 *
 * PRESENTATIONAL: it takes the tree it should render and the value it should
 * show, and emits the teacher's choice. It never reads `BankFoldersStore`,
 * never saves, and never decides whether the folder disagrees with the Tema —
 * `mismatch` is the OWNER's verdict, pushed down, exactly as
 * `FolderTreeComponent` takes `inlineError`.
 *
 * `idPrefix` is what lets two instances coexist on one page: it namespaces the
 * `data-testid`s and the `id`s that `aria-controls`/`aria-labelledby` point at.
 * Two elements sharing an `id` would silently break both.
 *
 * ACCESSIBILITY. The trigger is a native `<button>` (never `ui-button`, which
 * cannot carry these attributes) with `aria-haspopup="dialog"`,
 * `aria-expanded`, `aria-controls`, and an `aria-labelledby` that names it
 * "Carpeta <current value>" — a button reading just "Sin carpeta" tells a
 * screen-reader user nothing about WHICH field it is. On open, focus moves
 * into the dialog (`tabindex="-1"`) so Escape reaches it on the first press
 * instead of after a Tab; on Escape it goes back to the trigger, since the CDK
 * tree owns focus while the popover is open and nothing else puts it back.
 */
@Component({
  selector: 'app-bank-new-folder-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FolderTreeComponent, InputComponent],
  template: `
    <div [attr.data-testid]="'folder-field-' + idPrefix()" class="flex flex-col gap-1">
      <span
        [id]="labelId()"
        [attr.data-testid]="'folder-field-' + idPrefix() + '-label'"
        class="text-sm font-medium text-n700"
      >
        Carpeta
      </span>
      <button
        #trigger
        type="button"
        [id]="triggerId()"
        class="self-start rounded-field border border-n200 px-3 py-1.5 text-sm text-n800 transition-colors hover:bg-n50 focus:outline-none focus:ring-2 focus:ring-primary-300"
        aria-haspopup="dialog"
        [attr.aria-controls]="popoverId()"
        [attr.aria-expanded]="open() ? 'true' : 'false'"
        [attr.aria-labelledby]="labelId() + ' ' + triggerId()"
        (click)="toggle()"
      >
        {{ label() }}
      </button>

      @if (open()) {
        <div
          #popover
          [id]="popoverId()"
          role="dialog"
          tabindex="-1"
          aria-label="Elegir carpeta"
          class="rounded-card border border-n200 bg-surface p-2 shadow-lg focus:outline-none"
          (keydown.escape)="closeFromEscape()"
        >
          @if (nodes().length === 0 && loading()) {
            <p
              [attr.data-testid]="'folder-field-' + idPrefix() + '-loading'"
              class="px-2 py-1 text-xs text-n500"
            >
              Cargando carpetas…
            </p>
          } @else {
            <ui-folder-tree
              [nodes]="nodes()"
              [selectedId]="value()"
              mode="pick"
              (folderSelected)="onSelect($event)"
            ></ui-folder-tree>

            @if (drafting()) {
              <form
                [attr.data-testid]="'folder-create-name-' + idPrefix()"
                class="mt-1 flex flex-col gap-1 border-t border-n200 pt-2"
                (submit)="submitDraft($event)"
              >
                <ui-input
                  [label]="draftLabel()"
                  [value]="draftName()"
                  (valueChange)="draftName.set($event)"
                ></ui-input>
                <!--
                  Native buttons, not \`ui-button\`: the primitive carries no
                  \`type\`, so a submit inside a form is the one thing it cannot
                  be — the same reason this component's trigger is native.
                -->
                <div class="flex gap-2">
                  <button
                    type="submit"
                    [attr.data-testid]="'folder-create-submit-' + idPrefix()"
                    [disabled]="creating()"
                    class="rounded-field bg-primary-600 px-3 py-1 text-sm text-white transition-colors hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-primary-300 disabled:opacity-60"
                  >
                    Crear
                  </button>
                  <button
                    type="button"
                    [attr.data-testid]="'folder-create-cancel-' + idPrefix()"
                    class="rounded-field px-3 py-1 text-sm text-n700 transition-colors hover:bg-n50 focus:outline-none focus:ring-2 focus:ring-primary-300"
                    (click)="closeDraft()"
                  >
                    Cancelar
                  </button>
                </div>
                @if (createError()) {
                  <p
                    [attr.data-testid]="'folder-create-error-' + idPrefix()"
                    role="alert"
                    class="text-xs text-hard-text"
                  >
                    {{ createError() }}
                  </p>
                }
              </form>
            } @else {
              <button
                type="button"
                [attr.data-testid]="'folder-create-' + idPrefix()"
                class="mt-1 w-full rounded-field border-t border-n200 px-2 pt-2 text-left text-sm text-primary-600 hover:underline focus:outline-none focus:ring-2 focus:ring-primary-300"
                (click)="openDraft()"
              >
                + Nueva carpeta
              </button>
            }
          }
        </div>
      }

      @if (mismatch()) {
        <p
          [attr.data-testid]="'folder-topic-mismatch-' + idPrefix()"
          class="text-xs text-medium-text"
        >
          El Tema no coincide con la carpeta
        </p>
      }
    </div>
  `,
})
export class BankNewFolderFieldComponent {
  /** The chosen folder, or `null` for "Sin carpeta". */
  readonly value = input<string | null>(null);
  readonly nodes = input<readonly FolderTreeNode[]>([]);
  readonly loading = input(false);
  /** The OWNER's verdict that Tema disagrees with the folder — never computed here. */
  readonly mismatch = input(false);
  /** True while the owner is saving a folder this field asked for. */
  readonly creating = input(false);
  /** Why the owner's save was refused — shown under the draft, which stays open. */
  readonly createError = input<string | null>(null);
  /** Namespaces every `id` and `data-testid`, so both tabs can mount this at once. */
  readonly idPrefix = input.required<string>();

  readonly valueChange = output<string | null>();
  /**
   * "Create this folder for me." The field never saves — it does not know
   * the store, and a presentational component that writes is a component
   * two screens cannot share.
   */
  readonly createRequested = output<{ parentId: string | null; name: string }>();

  private readonly injector = inject(Injector);

  /** Template refs, not `querySelector`: jsdom has no `CSS.escape`, and an id built from an input is not a safe selector anyway. */
  private readonly trigger = viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly popover = viewChild<ElementRef<HTMLElement>>('popover');

  protected readonly open = signal(false);

  /** Whether the inline "Nueva carpeta" editor is showing, and what is typed in it. */
  protected readonly drafting = signal(false);
  protected readonly draftName = signal('');

  protected readonly labelId = computed(() => `${this.idPrefix()}-folder-label`);
  protected readonly triggerId = computed(() => `${this.idPrefix()}-folder-trigger`);
  protected readonly popoverId = computed(() => `${this.idPrefix()}-folder-popover`);

  protected readonly label = computed(() => {
    const id = this.value();
    return (id && findNodeName(this.nodes(), id)) ?? UNFILED_LABEL;
  });

  /**
   * Where a new folder goes: under the one currently picked, or at the root.
   *
   * That is the only parent the teacher can have meant. She opened this
   * field to file a question, and the folder she is looking at is the answer
   * she is refining — "Trigonometría, but really the Identidades inside it".
   * The unfiled bucket is not a folder and can parent nothing, so it reads
   * as the root.
   */
  protected readonly draftParentId = computed(() => {
    const id = this.value();
    return id === null || id === UNFILED_FOLDER_ID ? null : id;
  });

  protected readonly draftLabel = computed(() => {
    const parent = this.draftParentId();
    const name = parent === null ? null : findNodeName(this.nodes(), parent);
    return name === null ? 'Nombre de la carpeta' : `Nombre de la subcarpeta en «${name}»`;
  });

  constructor() {
    // The owner owns the save, so this is the only signal the field has that
    // one finished: `creating` falling back to false with nothing to report.
    // A refusal keeps the editor open with the name still in it — retyping a
    // name because the server said "ya existe" is the wrong thing to ask.
    let saving = false;
    effect(() => {
      const busy = this.creating();
      if (saving && !busy && this.createError() === null) {
        this.closeDraft();
      }
      saving = busy;
    });
  }

  protected openDraft(): void {
    this.draftName.set('');
    this.drafting.set(true);
  }

  protected closeDraft(): void {
    this.drafting.set(false);
    this.draftName.set('');
  }

  /** A blank name is a no-op rather than an "Untitled" folder to find and rename later. */
  protected submitDraft(event: Event): void {
    event.preventDefault();
    const name = this.draftName().trim();
    if (name === '') {
      return;
    }
    this.createRequested.emit({ parentId: this.draftParentId(), name });
  }

  protected toggle(): void {
    const opening = !this.open();
    this.open.set(opening);
    if (opening) {
      this.focusPopover();
    }
  }

  protected onSelect(folderId: string): void {
    this.open.set(false);
    // The tree's virtual "Sin carpeta" node means "file it nowhere", which on
    // the wire is `null` — that literal id must never leave this component.
    this.valueChange.emit(folderId === UNFILED_FOLDER_ID ? null : folderId);
  }

  protected closeFromEscape(): void {
    this.open.set(false);
    this.focusTrigger();
  }

  /** `afterNextRender` because the popover lives behind an `@if` — it is not in the DOM yet. */
  private focusPopover(): void {
    afterNextRender(() => this.popover()?.nativeElement.focus(), { injector: this.injector });
  }

  private focusTrigger(): void {
    this.trigger()?.nativeElement.focus();
  }
}
