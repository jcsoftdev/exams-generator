import { TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { describe, it, expect } from 'vitest';
import { LucideAngularModule, Check, ChevronDown } from 'lucide-angular';
import { QuestionContentFieldsComponent } from './question-content-fields.component';

function setup() {
  TestBed.configureTestingModule({
    providers: [importProvidersFrom(LucideAngularModule.pick({ Check, ChevronDown }))],
  });
  const fixture = TestBed.createComponent(QuestionContentFieldsComponent);
  fixture.componentRef.setInput('body', '¿Cuánto es 2+2?');
  fixture.componentRef.setInput('alternatives', '4\n3\n5');
  fixture.componentRef.setInput('correctAnswer', '0');
  fixture.componentRef.setInput('correctAnswerOptions', [
    { value: '0', label: 'a) 4' },
    { value: '1', label: 'b) 3' },
    { value: '2', label: 'c) 5' },
  ]);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('QuestionContentFieldsComponent', () => {
  it('renders body and alternatives in their textareas', () => {
    const { compiled } = setup();
    const body = compiled.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
    const alternatives = compiled.querySelector(
      '[data-testid="edit-alternatives"]',
    ) as HTMLTextAreaElement;
    expect(body.value).toBe('¿Cuánto es 2+2?');
    expect(alternatives.value).toBe('4\n3\n5');
  });

  it('emits bodyChange/alternativesChange on input', () => {
    const { fixture, compiled } = setup();
    let body: string | null = null;
    let alternatives: string | null = null;
    fixture.componentInstance.bodyChange.subscribe((v) => (body = v));
    fixture.componentInstance.alternativesChange.subscribe((v) => (alternatives = v));

    const bodyEl = compiled.querySelector('[data-testid="edit-enunciado"]') as HTMLTextAreaElement;
    bodyEl.value = 'nuevo enunciado';
    bodyEl.dispatchEvent(new Event('input'));

    const altEl = compiled.querySelector(
      '[data-testid="edit-alternatives"]',
    ) as HTMLTextAreaElement;
    altEl.value = '1\n2';
    altEl.dispatchEvent(new Event('input'));

    expect(body).toBe('nuevo enunciado');
    expect(alternatives).toBe('1\n2');
  });

  it('renders the clave select with the given options', () => {
    const { compiled } = setup();
    const select = compiled.querySelector('[data-testid="edit-correct-answer"]');
    expect(select?.textContent).toContain('Clave');
  });
});
