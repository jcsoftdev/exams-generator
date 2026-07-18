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
