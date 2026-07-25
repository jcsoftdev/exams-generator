import { TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { LucideAngularModule, Check, ChevronDown } from 'lucide-angular';
import { SelectComponent } from './select.component';

function setup() {
  const fixture = TestBed.createComponent(SelectComponent);
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled };
}

function trigger(compiled: HTMLElement): HTMLButtonElement {
  return compiled.querySelector('button[role="combobox"]') as HTMLButtonElement;
}

function options(compiled: HTMLElement): HTMLLIElement[] {
  return Array.from(compiled.querySelectorAll('[data-testid="select-option"]'));
}

function openViaClick(compiled: HTMLElement, fixture: { detectChanges: () => void }): void {
  trigger(compiled).click();
  fixture.detectChanges();
}

describe('SelectComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [SelectComponent],
      providers: [importProvidersFrom(LucideAngularModule.pick({ Check, ChevronDown }))],
    });
  });

  it('associates the label with the trigger via aria-labelledby, for screen readers', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('label', 'Grado');
    fixture.detectChanges();

    const button = trigger(compiled);
    const labelledbyId = button.getAttribute('aria-labelledby');
    expect(labelledbyId).toBeTruthy();

    const label = compiled.querySelector(`#${labelledbyId}`);
    expect(label?.tagName).toBe('LABEL');
    expect(label?.textContent).toContain('Grado');
  });

  it('omits aria-labelledby when no label is set', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    expect(trigger(compiled).hasAttribute('aria-labelledby')).toBe(false);
  });

  it('renders a trigger button showing the placeholder (dimmed) when nothing is selected', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('placeholder', 'Elige un curso');
    fixture.detectChanges();

    const button = trigger(compiled);
    expect(button.textContent).toContain('Elige un curso');
    expect(button.querySelector('span')?.className).toContain('text-n400');
  });

  it('renders the selected option label (not dimmed) when a value is set', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [
      { value: 'a', label: 'Curso A' },
      { value: 'b', label: 'Curso B' },
    ]);
    fixture.componentRef.setInput('placeholder', 'Elige un curso');
    fixture.componentRef.setInput('value', 'b');
    fixture.detectChanges();

    const button = trigger(compiled);
    expect(button.textContent).toContain('Curso B');
    expect(button.querySelector('span')?.className).not.toContain('text-n400');
  });

  it('is closed by default and opens the listbox on trigger click', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [{ value: 'a', label: 'Curso A' }]);
    fixture.detectChanges();

    expect(compiled.querySelector('[role="listbox"]')).toBeFalsy();
    expect(trigger(compiled).getAttribute('aria-expanded')).toBe('false');

    openViaClick(compiled, fixture);

    expect(compiled.querySelector('[role="listbox"]')).toBeTruthy();
    expect(trigger(compiled).getAttribute('aria-expanded')).toBe('true');
  });

  it('opens the closed trigger on ArrowDown, Enter, and Space', () => {
    for (const key of ['ArrowDown', 'Enter', ' ']) {
      const { fixture, compiled } = setup();
      fixture.componentRef.setInput('options', [{ value: 'a', label: 'Curso A' }]);
      fixture.detectChanges();

      trigger(compiled).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      fixture.detectChanges();

      expect(compiled.querySelector('[role="listbox"]')).toBeTruthy();
    }
  });

  it('renders one <li role="option"> per entry in options, plus the placeholder as the first selectable entry', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('placeholder', 'Elige un curso');
    fixture.componentRef.setInput('options', [
      { value: 'a', label: 'Curso A' },
      { value: 'b', label: 'Curso B' },
    ]);
    fixture.detectChanges();

    openViaClick(compiled, fixture);

    const opts = options(compiled);
    expect(opts.map((o) => o.textContent?.trim())).toEqual(['Elige un curso', 'Curso A', 'Curso B']);
  });

  it('clicking an option sets value and closes the panel', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [
      { value: 'a', label: 'Curso A' },
      { value: 'b', label: 'Curso B' },
    ]);
    fixture.detectChanges();

    openViaClick(compiled, fixture);
    options(compiled)[1].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('b');
    expect(compiled.querySelector('[role="listbox"]')).toBeFalsy();
  });

  it('clicking the placeholder option clears the value to null', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('placeholder', 'Elige un curso');
    fixture.componentRef.setInput('options', [{ value: 'a', label: 'Curso A' }]);
    fixture.componentRef.setInput('value', 'a');
    fixture.detectChanges();

    openViaClick(compiled, fixture);
    options(compiled)[0].click();
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBeNull();
  });

  it('shows a checkmark next to the currently-selected option only', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [
      { value: 'a', label: 'Curso A' },
      { value: 'b', label: 'Curso B' },
    ]);
    fixture.componentRef.setInput('value', 'b');
    fixture.detectChanges();

    openViaClick(compiled, fixture);

    const opts = options(compiled);
    expect(opts[0].querySelector('svg')).toBeFalsy();
    expect(opts[1].querySelector('svg')).toBeTruthy();
  });

  it('ArrowDown/ArrowUp move the highlighted option, clamped at the ends', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [
      { value: 'a', label: 'Curso A' },
      { value: 'b', label: 'Curso B' },
      { value: 'c', label: 'Curso C' },
    ]);
    fixture.detectChanges();

    openViaClick(compiled, fixture);
    const btn = trigger(compiled);

    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(options(compiled)[1].className).toContain('bg-tint-active');

    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(options(compiled)[2].className).toContain('bg-tint-active');

    // Clamped — does not wrap past the last option.
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(options(compiled)[2].className).toContain('bg-tint-active');

    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    fixture.detectChanges();
    expect(options(compiled)[1].className).toContain('bg-tint-active');
  });

  it('Enter selects the highlighted option and closes the panel', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [
      { value: 'a', label: 'Curso A' },
      { value: 'b', label: 'Curso B' },
    ]);
    fixture.detectChanges();

    openViaClick(compiled, fixture);
    const btn = trigger(compiled);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.value()).toBe('b');
    expect(compiled.querySelector('[role="listbox"]')).toBeFalsy();
  });

  it('Escape closes the panel without changing the selection', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [
      { value: 'a', label: 'Curso A' },
      { value: 'b', label: 'Curso B' },
    ]);
    fixture.componentRef.setInput('value', 'a');
    fixture.detectChanges();

    openViaClick(compiled, fixture);
    const btn = trigger(compiled);
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(compiled.querySelector('[role="listbox"]')).toBeFalsy();
    expect(fixture.componentInstance.value()).toBe('a');
  });

  it('Tab closes the panel without trapping focus (does not preventDefault)', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [{ value: 'a', label: 'Curso A' }]);
    fixture.detectChanges();

    openViaClick(compiled, fixture);
    const btn = trigger(compiled);
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    btn.dispatchEvent(event);
    fixture.detectChanges();

    expect(compiled.querySelector('[role="listbox"]')).toBeFalsy();
    expect(event.defaultPrevented).toBe(false);
  });

  it('closes when clicking outside the component, without changing the selection', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [{ value: 'a', label: 'Curso A' }]);
    fixture.componentRef.setInput('value', 'a');
    fixture.detectChanges();

    openViaClick(compiled, fixture);
    expect(compiled.querySelector('[role="listbox"]')).toBeTruthy();

    document.body.click();
    fixture.detectChanges();

    expect(compiled.querySelector('[role="listbox"]')).toBeFalsy();
    expect(fixture.componentInstance.value()).toBe('a');
  });

  it('does not open when disabled, via click or keyboard', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('options', [{ value: 'a', label: 'Curso A' }]);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    expect(trigger(compiled).hasAttribute('disabled')).toBe(true);
    expect(trigger(compiled).className).toContain('disabled:cursor-not-allowed');
    expect(trigger(compiled).className).toContain('disabled:bg-n100');

    trigger(compiled).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();

    expect(compiled.querySelector('[role="listbox"]')).toBeFalsy();
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
