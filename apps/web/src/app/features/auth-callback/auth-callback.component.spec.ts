import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { of, throwError } from 'rxjs';
import { Router } from '@angular/router';
import { AuthCallbackComponent } from './auth-callback.component';
import { AuthService } from '../../core/auth/auth.service';

const originalLocation = window.location;

function setHash(hash: string): void {
  Object.defineProperty(window, 'location', {
    writable: true,
    configurable: true,
    value: { ...originalLocation, hash },
  });
}

function setup(opts: { exchangeCodeImpl?: (...a: unknown[]) => unknown } = {}) {
  const exchangeCode = vi.fn(opts.exchangeCodeImpl ?? (() => of({ accessToken: 'jwt-abc' })));
  const applyToken = vi.fn();
  const navigateByUrl = vi.fn();
  TestBed.configureTestingModule({
    imports: [AuthCallbackComponent],
    providers: [
      { provide: AuthService, useValue: { exchangeCode, applyToken } },
      { provide: Router, useValue: { navigateByUrl } },
    ],
  });
  const fixture = TestBed.createComponent(AuthCallbackComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled, exchangeCode, applyToken, navigateByUrl };
}

describe('AuthCallbackComponent', () => {
  afterEach(() => {
    Object.defineProperty(window, 'location', { writable: true, configurable: true, value: originalLocation });
  });

  it('redeems the code from the URL fragment, stores the token, and navigates to /app', () => {
    setHash('#code=one-time-code');
    const { exchangeCode, applyToken, navigateByUrl } = setup();

    expect(exchangeCode).toHaveBeenCalledWith('one-time-code');
    expect(applyToken).toHaveBeenCalledWith('jwt-abc');
    expect(navigateByUrl).toHaveBeenCalledWith('/app');
  });

  it('shows an error and does not call exchangeCode when the fragment has no code', () => {
    setHash('');
    const { compiled, exchangeCode } = setup();

    expect(exchangeCode).not.toHaveBeenCalled();
    expect(compiled.querySelector('[data-testid="auth-callback-error"]')).toBeTruthy();
  });

  it('shows an error when the code is invalid or expired', () => {
    setHash('#code=stale-code');
    const { compiled } = setup({ exchangeCodeImpl: () => throwError(() => new Error('401')) });

    expect(compiled.querySelector('[data-testid="auth-callback-error"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/expiró o ya fue usado/i);
  });
});
