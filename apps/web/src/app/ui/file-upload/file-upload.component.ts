import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Upload, Image as ImageIcon } from 'lucide-angular';

/**
 * L5: the styled click/drag upload control used to be duplicated verbatim
 * between `bank-new`'s photo tab (the required exam photo) and its
 * structured tab (the optional complement image) — same markup, same
 * testids-with-a-different-prefix, same "Cambiar imagen" affordance. This
 * is that control pulled out once, parameterized by `testIdPrefix` so both
 * call sites keep their EXACT existing testids
 * (`image-upload`/`image-upload-preview`/… and
 * `structured-image-upload`/…) with no change to the host's specs.
 *
 * Unlike the two call sites it replaces, this ALSO implements real
 * drag-and-drop (`dragover`/`drop`, with a visible drag-over style) and
 * keyboard access (Enter/Space opens the picker while the control has
 * focus) — neither existed before; the old markup only ever reacted to a
 * native `(change)` from clicking through the `<label>`.
 *
 * Presentational only — emits the picked/dropped `File[]` (supports multiple
 * files and directories via `webkitdirectory`) and leaves validation etc.
 * entirely to the caller.
 */
@Component({
  selector: 'ui-file-upload',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  providers: [LucideAngularModule.pick({ Upload, Image: ImageIcon }).providers ?? []],
  template: `
    <div [attr.data-testid]="testIdPrefix()" class="flex flex-col gap-2">
      @if (label()) {
        <span class="text-sm font-medium text-n700">{{ label() }}</span>
      }
      <label
        class="flex flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-6 text-center transition-colors focus-within:outline-none focus-within:ring-2 focus-within:ring-primary-500"
        [class.cursor-pointer]="!disabled()"
        [class.cursor-not-allowed]="disabled()"
        [class.opacity-60]="disabled()"
        [class.border-primary-400]="dragOver()"
        [class.bg-primary-50]="dragOver()"
        [class.border-n300]="!dragOver()"
        [class.bg-n50]="!dragOver()"
        [class.hover:border-primary-400]="!disabled() && !dragOver()"
        [class.hover:bg-primary-50]="!disabled() && !dragOver()"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave()"
        (drop)="onDrop($event)"
      >
        <input
          #fileInput
          type="file"
          [attr.accept]="accept()"
          multiple
          webkitdirectory
          class="sr-only"
          [disabled]="disabled()"
          [attr.aria-label]="label() || null"
          (change)="onChange($event)"
          (keydown)="onKeyDown($event)"
        />
        @if (previewUrl()) {
          <img
            [attr.data-testid]="testIdPrefix() + '-preview'"
            [src]="previewUrl()"
            [alt]="previewAlt()"
            class="h-24 w-24 rounded-field object-cover"
          />
          <span
            [attr.data-testid]="testIdPrefix() + '-filename'"
            class="flex items-center gap-1.5 text-sm font-medium text-n900"
          >
            <lucide-angular name="image" class="h-4 w-4 text-primary-500"></lucide-angular>
            {{ fileName() }}
          </span>
          <span
            [attr.data-testid]="testIdPrefix() + '-change'"
            class="text-sm font-medium text-primary-500"
            >Cambiar imagen</span
          >
        } @else {
          <lucide-angular name="upload" class="h-6 w-6 text-n500"></lucide-angular>
          <span class="text-sm text-n700">{{ hint() }}</span>
          <span class="text-xs text-n500">PNG o JPG</span>
        }
      </label>
    </div>
  `,
})
export class FileUploadComponent {
  readonly label = input<string>();
  /** Text shown when there is no file picked yet — e.g. "Arrastra una imagen o haz clic para elegirla". */
  readonly hint = input<string>('Arrastra una imagen o haz clic para elegirla');
  readonly previewUrl = input<string | null>(null);
  readonly fileName = input<string | null>(null);
  readonly disabled = input(false);
  readonly accept = input('image/*');
  /** Alt text for the preview `<img>` — varies by what's actually being uploaded (exam photo vs. complement figure). */
  readonly previewAlt = input('Vista previa de la imagen');
  /**
   * Every testid on the host side (`image-upload`, `image-upload-preview`,
   * `image-upload-filename`, `image-upload-change` / `structured-image-
   * upload*`) is `${testIdPrefix}[-suffix]` — this is the ONLY thing each
   * call site has to set to keep its existing specs passing unchanged.
   */
  readonly testIdPrefix = input('file-upload');

  readonly fileSelected = output<File[]>();

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('fileInput');
  protected readonly dragOver = signal(false);

  protected onChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.fileSelected.emit(input.files ? Array.from(input.files) : []);
  }

  /**
   * Space already opens a focused native file input's picker with no JS at
   * all in a real browser — handled explicitly anyway (for Enter, which
   * doesn't, and so this is testable/reliable across browsers), always
   * `preventDefault()`-ing first so this never fires alongside the native
   * default action and opens the dialog twice.
   */
  protected onKeyDown(event: KeyboardEvent): void {
    if (this.disabled()) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.fileInput().nativeElement.click();
    }
  }

  protected onDragOver(event: DragEvent): void {
    if (this.disabled()) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(): void {
    this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    if (this.disabled()) return;
    this.fileSelected.emit(event.dataTransfer?.files ? Array.from(event.dataTransfer.files) : []);
  }
}
