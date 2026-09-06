import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FolderPlus, LucideAngularModule } from 'lucide-angular';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { BreadcrumbComponent, BreadcrumbCrumb } from '../../../ui/breadcrumb/breadcrumb.component';
import { BankFoldersStore } from '../folders/bank-folders.store';
import {
  FolderMatch,
  childrenOf,
  findFolderPath,
  isLeafFolder,
  searchFolders,
} from '../folders/folder-path';
import { ButtonComponent } from '../../../ui/button/button.component';
import { InputComponent } from '../../../ui/input/input.component';
import { ModalComponent } from '../../../ui/modal/modal.component';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { BankFolderCardComponent } from './bank-folder-card.component';

/** Stands for "no folder open" in the breadcrumb, where every crumb needs an id. */
const ROOT_CRUMB_ID = '__root__';

/**
 * The question bank browsed the way a teacher browses a drive: a grid of the
 * school's own folders, one level at a time, with a trail back up.
 *
 * The open folder lives in the `carpeta` query param rather than in a signal.
 * That is what makes a link to a folder shareable, the browser's back button
 * undo each step, and a refresh land where the teacher was — none of which a
 * component-local selection can do. It also means an id that no longer exists
 * (a shared link to a since-deleted folder) simply resolves to no children
 * and shows the empty state, instead of throwing.
 *
 * Drilling stops at a leaf: a folder with no subfolders is a list of
 * questions, which is `bank-list`'s job, so we hand over to its route rather
 * than rendering an empty grid.
 */
@Component({
  selector: 'app-bank-browser',
  standalone: true,
  imports: [
    BankFolderCardComponent,
    BreadcrumbComponent,
    ButtonComponent,
    InputComponent,
    ModalComponent,
    LucideAngularModule,
  ],
  providers: [LucideAngularModule.pick({ FolderPlus }).providers ?? []],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-5 p-6" data-testid="bank-browser">
      <ui-breadcrumb [items]="crumbs()" (navigate)="openCrumb($event)"></ui-breadcrumb>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-n900">{{ heading() }}</h2>
        <div class="flex flex-wrap items-center gap-2">
          <div data-testid="folder-search" class="w-56">
            <ui-input
              type="text"
              ariaLabel="Buscar una carpeta"
              [placeholder]="searchPlaceholder()"
              [value]="query()"
              (valueChange)="query.set($event)"
            ></ui-input>
          </div>
          <div data-testid="new-folder">
          <ui-button variant="ghost" size="sm" (clicked)="startCreating()">
            <lucide-angular name="folder-plus" class="h-4 w-4"></lucide-angular>
            Nueva carpeta
          </ui-button>
          </div>
        </div>
      </div>

      @if (creating()) {
        <form
          data-testid="new-folder-form"
          class="flex flex-col gap-1"
          (submit)="submitNewFolder($event)"
        >
          <div data-testid="new-folder-name" class="max-w-sm">
            <ui-input
              [label]="newFolderLabel()"
              [value]="newFolderName()"
              (valueChange)="newFolderName.set($event)"
              (keydown)="onNewFolderKeydown($event)"
            ></ui-input>
          </div>
          @if (createError()) {
            <p data-testid="new-folder-error" role="alert" class="text-sm text-hard-text">
              {{ createError() }}
            </p>
          }
        </form>
      }

      @if (store.loading()) {
        <p data-testid="browser-loading" class="text-sm text-n600">Cargando carpetas…</p>
      } @else if (store.error()) {
        <p data-testid="browser-error" role="alert" class="text-sm text-hard-text">
          {{ store.error() }}
        </p>
      } @else if (searching() && visible().length === 0) {
        <p data-testid="browser-no-results" class="text-sm text-n600">
          Ninguna carpeta de aquí para abajo se llama así.
        </p>
      } @else if (!searching() && children().length === 0) {
        <p data-testid="browser-empty" class="text-sm text-n600">
          Esta carpeta todavía no tiene subcarpetas.
        </p>
      } @else {
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          @for (match of visible(); track match.node.id) {
            <bank-folder-card
              [node]="match.node"
              [trail]="match.trail"
              (open)="openFolder($event)"
              (renamed)="renameFolder(match.node.id, $event)"
              (subfolderRequested)="startCreatingUnder($event)"
              (removeRequested)="askToRemove($event)"
            ></bank-folder-card>
          }
        </div>
      }

      @if (actionError()) {
        <p data-testid="folder-action-error" role="alert" class="text-sm text-hard-text">
          {{ actionError() }}
        </p>
      }

      @if (removedNotice()) {
        <p data-testid="folder-removed-notice" role="status" class="text-sm text-n700">
          {{ removedNotice() }}
        </p>
      }

      <ui-modal
        [open]="pendingRemoval() !== null"
        title="Quitar carpeta"
        (openChange)="cancelRemoval()"
      >
        @if (pendingRemoval(); as folder) {
          <p data-testid="folder-delete-confirm" class="text-sm text-n700">
            Se quitará la carpeta «{{ folder.name }}» y sus {{ folder.totalCount }} preguntas
            dejarán de verse aquí. Las preguntas no se borran del banco.
          </p>
        }
        <div actions class="flex justify-end gap-2">
          <div data-testid="folder-delete-cancel">
            <ui-button variant="ghost" (clicked)="cancelRemoval()">Cancelar</ui-button>
          </div>
          <div data-testid="folder-delete-confirm-yes">
            <ui-button variant="danger" (clicked)="confirmRemoval()">Quitar carpeta</ui-button>
          </div>
        </div>
      </ui-modal>
    </div>
  `,
})
export class BankBrowserComponent {
  protected readonly store = inject(BankFoldersStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  private readonly folderId = toSignal(
    this.route.queryParamMap.pipe(map((params) => params.get('carpeta'))),
    { initialValue: null },
  );

  private readonly path = computed(() => findFolderPath(this.store.tree(), this.folderId()));

  protected readonly children = computed(() => childrenOf(this.store.tree(), this.folderId()));

  /**
   * The name filter, kept in the component rather than the URL: it is a way of
   * looking, not a place — and a half-typed word in a shared link would open
   * the bank on a filtered screen the reader never asked for.
   */
  protected readonly query = signal('');

  protected readonly searching = computed(() => this.query().trim() !== '');

  protected readonly searchPlaceholder = computed(() => {
    const path = this.path();
    return path.length === 0 ? 'Buscar en mi banco' : `Buscar en ${path[path.length - 1].name}`;
  });

  /**
   * What the grid paints: the children of the open folder, or — while a query
   * is on — every match below it, each carrying the trail that says where it
   * lives. Both shapes are `FolderMatch` so the template has one loop.
   */
  protected readonly visible = computed<readonly FolderMatch[]>(() =>
    this.searching()
      ? searchFolders(this.store.tree(), this.folderId(), this.query())
      : this.children().map((node) => ({ node, trail: [] as readonly string[] })),
  );

  protected readonly crumbs = computed<readonly BreadcrumbCrumb[]>(() => [
    { id: ROOT_CRUMB_ID, label: 'Mi banco' },
    ...this.path().map((node) => ({ id: node.id, label: node.name })),
  ]);

  protected readonly heading = computed(() => {
    const path = this.path();
    return path.length === 0 ? 'Mi banco' : path[path.length - 1].name;
  });

  protected readonly creating = signal(false);
  protected readonly newFolderName = signal('');
  protected readonly createError = signal<string | null>(null);

  /**
   * Where the next new folder goes. `null` means the open level — the header's
   * "Nueva carpeta" — while a card's "Nueva subcarpeta" points it at that card
   * instead, which is the one creation that names a parent the teacher is not
   * standing in.
   */
  private readonly newFolderParent = signal<string | null>(null);

  protected readonly newFolderLabel = computed(() => {
    const parent = this.newFolderParent();
    const name = parent === null ? null : this.nodeById(parent)?.name;
    return name === null || name === undefined
      ? 'Nombre de la carpeta'
      : `Nombre de la subcarpeta en «${name}»`;
  });

  /** Rename and removal failures: one line under the grid, not per card. */
  protected readonly actionError = signal<string | null>(null);

  /** The folder awaiting confirmation — the node, so the copy can name it and count it. */
  protected readonly pendingRemoval = signal<FolderTreeNode | null>(null);

  /** What the removal left behind, cleared by the next action. */
  protected readonly removedNotice = signal<string | null>(null);

  constructor() {
    this.store.load();
  }

  protected startCreating(): void {
    this.openCreator(null);
  }

  /** "Nueva subcarpeta" on a card: same editor, aimed one level deeper. */
  protected startCreatingUnder(parentId: string): void {
    this.openCreator(parentId);
  }

  private openCreator(parentId: string | null): void {
    this.createError.set(null);
    this.actionError.set(null);
    this.removedNotice.set(null);
    this.newFolderName.set('');
    this.newFolderParent.set(parentId);
    this.creating.set(true);
  }

  /** Escape abandons the editor — the same gesture the folder tree already uses. */
  protected onNewFolderKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.creating.set(false);
      this.createError.set(null);
    }
  }

  /**
   * The new folder is created under whatever level is open, which is the one
   * the teacher is looking at. A blank name is a no-op rather than an
   * "Untitled" folder she then has to find and rename.
   */
  protected submitNewFolder(event: Event): void {
    event.preventDefault();
    const name = this.newFolderName().trim();
    if (name === '') {
      return;
    }
    this.createError.set(null);
    this.store.create(this.newFolderParent() ?? this.folderId(), name).subscribe({
      next: () => {
        this.creating.set(false);
        this.newFolderName.set('');
      },
      error: (error: HttpErrorResponse) =>
        this.createError.set(
          typeof error.error?.message === 'string'
            ? error.error.message
            : 'No se pudo crear la carpeta.',
        ),
    });
  }

  /**
   * Renaming is optimistic in the store, so the card shows the new name at
   * once and a refusal rolls it back — the message then has to say why, or the
   * name would silently snap back to the old one.
   */
  protected renameFolder(id: string, name: string): void {
    this.actionError.set(null);
    this.removedNotice.set(null);
    this.store.rename(id, name).subscribe({
      error: (error: HttpErrorResponse) => this.actionError.set(this.messageOf(error, 'renombrar')),
    });
  }

  /** Asking only. Removal unfiles every question under the folder, so it is always confirmed. */
  protected askToRemove(id: string): void {
    this.actionError.set(null);
    this.removedNotice.set(null);
    this.pendingRemoval.set(this.nodeById(id) ?? null);
  }

  protected cancelRemoval(): void {
    this.pendingRemoval.set(null);
  }

  protected confirmRemoval(): void {
    const folder = this.pendingRemoval();
    if (folder === null) {
      return;
    }
    this.pendingRemoval.set(null);
    this.store.remove(folder.id).subscribe({
      next: (result) =>
        this.removedNotice.set(
          result.unfiledQuestions === 1
            ? `Se quitó «${folder.name}». 1 pregunta quedó sin carpeta.`
            : `Se quitó «${folder.name}». ${result.unfiledQuestions} preguntas quedaron sin carpeta.`,
        ),
      error: (error: HttpErrorResponse) => this.actionError.set(this.messageOf(error, 'quitar')),
    });
  }

  /** Only the level on screen can be acted on, so its cards are the whole search space. */
  private nodeById(id: string): FolderTreeNode | undefined {
    return this.children().find((node) => node.id === id);
  }

  private messageOf(error: HttpErrorResponse, verb: string): string {
    return typeof error.error?.message === 'string'
      ? error.error.message
      : `No se pudo ${verb} la carpeta.`;
  }

  protected openFolder(id: string): void {
    // A query that survived the jump would filter the level she just opened by
    // a word she typed about the previous one.
    this.query.set('');
    if (isLeafFolder(this.store.tree(), id)) {
      void this.router.navigate(['/app/bank/carpeta', id]);
      return;
    }
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { carpeta: id },
    });
  }

  protected openCrumb(id: string): void {
    this.query.set('');
    void this.router.navigate([], {
      relativeTo: this.route,
      // `null` removes the param rather than writing "carpeta=null" into the
      // URL, so the root is a clean /app/bank.
      queryParams: { carpeta: id === ROOT_CRUMB_ID ? null : id },
    });
  }
}
