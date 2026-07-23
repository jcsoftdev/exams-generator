import { Routes } from '@angular/router';
import { Role } from '@exams-generator/shared';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';
import { EXAMS_ROLES } from './features/exams/exams.roles';
import { LoginComponent } from './features/login/login.component';
import { ShellComponent } from './features/shell/shell.component';
import { ForbiddenComponent } from './features/forbidden/forbidden.component';
import { DashboardComponent } from './features/dashboard/dashboard.component';
import { BankListComponent } from './features/bank/bank-list/bank-list.component';
import { BankUploadComponent } from './features/bank/bank-upload/bank-upload.component';
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

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'forbidden', component: ForbiddenComponent },
  {
    path: 'app',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      { path: 'dashboard', component: DashboardComponent },
      { path: 'bank', component: BankListComponent },
      { path: 'bank/upload', component: BankUploadComponent },
      { path: 'bank/new', component: BankNewComponent },
      // The backend exams controller is @Roles(Teacher, SchoolAdmin) — any
      // other role would only hit 403s, so the routes themselves refuse
      // navigation (to /forbidden) and the shell hides the nav item.
      {
        path: 'exams',
        component: ExamListComponent,
        canActivate: [roleGuard(...EXAMS_ROLES)],
      },
      {
        path: 'exams/new',
        component: ExamBuilderComponent,
        canActivate: [roleGuard(...EXAMS_ROLES)],
      },
      {
        path: 'exams/:examId',
        component: ExamReviewComponent,
        canActivate: [roleGuard(...EXAMS_ROLES)],
      },
      {
        path: 'exams/:examId/versions',
        component: ExamVersionsPanelComponent,
        canActivate: [roleGuard(...EXAMS_ROLES)],
      },
      { path: 'ai/generate', component: AiGenerateComponent },
      { path: 'ai/jobs', component: GenerationHistoryComponent },
      { path: 'ai/jobs/:id', component: GenerationJobDetailComponent },
      { path: 'ai/review', component: AiReviewQueueComponent },
      {
        path: 'settings',
        component: TenantSettingsComponent,
        canActivate: [roleGuard(Role.SchoolAdmin)],
      },
    ],
  },
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  { path: '**', redirectTo: 'login' },
];
