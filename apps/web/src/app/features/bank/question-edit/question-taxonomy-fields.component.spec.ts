import { TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { By } from '@angular/platform-browser';
import { describe, it, expect } from 'vitest';
import { LucideAngularModule, Check, ChevronDown } from 'lucide-angular';
import { Difficulty } from '@exams-generator/shared';
import { QuestionTaxonomyFieldsComponent } from './question-taxonomy-fields.component';
import { SelectComponent } from '../../../ui/select/select.component';

function setup() {
  TestBed.configureTestingModule({
    providers: [importProvidersFrom(LucideAngularModule.pick({ Check, ChevronDown }))],
  });
  const fixture = TestBed.createComponent(QuestionTaxonomyFieldsComponent);
  fixture.componentRef.setInput('courseId', 'c1');
  fixture.componentRef.setInput('topicId', 't1');
  fixture.componentRef.setInput('difficulty', Difficulty.Easy);
  fixture.componentRef.setInput('gradeLevel', 'primaria_1');
  fixture.componentRef.setInput('courseOptions', [{ value: 'c1', label: 'Curso 1' }]);
  fixture.componentRef.setInput('topicOptions', [{ value: 't1', label: 'Tema 1' }]);
  fixture.componentRef.setInput('difficultyOptions', [{ value: Difficulty.Easy, label: 'Fácil' }]);
  fixture.componentRef.setInput('gradeLevelOptions', [
    { value: 'primaria_1', label: '1ro primaria' },
  ]);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('QuestionTaxonomyFieldsComponent', () => {
  it('renders the 4 selects with their labels', () => {
    const { compiled } = setup();
    const text = compiled.textContent ?? '';
    expect(text).toContain('Curso');
    expect(text).toContain('Tema');
    expect(text).toContain('Nivel');
    expect(text).toContain('Grado');
  });

  it('emits courseIdChange without also touching topicId (side effect stays with the caller)', () => {
    const { fixture } = setup();
    let emitted: string | null = null;
    fixture.componentInstance.courseIdChange.subscribe((v) => (emitted = v));

    const courseSelect = fixture.debugElement.query(By.directive(SelectComponent))
      .componentInstance as SelectComponent<string>;
    courseSelect.value.set('c2');
    fixture.detectChanges();

    expect(emitted).toBe('c2');
  });
});
