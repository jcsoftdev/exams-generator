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

  it('registers a bank list route under the protected /app shell', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const bankRoute = appRoute?.children?.find((route) => route.path === 'bank');
    expect(bankRoute).toBeTruthy();
  });

  it('registers a bank upload route under the protected /app shell', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const bankUploadRoute = appRoute?.children?.find((route) => route.path === 'bank/upload');
    expect(bankUploadRoute).toBeTruthy();
  });

  it('registers an exam versions panel route under the protected /app shell', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const versionsRoute = appRoute?.children?.find(
      (route) => route.path === 'exams/:examId/versions',
    );
    expect(versionsRoute).toBeTruthy();
  });

  it('registers an AI generation route under the protected /app shell', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const generateRoute = appRoute?.children?.find((route) => route.path === 'ai/generate');
    expect(generateRoute).toBeTruthy();
  });

  it('registers an AI draft review-queue route under the protected /app shell', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const reviewRoute = appRoute?.children?.find((route) => route.path === 'ai/review');
    expect(reviewRoute).toBeTruthy();
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
