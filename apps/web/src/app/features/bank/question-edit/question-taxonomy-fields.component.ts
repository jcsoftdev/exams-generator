import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { Difficulty } from '@exams-generator/shared';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';

/**
 * Curso/Tema/Nivel/Grado select group — byte-identical markup+bindings
 * previously hand-duplicated in `bank-list.component.html` and
 * `ai-review-queue.component.html`'s inline edit forms (audit P2, "giant
 * components"). `courseIdChange` deliberately does NOT also reset
 * `topicId` — that side effect stays in the consumer's own
 * `onEditCourseChange` (mirrors both original implementations), since
 * whether/how to reset a dependent field is the caller's business logic,
 * not this primitive's.
 */
@Component({
  selector: 'app-question-taxonomy-fields',
  standalone: true,
  imports: [SelectComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-select
      label="Curso"
      placeholder="Elige un curso"
      [options]="courseOptions()"
      [value]="courseId()"
      (valueChange)="courseIdChange.emit($event ?? '')"
    ></ui-select>
    <ui-select
      label="Tema"
      placeholder="Elige un tema"
      [options]="topicOptions()"
      [value]="topicId()"
      (valueChange)="topicIdChange.emit($event ?? '')"
    ></ui-select>
    <ui-select
      label="Nivel"
      [options]="difficultyOptions()"
      [value]="difficulty()"
      (valueChange)="difficultyChange.emit($event)"
    ></ui-select>
    <ui-select
      label="Grado"
      [options]="gradeLevelOptions()"
      [value]="gradeLevel()"
      (valueChange)="gradeLevelChange.emit($event)"
    ></ui-select>
  `,
})
export class QuestionTaxonomyFieldsComponent {
  readonly courseId = input.required<string>();
  readonly topicId = input.required<string>();
  readonly difficulty = input.required<Difficulty | null>();
  readonly gradeLevel = input.required<string | null>();

  readonly courseOptions = input.required<readonly SelectOption<string>[]>();
  readonly topicOptions = input.required<readonly SelectOption<string>[]>();
  readonly difficultyOptions = input.required<readonly SelectOption<Difficulty>[]>();
  readonly gradeLevelOptions = input.required<readonly SelectOption<string>[]>();

  readonly courseIdChange = output<string>();
  readonly topicIdChange = output<string>();
  readonly difficultyChange = output<Difficulty | null>();
  readonly gradeLevelChange = output<string | null>();
}
