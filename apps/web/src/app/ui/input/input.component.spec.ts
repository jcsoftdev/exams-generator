import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { InputComponent } from './input.component';

function setup() {
  const fixture = TestBed.createComponent(InputComponent);
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled };
}

describe('InputComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [InputComponent] });
  });

  it('renders a label when provided', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('label', 'Correo');
    fixture.detectChanges();

    expect(compiled.querySelector('label')?.textContent).toContain('Correo');
  });

  it('renders no label element when label is not provided', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    expect(compiled.querySelector('label')).toBeFalsy();
  });

  /**
   * Audit 2026-08-15: la grilla del builder monta 1,656 inputs numéricos sin
   * NINGÚN nombre accesible — el contexto curso·tema·dificultad de cada celda
   * era puramente visual. `label` no sirve ahí (pintaría texto dentro de cada
   * celda), así que el primitivo necesita un nombre invisible.
   */
  it('applies an invisible accessible name via ariaLabel, without rendering a label element', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('ariaLabel', 'Aritmética · Conjuntos · Fácil');
    fixture.detectChanges();

    const input = compiled.querySelector('input')!;
    expect(input.getAttribute('aria-label')).toBe('Aritmética · Conjuntos · Fácil');
    expect(compiled.querySelector('label')).toBeFalsy();
  });

  it('prefers the visible label over ariaLabel when both are set (no double naming)', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('label', 'Cantidad');
    fixture.componentRef.setInput('ariaLabel', 'otra cosa');
    fixture.detectChanges();

    expect(compiled.querySelector('label')!.textContent).toContain('Cantidad');
    expect(compiled.querySelector('input')!.getAttribute('aria-label')).toBeNull();
  });

  it('two-way binds the value via model()', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('value', 'hola');
    fixture.detectChanges();

    const control = compiled.querySelector<HTMLInputElement>('input')!;
    expect(control.value).toBe('hola');

    control.value = 'chau';
    control.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('chau');
  });

  it('renders type="number" when type is set to number', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('type', 'number');
    fixture.detectChanges();

    expect(compiled.querySelector('input')?.getAttribute('type')).toBe('number');
  });

  it('renders an error slot with Spanish-appropriate content, no default English copy', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('error', 'Este campo es obligatorio');
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="input-error"]')?.textContent).toContain(
      'Este campo es obligatorio',
    );
  });

  it('disables the control when disabled=true', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    expect(compiled.querySelector('input')?.hasAttribute('disabled')).toBe(true);
  });
});
