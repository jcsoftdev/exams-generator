import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';

/**
 * Enunciado/Alternativas/Clave trio — byte-identical markup+bindings
 * previously hand-duplicated in `bank-list.component.html` (structured
 * questions only) and `ai-review-queue.component.html`'s inline edit forms
 * (audit P2, "giant components"). `correctAnswerOptions` is computed by the
 * caller from its own `alternatives` value (lettered a/b/c… valued by
 * 0-based index) — this component only renders it, never derives it, so it
 * stays a pure presentational primitive.
 */
@Component({
  selector: 'app-question-content-fields',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="text-sm text-n700"
      >Enunciado
      <textarea
        data-testid="edit-enunciado"
        class="mt-1 block w-full rounded-field border border-n200 p-2 text-sm"
        rows="3"
        [value]="body()"
        (input)="bodyChange.emit($any($event.target).value)"
      ></textarea>
    </label>
    <label class="text-sm text-n700"
      >Alternativas (una por línea)
      <textarea
        data-testid="edit-alternatives"
        class="mt-1 block w-full rounded-field border border-n200 p-2 text-sm"
        rows="4"
        [value]="alternatives()"
        (input)="alternativesChange.emit($any($event.target).value)"
      ></textarea>
    </label>
    <div data-testid="edit-correct-answer">
      <ui-select
        label="Clave (respuesta correcta)"
        placeholder="Elige la alternativa correcta"
        [options]="correctAnswerOptions()"
        [value]="correctAnswer()"
        (valueChange)="correctAnswerChange.emit($event ?? '')"
      ></ui-select>
    </div>
  `,
})
export class QuestionContentFieldsComponent {
  readonly body = input.required<string>();
  readonly alternatives = input.required<string>();
  readonly correctAnswer = input.required<string>();
  readonly correctAnswerOptions = input.required<readonly SelectOption<string>[]>();

  readonly bodyChange = output<string>();
  readonly alternativesChange = output<string>();
  readonly correctAnswerChange = output<string>();
}
