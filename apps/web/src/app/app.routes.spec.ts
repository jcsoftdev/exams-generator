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

  it('does not register the removed legacy /app/bank/upload route (audit P1 — /app/bank/new is the only intake now)', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const bankUploadRoute = appRoute?.children?.find((route) => route.path === 'bank/upload');
    expect(bankUploadRoute).toBeUndefined();
  });

  it('exposes /app/bank/new', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const bankNewRoute = appRoute?.children?.find((route) => route.path === 'bank/new');
    expect(bankNewRoute).toBeTruthy();
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

  it('registers a tenant-settings route under the protected /app shell (additive, TS.2)', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const settingsRoute = appRoute?.children?.find((route) => route.path === 'settings');
    expect(settingsRoute).toBeTruthy();
  });

  it('guards /app/settings with a role guard', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const settingsRoute = appRoute?.children?.find((route) => route.path === 'settings');
    expect(settingsRoute?.canActivate?.length).toBeGreaterThan(0);
  });

  it('exposes /app/admin/tenants guarded by a role guard (platform_admin)', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const adminRoute = appRoute?.children?.find((route) => route.path === 'admin/tenants');
    expect(adminRoute).toBeTruthy();
    expect(adminRoute?.canActivate?.length).toBeGreaterThan(0);
  });

  it('exposes /app/exams as the exam list index', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const examsRoute = appRoute?.children?.find((route) => route.path === 'exams');
    expect(examsRoute).toBeTruthy();
  });

  it('exposes /app/exams/new as the exam builder', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const examsNewRoute = appRoute?.children?.find((route) => route.path === 'exams/new');
    expect(examsNewRoute).toBeTruthy();
  });

  it('guards every /app/exams* route with a role guard — the backend exams controller rejects anything but Teacher/SchoolAdmin, so other roles must hit /forbidden instead of a dead 403 screen', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    for (const path of ['exams', 'exams/new', 'exams/:examId', 'exams/:examId/versions']) {
      const examsRoute = appRoute?.children?.find((route) => route.path === path);
      expect(examsRoute).toBeTruthy();
      expect(examsRoute?.canActivate?.length).toBeGreaterThan(0);
    }
  });

  it('redirects the empty path to /app', () => {
    const emptyRoute = routes.find((route) => route.path === '' && route.redirectTo);
    expect(emptyRoute?.redirectTo).toBe('app');
  });

  it('shows a real 404 page for unknown paths instead of redirecting to /login', () => {
    const wildcardRoute = routes.find((route) => route.path === '**');
    expect(wildcardRoute?.redirectTo).toBeUndefined();
    expect(wildcardRoute?.component).toBeTruthy();
  });

  it('exposes /app/dashboard under the protected /app shell', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const dashboardRoute = appRoute?.children?.find((route) => route.path === 'dashboard');
    expect(dashboardRoute).toBeTruthy();
  });

  it('redirects the empty /app child path to dashboard (design doc §4)', () => {
    const appRoute = routes.find((route) => route.path === 'app');
    const indexRoute = appRoute?.children?.find(
      (route) => route.path === '' && route.redirectTo,
    );
    expect(indexRoute?.redirectTo).toBe('dashboard');
  });
});
