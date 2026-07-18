import { describe, it, expect } from 'vitest';
import { routes } from './app.routes';
import { authGuard } from './core/auth/auth.guard';

describe('app routes', () => {
  it('registers a public /login route', () => {
    const loginRoute = routes.find((route) => route.path === 'login');
    expect(loginRoute).toBeTruthy();
  });

  it('registers a public /forbidden route', () => {
    const forbiddenRoute = routes.find((route) => route.path === 'forbidden');
    expect(forbiddenRoute).toBeTruthy();
  });

  it('protects the /app shell route with authGuard', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    expect(appRoute?.canActivate).toContain(authGuard);
  });

  it('redirects the empty path to /app', () => {
    const emptyRoute = routes.find((route) => route.path === '' && route.redirectTo);
    expect(emptyRoute?.redirectTo).toBe('app');
  });

  it('redirects unknown paths to /login', () => {
    const wildcardRoute = routes.find((route) => route.path === '**');
    expect(wildcardRoute?.redirectTo).toBe('login');
  });
});
