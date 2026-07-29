import { Routes } from '@angular/router';
import { Role } from '@exams-generator/shared';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';
import { EXAMS_ROLES } from './features/exams/exams.roles';
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

const TITLE_SUFFIX = ' · GeneraExamen';

export const routes: Routes = [
  { path: 'login', component: LoginComponent, title: `Iniciar sesión${TITLE_SUFFIX}` },
  { path: 'auth/callback', component: AuthCallbackComponent, title: `Iniciando sesión${TITLE_SUFFIX}` },
  { path: 'forbidden', component: ForbiddenComponent, title: `Sin acceso${TITLE_SUFFIX}` },
  {
    path: 'app',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: DashboardComponent, title: `Panel${TITLE_SUFFIX}` },
      { path: 'bank', component: BankListComponent, title: `Banco de preguntas${TITLE_SUFFIX}` },
      { path: 'bank/new', component: BankNewComponent, title: `Nueva pregunta${TITLE_SUFFIX}` },
      // The backend exams controller is @Roles(Teacher, SchoolAdmin) — any
      // other role would only hit 403s, so the routes themselves refuse
      // navigation (to /forbidden) and the shell hides the nav item.
      {
        path: 'exams',
        component: ExamListComponent,
        canActivate: [roleGuard(...EXAMS_ROLES)],
        title: `Exámenes${TITLE_SUFFIX}`,
      },
      {
        path: 'exams/new',
        component: ExamBuilderComponent,
        canActivate: [roleGuard(...EXAMS_ROLES)],
        title: `Nuevo examen${TITLE_SUFFIX}`,
      },
      {
        path: 'exams/:examId',
        component: ExamReviewComponent,
        canActivate: [roleGuard(...EXAMS_ROLES)],
        title: `Revisar examen${TITLE_SUFFIX}`,
      },
      {
        path: 'exams/:examId/versions',
        component: ExamVersionsPanelComponent,
        canActivate: [roleGuard(...EXAMS_ROLES)],
        title: `Formas del examen${TITLE_SUFFIX}`,
      },
      { path: 'ai/generate', component: AiGenerateComponent, title: `Generar con IA${TITLE_SUFFIX}` },
      { path: 'ai/jobs', component: GenerationHistoryComponent, title: `Historial de generación${TITLE_SUFFIX}` },
      { path: 'ai/jobs/:id', component: GenerationJobDetailComponent, title: `Detalle de generación${TITLE_SUFFIX}` },
      { path: 'ai/review', component: AiReviewQueueComponent, title: `Revisión de borradores${TITLE_SUFFIX}` },
      {
        path: 'settings',
        component: TenantSettingsComponent,
        canActivate: [roleGuard(Role.SchoolAdmin)],
        title: `Configuración${TITLE_SUFFIX}`,
      },
      {
        path: 'admin/tenants',
        component: AdminTenantsComponent,
        canActivate: [roleGuard(Role.PlatformAdmin)],
        title: `Colegios${TITLE_SUFFIX}`,
      },
    ],
  },
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  { path: '**', component: NotFoundComponent, title: `Página no encontrada${TITLE_SUFFIX}` },
];
