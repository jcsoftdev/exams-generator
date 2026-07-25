import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { ForbiddenComponent } from './forbidden.component';

describe('ForbiddenComponent', () => {
  function setup() {
    const navigateByUrl = vi.fn();
    TestBed.configureTestingModule({
      imports: [ForbiddenComponent],
      providers: [{ provide: Router, useValue: { navigateByUrl } }],
    });
    const fixture = TestBed.createComponent(ForbiddenComponent);
    fixture.detectChanges();
    return { fixture, compiled: fixture.nativeElement as HTMLElement, navigateByUrl };
  }

  it('shows a Spanish no-access message, not the raw HTTP status page', () => {
    const { compiled } = setup();

    expect(compiled.textContent).toContain('No tienes acceso a esta página');
    expect(compiled.textContent).not.toContain('Forbidden');
  });

  it('navigates back to the dashboard when the CTA is clicked', () => {
    const { compiled, navigateByUrl } = setup();

    compiled.querySelector('button')!.click();

    expect(navigateByUrl).toHaveBeenCalledWith('/app/dashboard');
  });
});
