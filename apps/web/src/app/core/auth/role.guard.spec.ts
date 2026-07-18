import { TestBed } from '@angular/core/testing';
import { Router, UrlTree } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { Role } from '@exams-generator/shared';
import { roleGuard } from './role.guard';
import { AuthService } from './auth.service';

function runGuard(currentRole: Role | null, ...allowedRoles: Role[]) {
  const parsedForbiddenUrl = {} as UrlTree;
  const parseUrl = vi.fn().mockReturnValue(parsedForbiddenUrl);

  TestBed.configureTestingModule({
    providers: [
      { provide: AuthService, useValue: { currentRole: () => currentRole } },
      { provide: Router, useValue: { parseUrl } },
    ],
  });

  const guard = roleGuard(...allowedRoles);
  const result = TestBed.runInInjectionContext(() => guard({} as never, {} as never));

  return { result, parseUrl, parsedForbiddenUrl };
}

describe('roleGuard', () => {
  it('allows navigation when the current role is in the allowed list', () => {
    const { result, parseUrl } = runGuard(Role.Teacher, Role.Teacher, Role.SchoolAdmin);

    expect(result).toBe(true);
    expect(parseUrl).not.toHaveBeenCalled();
  });

  it('redirects to /forbidden when the current role is not allowed', () => {
    const { result, parseUrl, parsedForbiddenUrl } = runGuard(Role.Teacher, Role.PlatformAdmin);

    expect(parseUrl).toHaveBeenCalledWith('/forbidden');
    expect(result).toBe(parsedForbiddenUrl);
  });

  it('redirects to /forbidden when there is no current role', () => {
    const { result, parseUrl } = runGuard(null, Role.Teacher);

    expect(parseUrl).toHaveBeenCalled();
    expect(result).not.toBe(true);
  });
});
