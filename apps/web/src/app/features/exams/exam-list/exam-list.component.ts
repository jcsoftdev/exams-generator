import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-exam-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="exam-list-root"></div>`,
})
export class ExamListComponent {}
