import { describe, it, expect } from 'vitest';
import { routes } from './app.routes';
import { authGuard } from './core/auth/auth.guard';
import { LoginComponent } from './features/login/login.component';
import { AuthCallbackComponent } from './features/auth-callback/auth-callback.component';
import { ShellComponent } from './features/shell/shell.component';
import { ForbiddenComponent } from './features/forbidden/forbidden.component';
import { NotFoundComponent } from './features/not-found/not-found.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { BankListComponent } from './features/bank/bank-list/bank-list.component';
import { BankNewComponent } from './features/bank/bank-new/bank-new.component';
import { ExamListComponent } from './features/exams/exam-list/exam-list.component';
import { ExamVersionsPanelComponent } from './features/exam-versions/exam-versions-panel/exam-versions-panel.component';
import { ExamBuilderComponent } from './features/exams/exam-builder/exam-builder.component';
import { ExamReviewComponent } from './features/exams/exam-review/exam-review.component';
import { AiGenerateComponent } from './features/ai/ai-generate/ai-generate.component';
import { GenerationJobDetailComponent } from './features/ai/generation-job-detail/generation-job-detail.component';
import { GenerationHistoryComponent } from './features/ai/generation-history/generation-history.component';
import { AiReviewQueueComponent } from './features/ai/ai-review-queue/ai-review-queue.component';
import { TenantSettingsComponent } from './features/tenant-settings/tenant-settings.component';
import { AdminTenantsComponent } from './features/admin-tenants/admin-tenants.component';

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
    const indexRoute = appRoute?.children?.find((route) => route.path === '' && route.redirectTo);
    expect(indexRoute?.redirectTo).toBe('dashboard');
  });

  describe('code-splitting (audit P2 — no route should statically import the whole app)', () => {
    // Login/auth-callback are on the critical first-paint path; lazy-loading
    // them would only add a round-trip. Forbidden/NotFound are tiny and rare.
    // Shell is the immediate landing target for any already-authenticated
    // session and is a thin layout shell — its heavy children below are what
    // actually get split out, so keeping Shell eager costs nothing.
    const eagerRoutes: Array<{ path: string; component: unknown }> = [
      { path: 'login', component: LoginComponent },
      { path: 'auth/callback', component: AuthCallbackComponent },
      { path: 'forbidden', component: ForbiddenComponent },
      { path: '**', component: NotFoundComponent },
      { path: 'app', component: ShellComponent },
    ];

    it.each(eagerRoutes)(
      'keeps $path eagerly loaded via `component`, not `loadComponent`',
      ({ path, component }) => {
        const route = routes.find((r) => r.path === path);
        expect(route?.component).toBe(component);
        expect(route?.loadComponent).toBeUndefined();
      },
    );

    // Every route reachable only once a user is inside the authenticated
    // shell is an obvious lazy-load candidate — none of it is needed for
    // /login or the initial shell paint.
    const lazyChildren: Array<{ path: string; component: unknown }> = [
      { path: 'dashboard', component: DashboardComponent },
      { path: 'bank', component: BankListComponent },
      { path: 'bank/new', component: BankNewComponent },
      { path: 'exams', component: ExamListComponent },
      { path: 'exams/new', component: ExamBuilderComponent },
      { path: 'exams/:examId', component: ExamReviewComponent },
      { path: 'exams/:examId/versions', component: ExamVersionsPanelComponent },
      { path: 'ai/generate', component: AiGenerateComponent },
      { path: 'ai/jobs', component: GenerationHistoryComponent },
      { path: 'ai/jobs/:id', component: GenerationJobDetailComponent },
      { path: 'ai/review', component: AiReviewQueueComponent },
      { path: 'settings', component: TenantSettingsComponent },
      { path: 'admin/tenants', component: AdminTenantsComponent },
    ];

    it.each(lazyChildren)(
      'lazy-loads /app/$path via `loadComponent`, not `component`',
      ({ path }) => {
        const appRoute = routes.find((route) => route.path === 'app');
        const child = appRoute?.children?.find((route) => route.path === path);
        expect(child).toBeTruthy();
        expect(child?.component).toBeUndefined();
        expect(typeof child?.loadComponent).toBe('function');
      },
    );

    it.each(lazyChildren)(
      'resolves /app/$path loadComponent to the correct component class',
      async ({ path, component }) => {
        const appRoute = routes.find((route) => route.path === 'app');
        const child = appRoute?.children?.find((route) => route.path === path);
        const resolved = await child?.loadComponent?.();
        expect(resolved).toBe(component);
      },
    );

    it('every /app child still resolves via component or loadComponent, never neither', () => {
      const appRoute = routes.find((route) => route.path === 'app');
      for (const child of appRoute?.children ?? []) {
        if (child.path === '') continue; // the dashboard redirect has no component
        expect(Boolean(child.component) || Boolean(child.loadComponent)).toBe(true);
      }
    });
  });
});
