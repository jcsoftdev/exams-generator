import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Sesión expirada: cualquier 401 (salvo el propio login) limpia la sesión y
 * manda a /login con la marca ?expired=1 para mostrar "Tu sesión expiró".
 */
export const authErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return next(req).pipe(
    catchError((error: unknown) => {
      const isLoginCall = req.url.includes('/auth/login');
      if (error instanceof HttpErrorResponse && error.status === 401 && !isLoginCall) {
        authService.logout();
        router.navigateByUrl('/login?expired=1');
      }
      return throwError(() => error);
    }),
  );
};
