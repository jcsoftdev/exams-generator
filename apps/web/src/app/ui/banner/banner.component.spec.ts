import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { BannerComponent } from './banner.component';

function setup() {
  const fixture = TestBed.createComponent(BannerComponent);
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled };
}

describe('BannerComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [BannerComponent] });
  });

  it.each(['info', 'success', 'warning', 'error'] as const)(
    'renders the %s variant with a solid-fill class (no gradient)',
    (variant) => {
      const { fixture, compiled } = setup();
      fixture.componentRef.setInput('variant', variant);
      fixture.componentRef.setInput('message', 'Mensaje de prueba');
      fixture.detectChanges();

      const el = compiled.querySelector('[data-testid="banner"]')!;
      expect(el.className).not.toContain('gradient');
      expect(compiled.textContent).toContain('Mensaje de prueba');
    },
  );

  it('shows a close button and emits dismissed when dismissible=true', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('variant', 'info');
    fixture.componentRef.setInput('message', 'Aviso');
    fixture.componentRef.setInput('dismissible', true);
    fixture.detectChanges();

    let dismissed = false;
    fixture.componentInstance.dismissed.subscribe(() => (dismissed = true));

    compiled.querySelector<HTMLButtonElement>('[data-testid="banner-close"]')!.click();
    expect(dismissed).toBe(true);
  });

  it('renders no close button when dismissible=false', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('variant', 'info');
    fixture.componentRef.setInput('message', 'Aviso');
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="banner-close"]')).toBeFalsy();
  });
});
