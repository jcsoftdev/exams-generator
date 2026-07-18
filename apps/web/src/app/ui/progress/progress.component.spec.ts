import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ProgressComponent } from './progress.component';

function setup() {
  const fixture = TestBed.createComponent(ProgressComponent);
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled };
}

describe('ProgressComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ProgressComponent] });
  });

  it('renders a ~37.5% fill and the "3 de 8" label for current=3, total=8', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('current', 3);
    fixture.componentRef.setInput('total', 8);
    fixture.detectChanges();

    expect(compiled.textContent).toContain('3 de 8');
    const fill = compiled.querySelector<HTMLElement>('[data-testid="progress-fill"]')!;
    expect(fill.style.width).toBe('37.5%');
  });

  it('does not divide by zero when total=0 — renders 0% fill', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('current', 0);
    fixture.componentRef.setInput('total', 0);
    fixture.detectChanges();

    const fill = compiled.querySelector<HTMLElement>('[data-testid="progress-fill"]')!;
    expect(fill.style.width).toBe('0%');
    expect(compiled.textContent).toContain('0 de 0');
  });
});
