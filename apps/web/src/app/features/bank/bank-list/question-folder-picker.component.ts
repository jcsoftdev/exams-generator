import { HttpErrorResponse } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { ButtonComponent } from '../../../ui/button/button.component';
import { FolderTreeComponent } from '../../../ui/folder-tree/folder-tree.component';
import { LiveAnnouncerService } from '../../../ui/live-region/live-announcer.service';
import { extractErrorMessage } from '../../ai/extract-error-message';
import { BankService } from '../bank.service';
import { BankQuestion } from '../bank.models';
import { BankFoldersStore } from '../folders/bank-folders.store';

/**
 * The detail panel's "Carpeta" field for a tenant-owned question — label,
 * "Cambiar" trigger, and the `pick`-mode popover — extracted out of
 * `BankListComponent` (Task 11 fix round 1: the parent had grown past 1400
 * lines). `bank-list` mounts this ONLY for a non-central question (it wraps
 * the usage in `@if (!isCentral(q))`), since a central question has no
 * folder to change (the API 422s `central_question_has_no_folder`).
 *
 * Owns ALL of its own popover state (open/choice/saving/error). That is what
 * makes the reset-on-selection-change bug (fix round 1, #2) go away for
 * free: `bank-list`'s `@if` block never destroys/recreates this component
 * just because the SELECTED question changed underneath the same `q` slot —
 * only a changed CONDITION does — so without the `effect` below, a popover
 * left open for question A would still be open, mid-save, once the teacher
 * had already moved on to question B. The `effect` re-closes it the instant
 * `question().id` changes.
 *
 * `moved` fires on a successful PATCH with the server's updated record —
 * ALWAYS, even when the question just saved is no longer the one selected by
 * the time the response lands: the tree's counts and the open folder's list
 * still need refreshing either way. The PARENT decides whether to apply
 * `updated` to its own `selected` signal (only if the ids still match) — see
 * `BankListComponent.onQuestionMoved`. This component's OWN state (saving/
 * error/close) is likewise only touched by that response if `question().id`
 * still equals the id the save was made for — otherwise the popover the
 * teacher has since reopened for a different question would be stomped on
 * by a stale response for the one they left.
 */
@Component({
  selector: 'app-question-folder-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FolderTreeComponent, ButtonComponent],
  template: `
    <div class="flex items-center gap-2">
      <span>{{ folderLabel() }}</span>
      <span data-testid="question-folder-edit">
        <button
          type="button"
          class="rounded-field border border-tint-text px-2 py-0.5 text-xs text-tint-text transition-colors hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-300"
          aria-haspopup="dialog"
          aria-controls="question-folder-picker-popover"
          [attr.aria-expanded]="open() ? 'true' : 'false'"
          (click)="openPicker()"
        >
          Cambiar
        </button>
      </span>
    </div>

    @if (open()) {
      <div
        id="question-folder-picker-popover"
        data-testid="question-folder-picker"
        role="dialog"
        aria-label="Elegir carpeta"
        class="mt-2 rounded-card border border-n200 bg-surface p-2 shadow-lg"
        (keydown.escape)="closeFromEscape()"
      >
        <ui-folder-tree
          [nodes]="tree()"
          [selectedId]="choice()"
          mode="pick"
          (folderSelected)="choice.set($event)"
        ></ui-folder-tree>
        @if (error(); as message) {
          <p data-testid="question-folder-error" class="mt-2 text-sm text-hard-text" role="alert">
            {{ message }}
          </p>
        }
        <div class="mt-2 flex justify-end gap-2">
          <ui-button variant="ghost" (clicked)="close()">Cancelar</ui-button>
          <span data-testid="question-folder-save">
            <ui-button variant="primary" [loading]="saving()" (clicked)="save()">
              Guardar
            </ui-button>
          </span>
        </div>
      </div>
    }
  `,
})
export class QuestionFolderPickerComponent {
  readonly question = input.required<BankQuestion>();
  readonly moved = output<BankQuestion>();

  private readonly bankService = inject(BankService);
  private readonly foldersStore = inject(BankFoldersStore);
  private readonly liveAnnouncer = inject(LiveAnnouncerService);
  private readonly elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  /** `pick` mode: selection only, no actions — a form must never mutate the tree. */
  protected readonly tree = this.foldersStore.tree;

  protected readonly open = signal(false);
  protected readonly choice = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      // Read, not used — the dependency is what re-runs this on every
      // question switch. See the class doc for why this reset can't live in
      // the parent instead.
      this.question().id;
      this.open.set(false);
      this.choice.set(null);
      this.error.set(null);
    });
  }

  protected folderLabel(): string {
    const folderId = this.question().folderId;
    if (!folderId) {
      return 'Sin carpeta';
    }
    return this.foldersStore.folderName(folderId) ?? 'Sin carpeta';
  }

  protected openPicker(): void {
    this.error.set(null);
    this.choice.set(this.question().folderId ?? null);
    this.open.set(true);
  }

  protected close(): void {
    this.open.set(false);
    this.choice.set(null);
  }

  /**
   * Escape on the popover: close it AND return focus to the trigger that
   * opened it. The CDK tree owns focus while the popover is open (arrow-key
   * navigation, `TreeKeyManager`); nothing else puts it back on dismiss.
   * Mirrors `FolderTreeComponent.closeMenu`'s own pattern for the same reason.
   */
  protected closeFromEscape(): void {
    this.close();
    this.elementRef.nativeElement
      .querySelector<HTMLButtonElement>('[data-testid="question-folder-edit"] button')
      ?.focus();
  }

  /**
   * PATCHes `folderId` for `question()`. The picker's virtual "Sin carpeta"
   * node (`UNFILED_FOLDER_ID`) means "unfile it", which on the wire is
   * `null`.
   */
  protected save(): void {
    if (this.saving()) {
      return;
    }
    const requestedId = this.question().id;
    const choice = this.choice();
    const folderId = choice === null || choice === UNFILED_FOLDER_ID ? null : choice;

    this.saving.set(true);
    this.error.set(null);
    this.bankService.updateQuestion(requestedId, { folderId }).subscribe({
      next: (updated) => {
        if (this.question().id === requestedId) {
          this.saving.set(false);
          this.close();
        }
        this.liveAnnouncer.announce('Carpeta actualizada.');
        this.moved.emit(updated);
      },
      error: (httpError: HttpErrorResponse) => {
        if (this.question().id !== requestedId) {
          return;
        }
        this.saving.set(false);
        this.error.set(
          extractErrorMessage(httpError, 'No se pudo cambiar la carpeta de la pregunta.'),
        );
      },
    });
  }
}
