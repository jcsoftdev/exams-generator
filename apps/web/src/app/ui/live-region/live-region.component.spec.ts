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
  it('renders a visually-hidden, polite-by-default aria-live region', () => {
    const { compiled } = setup();
    const region = compiled.querySelector('[data-testid="live-region"]');
    expect(region).toBeTruthy();
    expect(region?.getAttribute('aria-live')).toBe('polite');
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
});
