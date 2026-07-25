import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { TabsComponent } from './tabs.component';

function setup() {
  const fixture = TestBed.createComponent(TabsComponent);
  fixture.componentRef.setInput('tabs', [
    { value: 'a', label: 'A', testId: 'tab-a' },
    { value: 'b', label: 'B', testId: 'tab-b' },
  ]);
  fixture.componentRef.setInput('value', 'a');
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('TabsComponent', () => {
  it('renders every tab with its testId and marks the active one aria-selected', () => {
    const { compiled } = setup();

    const a = compiled.querySelector('[data-testid="tab-a"]')!;
    const b = compiled.querySelector('[data-testid="tab-b"]')!;
    expect(a.textContent?.trim()).toBe('A');
    expect(a.getAttribute('aria-selected')).toBe('true');
    expect(b.getAttribute('aria-selected')).toBe('false');
  });

  it('emits valueChange with the clicked tab value, without mutating its own state', () => {
    const { fixture, compiled } = setup();
    let emitted: unknown = null;
    fixture.componentInstance.valueChange.subscribe((v) => (emitted = v));

    (compiled.querySelector('[data-testid="tab-b"]') as HTMLButtonElement).click();

    expect(emitted).toBe('b');
  });
});
