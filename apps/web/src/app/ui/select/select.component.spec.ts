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

function labelledByIds(button: HTMLButtonElement): string[] {
  return (button.getAttribute('aria-labelledby') ?? '').split(' ').filter(Boolean);
}

/** The concatenated text content of every element `aria-labelledby` references — what a screen reader would announce as the accessible name. */
function referencedText(compiled: HTMLElement, ids: readonly string[]): string {
  return ids
    .map((id) => compiled.querySelector(`#${id}`)?.textContent?.trim())
    .filter(Boolean)
    .join(' ');
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
    const labelledbyIds = labelledByIds(button);
    expect(labelledbyIds.length).toBeGreaterThan(0);

    const label = compiled.querySelector(`#${labelledbyIds[0]}`);
    expect(label?.tagName).toBe('LABEL');
    expect(label?.textContent).toContain('Grado');
  });

  it('omits aria-labelledby when no label is set', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    expect(trigger(compiled).hasAttribute('aria-labelledby')).toBe(false);
  });

  /**
   * M14: `aria-labelledby` used to reference the external `label()` alone,
   * so the trigger's accessible name never included the placeholder or the
   * selected option — two selects sharing a label ("Curso") sounded
   * identical to assistive tech regardless of what each one held.
   */
  it("references BOTH the label and the trigger's own value, so the accessible name includes what's selected (M14)", () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('label', 'Curso');
    fixture.componentRef.setInput('options', [{ value: 'math', label: 'Matemática' }]);
    fixture.componentRef.setInput('value', 'math');
    fixture.detectChanges();

    const button = trigger(compiled);
    const ids = labelledByIds(button);
    expect(ids).toHaveLength(2);

    expect(referencedText(compiled, ids)).toBe('Curso Matemática');
  });

  it('references the placeholder (not a selected option) when nothing is selected yet', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('label', 'Curso');
    fixture.componentRef.setInput('placeholder', 'Elige un curso');
    fixture.detectChanges();

    const button = trigger(compiled);
    const ids = labelledByIds(button);

    expect(referencedText(compiled, ids)).toBe('Curso Elige un curso');
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
    expect(opts.map((o) => o.textContent?.trim())).toEqual([
      'Elige un curso',
      'Curso A',
      'Curso B',
    ]);
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

    trigger(compiled).dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
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

  // D4 (audit M11): "ui-select renderiza el error sin aria-invalid" — same gap
  // ui-input already closed (input.component.ts:21-22), now closed here too.
  it('wires the trigger to the error text via aria-invalid + aria-describedby, the way ui-input already does', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('error', 'Selecciona una opción');
    fixture.detectChanges();

    const button = trigger(compiled);
    expect(button.getAttribute('aria-invalid')).toBe('true');
    const describedbyId = button.getAttribute('aria-describedby');
    expect(describedbyId).toBeTruthy();
    expect(compiled.querySelector(`#${describedbyId}`)?.textContent).toContain(
      'Selecciona una opción',
    );
  });

  it('omits aria-invalid/aria-describedby when there is no error', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    const button = trigger(compiled);
    expect(button.hasAttribute('aria-invalid')).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
  });

  it('renders aria-required="true" on the trigger when required=true', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('required', true);
    fixture.detectChanges();

    expect(trigger(compiled).getAttribute('aria-required')).toBe('true');
  });

  it('omits aria-required when required is not set', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    expect(trigger(compiled).hasAttribute('aria-required')).toBe(false);
  });
});
