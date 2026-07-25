import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { NotFoundComponent } from './not-found.component';

describe('NotFoundComponent', () => {
  function setup() {
    const navigateByUrl = vi.fn();
    TestBed.configureTestingModule({
      imports: [NotFoundComponent],
      providers: [{ provide: Router, useValue: { navigateByUrl } }],
    });
    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();
    return { fixture, compiled: fixture.nativeElement as HTMLElement, navigateByUrl };
  }

  it('shows a not-found message, not a silent redirect', () => {
    const { compiled } = setup();

    expect(compiled.textContent).toContain('Página no encontrada');
  });

  it('navigates back to the dashboard when the CTA is clicked', () => {
    const { compiled, navigateByUrl } = setup();

    compiled.querySelector('button')!.click();

    expect(navigateByUrl).toHaveBeenCalledWith('/app/dashboard');
  });
});
