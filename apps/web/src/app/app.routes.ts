import { Routes } from '@angular/router';
import { Role } from '@exams-generator/shared';
import { authGuard } from './core/auth/auth.guard';
import { roleGuard } from './core/auth/role.guard';
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
      { path: 'exams', component: ExamListComponent },
      { path: 'exams/new', component: ExamBuilderComponent },
      { path: 'exams/:examId', component: ExamReviewComponent },
      { path: 'exams/:examId/versions', component: ExamVersionsPanelComponent },
      { path: 'ai/generate', component: AiGenerateComponent },
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
