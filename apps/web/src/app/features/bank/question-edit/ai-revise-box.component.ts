import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule, Sparkles } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { InputComponent } from '../../../ui/input/input.component';

/**
 * "Editar con IA" box — byte-identical markup+behavior previously
 * hand-duplicated in `bank-list.component.html` and
 * `ai-review-queue.component.html`'s inline edit forms (audit P2, "giant
 * components"). Purely presentational: the caller owns `instruction`,
 * fires the actual `AiService.reviseQuestion()` call on `revise`, and
 * populates its own edit-form fields with the result — this component
 * never sees the revised question.
 */
@Component({
  selector: 'app-ai-revise-box',
  standalone: true,
  imports: [ButtonComponent, InputComponent, LucideAngularModule],
  providers: [LucideAngularModule.pick({ Sparkles }).providers ?? []],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col gap-2 rounded-field border border-dashed border-primary-300 bg-primary-50/40 p-3"
    >
      <span class="flex items-center gap-1 text-xs font-medium text-primary-700">
        <lucide-angular name="sparkles" class="h-3.5 w-3.5"></lucide-angular>
        Editar con IA
      </span>
      <div data-testid="ai-instruction">
        <ui-input
          [placeholder]="placeholder()"
          [value]="instruction()"
          (valueChange)="instructionChange.emit($event)"
        ></ui-input>
      </div>
      <div data-testid="ai-revise" class="self-start">
        <ui-button
          variant="ghost"
          [loading]="loading()"
          [disabled]="loading()"
          (clicked)="revise.emit()"
        >
          <span class="flex items-center gap-1">
            <lucide-angular name="sparkles" class="h-4 w-4"></lucide-angular>
            Revisar con IA
          </span>
        </ui-button>
      </div>
      @if (error()) {
        <p data-testid="ai-error" class="text-sm text-hard-text" role="alert">{{ error() }}</p>
      }
    </div>
  `,
})
export class AiReviseBoxComponent {
  readonly instruction = input.required<string>();
  readonly loading = input.required<boolean>();
  readonly error = input.required<string | null>();
  readonly placeholder = input<string>('hazla más difícil, corrige el error…');

  readonly instructionChange = output<string>();
  readonly revise = output<void>();
}
