import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { Role } from '@exams-generator/shared';
import { AuthService } from './auth.service';

export function roleGuard(...allowedRoles: Role[]): CanActivateFn {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    const currentRole = authService.currentRole();
    if (currentRole !== null && allowedRoles.includes(currentRole)) {
      return true;
    }

    return router.parseUrl('/forbidden');
  };
}
