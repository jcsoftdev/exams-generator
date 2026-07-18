import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';
import { LoginComponent } from './features/login/login.component';
import { ShellComponent } from './features/shell/shell.component';
import { ForbiddenComponent } from './features/forbidden/forbidden.component';
import { BankListComponent } from './features/bank/bank-list/bank-list.component';
import { BankUploadComponent } from './features/bank/bank-upload/bank-upload.component';
import { ExamVersionsPanelComponent } from './features/exam-versions/exam-versions-panel/exam-versions-panel.component';

export const routes: Routes = [
  { path: 'login', component: LoginComponent },
  { path: 'forbidden', component: ForbiddenComponent },
  {
    path: 'app',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: 'bank', component: BankListComponent },
      { path: 'bank/upload', component: BankUploadComponent },
      { path: 'exams/:examId/versions', component: ExamVersionsPanelComponent },
    ],
  },
  { path: '', pathMatch: 'full', redirectTo: 'app' },
  { path: '**', redirectTo: 'login' },
];
