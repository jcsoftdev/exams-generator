import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { BookOpen, HelpCircle, LucideAngularModule } from 'lucide-angular';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';

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
 * emits `open`. The output is NOT called `select` — Angular refuses an
 * output named after a native DOM event, a gotcha this codebase already
 * paid for once.
 */
@Component({
  selector: 'bank-folder-card',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [LucideAngularModule.pick({ BookOpen, HelpCircle }).providers ?? []],
  template: `
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
        class="flex h-10 w-10 items-center justify-center rounded-field"
        [class.bg-primary-50]="node().editable"
        [class.text-tint-text]="node().editable"
        [class.bg-n100]="!node().editable"
        [class.text-n600]="!node().editable"
      >
        <lucide-angular [name]="node().editable ? 'book-open' : 'help-circle'" class="h-5 w-5"></lucide-angular>
      </span>

      <span class="flex flex-col gap-0.5">
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
  `,
})
export class BankFolderCardComponent {
  readonly node = input.required<FolderTreeNode>();

  /** The id of the folder the teacher asked to open. */
  readonly open = output<string>();

  /**
   * "Sin carpeta" arrives as a node with `editable: false`. It is a view over
   * `folder_id IS NULL`, not a folder — it cannot be renamed, moved or
   * deleted — so it is drawn apart rather than inviting actions that would
   * fail.
   */
  protected readonly variant = computed(() => (this.node().editable ? 'folder' : 'unfiled'));

  protected readonly childrenLabel = computed(() => {
    const count = this.node().children.length;
    if (count === 0) return 'Sin subcarpetas';
    return count === 1 ? '1 tema' : `${count} temas`;
  });
}
