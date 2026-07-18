import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { SelectComponent } from './select.component';

function setup() {
  const fixture = TestBed.createComponent(SelectComponent);
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled };
}

describe('SelectComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [SelectComponent] });
  });

  it('renders one <option> per entry in options', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [
      { value: 'a', label: 'Curso A' },
      { value: 'b', label: 'Curso B' },
    ]);
    fixture.detectChanges();

    const options = compiled.querySelectorAll('option');
    const labels = Array.from(options).map((o) => o.textContent?.trim());
    expect(labels).toContain('Curso A');
    expect(labels).toContain('Curso B');
  });

  it('two-way binds the selected value via model()', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [
      { value: 'a', label: 'Curso A' },
      { value: 'b', label: 'Curso B' },
    ]);
    fixture.detectChanges();

    const select = compiled.querySelector<HTMLSelectElement>('select')!;
    select.value = 'b';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('b');
  });

  it('disables the control when disabled=true', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    expect(compiled.querySelector('select')?.hasAttribute('disabled')).toBe(true);
  });

  it('renders an error slot when error is set', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('error', 'Selecciona una opción');
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="select-error"]')?.textContent).toContain(
      'Selecciona una opción',
    );
  });
});
