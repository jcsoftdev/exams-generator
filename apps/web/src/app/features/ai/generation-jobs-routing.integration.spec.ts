import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { importProvidersFrom, signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { By } from '@angular/platform-browser';
import {
  LucideAngularModule,
  Menu,
  X,
  Sparkles,
  Lock,
  Download,
  Ellipsis,
  Check,
  TriangleAlert,
  Search,
  School,
  LogOut,
  User,
  Users,
  Trash2,
  Pencil,
  Archive,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Plus,
  Minus,
  Bell,
  LayoutDashboard,
  BookOpen,
  FileText,
  Inbox,
  Settings,
  History,
  Sun,
  Moon,
} from 'lucide-angular';
import { routes } from '../../app.routes';
import { AuthService } from '../../core/auth/auth.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { ThemeService } from '../../core/theme/theme.service';
import { AiService } from './ai.service';
import { DraftCountService } from './draft-count.service';
import { GenerationJob, GenerationJobListResult } from './ai.models';
import { GenerationJobDetailComponent } from './generation-job-detail/generation-job-detail.component';
import { GenerationHistoryComponent } from './generation-history/generation-history.component';

const JOB: GenerationJob = {
  id: 'job-1',
  tenantId: 'tenant-1',
  courseId: 'c1',
  topicId: 't1',
  difficulty: 'easy' as GenerationJob['difficulty'],
  gradeLevel: 'pre',
  count: 3,
  withFigure: false,
  status: 'completed',
  createdCount: 3,
  failedCount: 0,
  createdQuestionIds: [],
  failedItems: [],
  cancelRequested: false,
  retriedFromJobId: null,
  rootJobId: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  completedAt: '2026-01-01T00:05:00.000Z',
};

/**
 * Closes a gap flagged by the whole-plan review: every other AI-generation
 * spec (ai-generate/generation-history/generation-job-detail) mocks `Router`
 * or `ActivatedRoute` directly and never touches the real route config, so a
 * path typo in a `router.navigate([...])` call OR in `app.routes.ts` itself
 * would pass all of them silently. This spec drives the REAL `routes` array
 * (imported straight from `app.routes.ts`, not a hand-written substitute)
 * via `RouterTestingHarness`, proving the two literal URLs
 * `ai-generate.component.ts` / `generation-history.component.ts` navigate to
 * (`/app/ai/jobs/:id` and `/app/ai/jobs`) actually resolve to
 * `GenerationJobDetailComponent` / `GenerationHistoryComponent`.
 *
 * `/app/**` is guarded by `authGuard` and its parent route renders the real
 * `ShellComponent` (sidebar/topbar chrome) — both are exercised for real
 * here too, so this proves the FULL chain (guard → ShellComponent → nested
 * `<router-outlet>` → leaf component), not just the leaf component in
 * isolation. Only the leaf SERVICES are stubbed (`AiService`, plus
 * `ShellComponent`'s own dependencies, same provider shapes as
 * `shell.component.spec.ts`) — the routing itself is 100% real.
 */
function setup() {
  const streamGenerationJob = vi.fn(() => of(JOB));
  // JOB.createdQuestionIds is empty, so GenerationJobDetailComponent's
  // loadNewQuestions() never actually calls getDraft() here — kept on the
  // mock only so the AiService shape stays accurate for anyone extending
  // this fixture with a non-empty createdQuestionIds later.
  const getDraft = vi.fn(() => of(null));
  const listGenerationJobs = vi.fn(() => of<GenerationJobListResult>({ items: [], total: 0 }));
  const getGenerationJobChain = vi.fn(() => of({ items: [JOB] }));

  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      { provide: AiService, useValue: { streamGenerationJob, getDraft, listGenerationJobs, getGenerationJobChain } },
      {
        provide: AuthService,
        useValue: {
          isAuthenticated: () => true,
          currentRole: signal(null),
          currentTenantId: signal('t1'),
          logout: vi.fn(),
          me: vi.fn(() => of({ id: 'u1', name: 'Test User', email: 'test@user.local', role: 'teacher', tenantId: 't1' })),
        },
      },
      {
        provide: TenantSettingsService,
        useValue: { getSettings: () => of({ id: 't1', name: 'Test School', logoAssetId: null }) },
      },
      { provide: DraftCountService, useValue: { count: signal<number | null>(null), set: vi.fn() } },
      { provide: ThemeService, useValue: { mode: signal<'light' | 'dark'>('light'), toggle: vi.fn() } },
      importProvidersFrom(
        LucideAngularModule.pick({
          Menu,
          X,
          Sparkles,
          Lock,
          Download,
          Ellipsis,
          Check,
          TriangleAlert,
          Search,
          School,
          LogOut,
          User,
          Users,
          Trash2,
          Pencil,
          Archive,
          ChevronLeft,
          ChevronRight,
          ChevronDown,
          Plus,
          Minus,
          Bell,
          LayoutDashboard,
          BookOpen,
          FileText,
          Inbox,
          Settings,
          History,
          Sun,
          Moon,
        }),
      ),
    ],
  });

  return { streamGenerationJob, getDraft, listGenerationJobs };
}

describe('AI generation-jobs routing (integration — real app.routes.ts)', () => {
  it('navigating to /app/ai/jobs/:id (AiGenerateComponent\'s + row-click target) resolves through the real route table to GenerationJobDetailComponent and loads that job', async () => {
    const { streamGenerationJob } = setup();

    const harness = await RouterTestingHarness.create('/app/ai/jobs/job-1');

    const detail = harness.fixture.debugElement.query(By.directive(GenerationJobDetailComponent));
    expect(detail).toBeTruthy();
    expect(detail.componentInstance).toBeInstanceOf(GenerationJobDetailComponent);
    expect(streamGenerationJob).toHaveBeenCalledWith('job-1');
  });

  it('navigating to /app/ai/jobs (AiGenerateComponent.goToHistory\'s target) resolves through the real route table to GenerationHistoryComponent and loads the list', async () => {
    const { listGenerationJobs } = setup();

    const harness = await RouterTestingHarness.create('/app/ai/jobs');

    const history = harness.fixture.debugElement.query(By.directive(GenerationHistoryComponent));
    expect(history).toBeTruthy();
    expect(history.componentInstance).toBeInstanceOf(GenerationHistoryComponent);
    expect(listGenerationJobs).toHaveBeenCalled();
  });
});
