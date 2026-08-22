import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { LucideAngularModule, Sparkles, TriangleAlert } from 'lucide-angular';
import { ButtonComponent } from '../../../ui/button/button.component';
import { InputComponent } from '../../../ui/input/input.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { CellStatus } from './exam-builder.store';

/**
 * One grid cell's content (count input + stock indicator + "bajo stock"
 * bridge-to-AI actions + preview-ids) — byte-identical markup previously
 * hand-duplicated between the desktop `<table>` and the mobile stacked-card
 * layout in `exam-builder.component.html` (audit P2, "giant components").
 * Only the wrapping element differs (`<td>` vs `<div>`), which stays in the
 * parent template; this component is the shared cell CONTENT only.
 */
@Component({
  selector: 'app-grid-cell-content',
  standalone: true,
  imports: [ButtonComponent, InputComponent, TagComponent, LucideAngularModule],
  providers: [LucideAngularModule.pick({ Sparkles, TriangleAlert }).providers ?? []],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ui-input
      type="number"
      [name]="inputName()"
      [ariaLabel]="'Preguntas de ' + cellLabel()"
      [value]="requestedStr()"
      (valueChange)="requestedChange.emit($event)"
    ></ui-input>

    @if (status() === 'ok') {
      <span data-testid="stock-ok" [class]="stockOkClasses()">de {{ stock() }}</span>
    } @else {
      <ui-tag data-testid="stock-warning" variant="warning-stock"
        >solo {{ stock() }}
        <lucide-icon
          name="triangle-alert"
          data-testid="stock-warning-icon"
          [size]="14"
        ></lucide-icon
      ></ui-tag>
      <div data-testid="bridge-to-ai" class="mt-2 flex flex-col gap-1">
        <ui-button
          data-testid="bridge-generate-ai"
          variant="ghost"
          [ariaLabel]="'Generar ' + (requested() - stock()) + ' con IA para ' + cellLabel()"
          (clicked)="generateAi.emit()"
        >
          <lucide-icon name="sparkles" [size]="16"></lucide-icon>
          Generar {{ requested() - stock() }} con IA
        </ui-button>
        <ui-button
          data-testid="bridge-choose-bank"
          variant="ghost"
          [ariaLabel]="'Elegir del banco para ' + cellLabel()"
          (clicked)="chooseBank.emit()"
          >Elegir del banco</ui-button
        >
        <ui-button
          data-testid="bridge-lower-count"
          variant="ghost"
          [ariaLabel]="'Bajar la cantidad de ' + cellLabel() + ' a ' + stock()"
          (clicked)="lowerCount.emit()"
          >Bajar la cantidad</ui-button
        >
      </div>
    }

    <div data-testid="preview-ids" [attr.data-cell-key]="cellKey()" class="mt-1 text-xs text-n500">
      {{ previewIds().join(',') }}
    </div>
  `,
})
export class GridCellContentComponent {
  readonly inputName = input.required<string>();
  readonly cellKey = input.required<string>();
  readonly requestedStr = input.required<string>();
  readonly requested = input.required<number>();
  readonly stock = input.required<number>();
  readonly status = input.required<CellStatus>();
  readonly stockOkClasses = input.required<string>();
  readonly previewIds = input.required<readonly string[]>();
  /**
   * Human name of this cell ("Curso · Tema · Dificultad"), used only as the
   * accessible name of the controls inside it. Nothing renders it: the grid
   * conveys the same information by position, which is exactly what a screen
   * reader cannot see (audit 2026-08-15). It also disambiguates the three
   * bridge buttons, which are byte-identical text across every short cell.
   */
  readonly cellLabel = input.required<string>();

  readonly requestedChange = output<string>();
  readonly generateAi = output<void>();
  readonly chooseBank = output<void>();
  readonly lowerCount = output<void>();
}
