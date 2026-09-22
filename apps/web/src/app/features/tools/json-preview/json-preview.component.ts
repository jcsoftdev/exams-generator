import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { BannerComponent } from '../../../ui/banner/banner.component';
import { ButtonComponent } from '../../../ui/button/button.component';
import { CardComponent } from '../../../ui/card/card.component';
import { MathTextComponent } from '../../../ui/math-text/math-text.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { parsePastedQuestions } from './parse-pasted-questions';
import type { PastedQuestion } from './parse-pasted-questions';

/** A) B) C)… — the letters `typst-template.ts` prepends when it prints a form. */
const ANSWER_LETTERS = ['A', 'B', 'C', 'D', 'E'] as const;

/**
 * Preview screen for a question JSON pasted by hand.
 *
 * It exists because the extraction prompt is also run OUTSIDE this app — in a
 * plain chat UI, with the images attached there — and the JSON that comes back
 * has nowhere to be looked at. Reading `bodyTypst` as raw markup tells a
 * teacher nothing about whether the transcription is right; seeing it typeset,
 * with the alternatives lettered and the key marked, does.
 *
 * Read-only ON PURPOSE: nothing here saves, and no tenant data is fetched.
 * Its whole job is "does this paste look like the question on the sheet?", so
 * the answer stays a rendering and the decision stays with the human.
 */
@Component({
  selector: 'app-json-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BannerComponent, ButtonComponent, CardComponent, MathTextComponent, TagComponent],
  templateUrl: './json-preview.component.html',
})
export class JsonPreviewComponent {
  /**
   * Both examples are bound rather than written into the template: Angular
   * reads a bare `{` in markup as the start of an ICU message and refuses to
   * compile the file.
   */
  protected readonly envelopeExample = '{ "questions": [ … ] }';
  protected readonly placeholderExample = '{ "questions": [ { "bodyTypst": "…" } ] }';

  protected readonly raw = signal('');
  protected readonly questions = signal<readonly PastedQuestion[]>([]);
  protected readonly error = signal<string | null>(null);

  protected readonly showEmptyState = computed(
    () => this.questions().length === 0 && this.error() === null,
  );

  protected preview(): void {
    const result = parsePastedQuestions(this.raw());
    if (!result.ok) {
      // A failed paste clears the previous render rather than leaving it on
      // screen next to an error — stale questions under a red banner read as
      // "these are the ones that failed", which they are not.
      this.questions.set([]);
      this.error.set(result.error);
      return;
    }
    this.error.set(null);
    this.questions.set(result.questions);
  }

  protected clear(): void {
    this.raw.set('');
    this.questions.set([]);
    this.error.set(null);
  }

  protected letterFor(index: number): string {
    return ANSWER_LETTERS[index] ?? String(index + 1);
  }
}
