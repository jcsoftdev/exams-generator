import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { LiveRegionComponent } from './live-region.component';
import { LiveAnnouncerService } from './live-announcer.service';

function setup() {
  const fixture = TestBed.createComponent(LiveRegionComponent);
  const compiled = fixture.nativeElement as HTMLElement;
  fixture.detectChanges();
  return { fixture, compiled, announcer: TestBed.inject(LiveAnnouncerService) };
}

describe('LiveRegionComponent', () => {
  it('renders a visually-hidden, polite-by-default aria-live region with role="status"', () => {
    const { compiled } = setup();
    const region = compiled.querySelector('[data-testid="live-region"]');
    expect(region).toBeTruthy();
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('role')).toBe('status');
    expect(region?.className).toContain('sr-only');
  });

  it('announcing through the service updates the live region text', () => {
    const { compiled, fixture, announcer } = setup();
    announcer.announce('Pregunta guardada.');
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="live-region"]')?.textContent).toContain(
      'Pregunta guardada.',
    );
  });

  it('reflects an assertive announcement via aria-live', () => {
    const { compiled, fixture, announcer } = setup();
    announcer.announce('Error crítico.', 'assertive');
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="live-region"]')?.getAttribute('aria-live')).toBe(
      'assertive',
    );
  });

  // audit crop-review/live-region #8: `role="status"` never changed even
  // when `aria-live` flipped to `assertive` — the two must move together
  // (`role="alert"` implies assertive; `role="status"` implies polite).
  it('switches role from "status" to "alert" for an assertive announcement, and back for a polite one', () => {
    const { compiled, fixture, announcer } = setup();

    announcer.announce('Error crítico.', 'assertive');
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="live-region"]')?.getAttribute('role')).toBe(
      'alert',
    );

    announcer.announce('Pregunta guardada.', 'polite');
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="live-region"]')?.getAttribute('role')).toBe(
      'status',
    );
  });

  // audit crop-review/live-region #7: two identical, back-to-back
  // announcements must BOTH actually change the rendered DOM text — a live
  // region that never mutates never gets re-announced by assistive tech.
  it('re-renders the DOM text on a second, identical announcement', () => {
    const { compiled, fixture, announcer } = setup();

    announcer.announce('Pregunta guardada.');
    fixture.detectChanges();
    const first = compiled.querySelector('[data-testid="live-region"]')?.textContent;

    announcer.announce('Pregunta guardada.');
    fixture.detectChanges();
    const second = compiled.querySelector('[data-testid="live-region"]')?.textContent;

    expect(first).toContain('Pregunta guardada.');
    expect(second).toContain('Pregunta guardada.');
    expect(second).not.toBe(first);
  });
});
