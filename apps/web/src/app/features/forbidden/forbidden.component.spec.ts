import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { ForbiddenComponent } from './forbidden.component';

describe('ForbiddenComponent', () => {
  it('shows a 403 forbidden message', async () => {
    await TestBed.configureTestingModule({
      imports: [ForbiddenComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(ForbiddenComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('403');
  });
});
