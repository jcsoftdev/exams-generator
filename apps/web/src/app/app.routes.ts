import { Routes } from '@angular/router';
import { Role } from '@exams-generator/shared';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';
import { bankNewLeaveGuard } from './features/bank/bank-new/bank-new-leave.guard';
import { EXAMS_ROLES } from './features/exams/exams.roles';
import { LoginComponent } from './features/login/login.component';
import { AuthCallbackComponent } from './features/auth-callback/auth-callback.component';
import { ShellComponent } from './features/shell/shell.component';
import { ForbiddenComponent } from './features/forbidden/forbidden.component';
import { NotFoundComponent } from './features/not-found/not-found.component';

const TITLE_SUFFIX = ' · GeneraExamen';

export const routes: Routes = [
  // Login/auth-callback are on the critical first-paint path — lazy-loading
  // them would only add a network round-trip for no bundle-size benefit, so
  // they stay statically imported.
  { path: 'login', component: LoginComponent, title: `Iniciar sesión${TITLE_SUFFIX}` },
  {
    path: 'auth/callback',
    component: AuthCallbackComponent,
    title: `Iniciando sesión${TITLE_SUFFIX}`,
  },
  { path: 'forbidden', component: ForbiddenComponent, title: `Sin acceso${TITLE_SUFFIX}` },
  {
    path: 'app',
    // ShellComponent is the immediate landing target for any already
    // authenticated session (persisted token) and is a thin layout/nav
    // shell — the actual weight (katex, chart.js, the bank tree, the exam
    // builder) lives in its children below, which are what get split out.
    // Lazy-loading Shell itself would only add a round-trip to the most
    // common navigation with no measurable bundle win.
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
        title: `Panel${TITLE_SUFFIX}`,
      },
      {
        path: 'bank',
        loadComponent: () =>
          import('./features/bank/bank-list/bank-list.component').then((m) => m.BankListComponent),
        title: `Banco de preguntas${TITLE_SUFFIX}`,
      },
      {
        path: 'bank/new',
        loadComponent: () =>
          import('./features/bank/bank-new/bank-new.component').then((m) => m.BankNewComponent),
        canDeactivate: [bankNewLeaveGuard],
        title: `Nueva pregunta${TITLE_SUFFIX}`,
      },
      // The backend exams controller is @Roles(Teacher, SchoolAdmin) — any
      // other role would only hit 403s, so the routes themselves refuse
      // navigation (to /forbidden) and the shell hides the nav item.
      {
        path: 'exams',
        loadComponent: () =>
          import('./features/exams/exam-list/exam-list.component').then((m) => m.ExamListComponent),
        canActivate: [roleGuard(...EXAMS_ROLES)],
        title: `Exámenes${TITLE_SUFFIX}`,
      },
      {
        path: 'exams/new',
        loadComponent: () =>
          import('./features/exams/exam-builder/exam-builder.component').then(
            (m) => m.ExamBuilderComponent,
          ),
        canActivate: [roleGuard(...EXAMS_ROLES)],
        title: `Nuevo examen${TITLE_SUFFIX}`,
      },
      {
        path: 'exams/:examId',
        loadComponent: () =>
          import('./features/exams/exam-review/exam-review.component').then(
            (m) => m.ExamReviewComponent,
          ),
        canActivate: [roleGuard(...EXAMS_ROLES)],
        title: `Revisar examen${TITLE_SUFFIX}`,
      },
      {
        path: 'exams/:examId/versions',
        loadComponent: () =>
          import('./features/exam-versions/exam-versions-panel/exam-versions-panel.component').then(
            (m) => m.ExamVersionsPanelComponent,
          ),
        canActivate: [roleGuard(...EXAMS_ROLES)],
        title: `Formas del examen${TITLE_SUFFIX}`,
      },
      {
        path: 'ai/generate',
        loadComponent: () =>
          import('./features/ai/ai-generate/ai-generate.component').then(
            (m) => m.AiGenerateComponent,
          ),
        title: `Generar con IA${TITLE_SUFFIX}`,
      },
      {
        path: 'ai/jobs',
        loadComponent: () =>
          import('./features/ai/generation-history/generation-history.component').then(
            (m) => m.GenerationHistoryComponent,
          ),
        title: `Historial de generación${TITLE_SUFFIX}`,
      },
      {
        path: 'ai/jobs/:id',
        loadComponent: () =>
          import('./features/ai/generation-job-detail/generation-job-detail.component').then(
            (m) => m.GenerationJobDetailComponent,
          ),
        title: `Detalle de generación${TITLE_SUFFIX}`,
      },
      {
        path: 'ai/review',
        loadComponent: () =>
          import('./features/ai/ai-review-queue/ai-review-queue.component').then(
            (m) => m.AiReviewQueueComponent,
          ),
        title: `Revisión de borradores${TITLE_SUFFIX}`,
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./features/tenant-settings/tenant-settings.component').then(
            (m) => m.TenantSettingsComponent,
          ),
        canActivate: [roleGuard(Role.SchoolAdmin)],
        title: `Configuración${TITLE_SUFFIX}`,
      },
      {
        path: 'admin/tenants',
        loadComponent: () =>
          import('./features/admin-tenants/admin-tenants.component').then(
            (m) => m.AdminTenantsComponent,
          ),
        canActivate: [roleGuard(Role.PlatformAdmin)],
        title: `Colegios${TITLE_SUFFIX}`,
      },
    ],
  },
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  { path: '**', component: NotFoundComponent, title: `Página no encontrada${TITLE_SUFFIX}` },
];
