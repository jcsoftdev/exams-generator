import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { AiReviseBoxComponent } from './ai-revise-box.component';

function setup(overrides: { loading?: boolean; error?: string | null } = {}) {
  const fixture = TestBed.createComponent(AiReviseBoxComponent);
  fixture.componentRef.setInput('instruction', '');
  fixture.componentRef.setInput('loading', overrides.loading ?? false);
  fixture.componentRef.setInput('error', overrides.error ?? null);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('AiReviseBoxComponent', () => {
  it('emits revise when the button is clicked', () => {
    const { fixture, compiled } = setup();
    let called = false;
    fixture.componentInstance.revise.subscribe(() => (called = true));

    (compiled.querySelector('[data-testid="ai-revise"] button') as HTMLButtonElement).click();

    expect(called).toBe(true);
  });

  it('disables the button while loading and never emits revise', () => {
    const { fixture, compiled } = setup({ loading: true });
    let called = false;
    fixture.componentInstance.revise.subscribe(() => (called = true));

    (compiled.querySelector('[data-testid="ai-revise"] button') as HTMLButtonElement).click();

    expect(called).toBe(false);
  });

  it('shows the error message when present', () => {
    const { compiled } = setup({ error: 'No se pudo revisar la pregunta con IA. Inténtalo de nuevo.' });
    expect(compiled.querySelector('[data-testid="ai-error"]')?.textContent).toContain('No se pudo revisar');
  });

  it('emits instructionChange as the user types', () => {
    const { fixture, compiled } = setup();
    let emitted: string | null = null;
    fixture.componentInstance.instructionChange.subscribe((v) => (emitted = v));

    const input = compiled.querySelector('input') as HTMLInputElement;
    input.value = 'hazla más difícil';
    input.dispatchEvent(new Event('input'));

    expect(emitted).toBe('hazla más difícil');
  });
});
