import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FolderPlus, LucideAngularModule } from 'lucide-angular';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { BreadcrumbComponent, BreadcrumbCrumb } from '../../../ui/breadcrumb/breadcrumb.component';
import { BankFoldersStore } from '../folders/bank-folders.store';
import { childrenOf, findFolderPath, isLeafFolder } from '../folders/folder-path';
import { ButtonComponent } from '../../../ui/button/button.component';
import { InputComponent } from '../../../ui/input/input.component';
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
  imports: [BankFolderCardComponent, BreadcrumbComponent, ButtonComponent, InputComponent, LucideAngularModule],
  providers: [LucideAngularModule.pick({ FolderPlus }).providers ?? []],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-5 p-6" data-testid="bank-browser">
      <ui-breadcrumb [items]="crumbs()" (navigate)="openCrumb($event)"></ui-breadcrumb>

      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-xl font-bold text-n900">{{ heading() }}</h2>
        <div data-testid="new-folder">
          <ui-button variant="ghost" size="sm" (clicked)="startCreating()">
            <lucide-angular name="folder-plus" class="h-4 w-4"></lucide-angular>
            Nueva carpeta
          </ui-button>
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
              label="Nombre de la carpeta"
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
      } @else if (children().length === 0) {
        <p data-testid="browser-empty" class="text-sm text-n600">
          Esta carpeta todavía no tiene subcarpetas.
        </p>
      } @else {
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          @for (node of children(); track node.id) {
            <bank-folder-card [node]="node" (open)="openFolder($event)"></bank-folder-card>
          }
        </div>
      }
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

  constructor() {
    this.store.load();
  }

  protected startCreating(): void {
    this.createError.set(null);
    this.newFolderName.set('');
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
    this.store.create(this.folderId(), name).subscribe({
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

  protected openFolder(id: string): void {
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
    void this.router.navigate([], {
      relativeTo: this.route,
      // `null` removes the param rather than writing "carpeta=null" into the
      // URL, so the root is a clean /app/bank.
      queryParams: { carpeta: id === ROOT_CRUMB_ID ? null : id },
    });
  }
}
