import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

function runGuard(isAuthenticated: boolean) {
  const parsedLoginUrl = {} as UrlTree;
  const parseUrl = vi.fn().mockReturnValue(parsedLoginUrl);

  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { isAuthenticated: () => isAuthenticated } },
      { provide: Router, useValue: { parseUrl } },
    ],
  });

  const result = TestBed.runInInjectionContext(() =>
    authGuard({} as never, {} as never),
  );

  return { result, parseUrl, parsedLoginUrl };
}

describe('authGuard', () => {
  it('allows navigation when the user is authenticated', () => {
    const { result, parseUrl } = runGuard(true);

    expect(result).toBe(true);
    expect(parseUrl).not.toHaveBeenCalled();
  });

  it('redirects to /login when the user is not authenticated', () => {
    const { result, parseUrl, parsedLoginUrl } = runGuard(false);

    expect(parseUrl).toHaveBeenCalledWith('/login');
    expect(result).toBe(parsedLoginUrl);
  });
});
