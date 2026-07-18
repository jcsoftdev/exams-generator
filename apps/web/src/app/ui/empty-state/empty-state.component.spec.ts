import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { EmptyStateComponent } from './empty-state.component';

@Component({
  standalone: true,
  imports: [EmptyStateComponent],
  template: `<ui-empty-state message="Banco vacío"></ui-empty-state>`,
})
class NoCtaHostComponent {}

@Component({
  standalone: true,
  imports: [EmptyStateComponent],
  template: `
    <ui-empty-state message="Aún no hay preguntas para este grado">
      <button cta data-testid="cta-upload">Subir preguntas</button>
      <button cta data-testid="cta-ai">✨ Generar con IA</button>
    </ui-empty-state>
  `,
})
class TwoCtaHostComponent {}

describe('EmptyStateComponent', () => {
  it('renders the message', () => {
    TestBed.configureTestingModule({ imports: [NoCtaHostComponent] });
    const fixture = TestBed.createComponent(NoCtaHostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Banco vacío');
  });

  it('renders NOTHING in the CTA slot when no CTA is projected', () => {
    TestBed.configureTestingModule({ imports: [NoCtaHostComponent] });
    const fixture = TestBed.createComponent(NoCtaHostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-testid="empty-state-cta"]')?.children.length ?? 0).toBe(0);
  });

  it('renders one or two projected CTAs when provided', () => {
    TestBed.configureTestingModule({ imports: [TwoCtaHostComponent] });
    const fixture = TestBed.createComponent(TwoCtaHostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-testid="cta-upload"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="cta-ai"]')).toBeTruthy();
  });
});
