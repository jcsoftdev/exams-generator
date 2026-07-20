import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { EMPTY, of } from 'rxjs';
import { importProvidersFrom, signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import {
  LucideAngularModule,
  Menu,
  User,
  LogOut,
  X,
  Sparkles,
  Lock,
  Download,
  Ellipsis,
  Check,
  TriangleAlert,
  Search,
  School,
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
  Sun,
  Moon,
} from 'lucide-angular';
import { Role } from '@exams-generator/shared';
import { ShellComponent } from './shell.component';
import { AuthService } from '../../core/auth/auth.service';
import { TenantSettingsService } from '../../features/tenant-settings/tenant-settings.service';
import { DraftCountService } from '../ai/draft-count.service';
import { ThemeService } from '../../core/theme/theme.service';

function setup(role: Role | null, draftCount: number | null = 7) {
  const logout = vi.fn();
  const navigateByUrl = vi.fn();
  const toggleTheme = vi.fn();
  TestBed.configureTestingModule({
    imports: [ShellComponent],
    providers: [
      provideRouter([]),
      { provide: DraftCountService, useValue: { count: signal(draftCount) } },
      { provide: ThemeService, useValue: { mode: signal<'light' | 'dark'>('light'), toggle: toggleTheme } },
      importProvidersFrom(
        LucideAngularModule.pick({
          Menu,
          User,
          LogOut,
          X,
          Sparkles,
          Lock,
          Download,
          Ellipsis,
          Check,
          TriangleAlert,
          Search,
          School,
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
          Sun,
          Moon,
        }),
      ),
      { provide: AuthService, useValue: { currentRole: signal(role), logout } },
      {
        provide: TenantSettingsService,
        useValue: {
          getSettings: () => of({ id: 't1', name: 'San Marcos School', logoAssetId: null }),
        },
      },
      {
        provide: Router,
        useValue: {
          navigateByUrl,
          createUrlTree: () => ({}),
          serializeUrl: () => '',
          // RouterLink/RouterLinkActive (used by ui-sidebar) inject the
          // real Router: RouterLink's default ActivatedRoute provider
          // reads `router.routerState.root`, and RouterLinkActive
          // subscribes to `router.events` — the mock needs both shapes
          // or DI throws before the component renders.
          routerState: { root: {} },
          events: EMPTY,
        },
      },
    ],
  });
  const fixture = TestBed.createComponent(ShellComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, logout, navigateByUrl, toggleTheme };
}

describe('ShellComponent', () => {
  it('composes ui-sidebar, ui-topbar and a router-outlet', () => {
    const { compiled } = setup(Role.Teacher);

    expect(compiled.querySelector('ui-sidebar')).toBeTruthy();
    expect(compiled.querySelector('ui-topbar')).toBeTruthy();
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('renders a decorative notifications button matching the Figma reference (no wired output)', () => {
    const { compiled } = setup(Role.Teacher);

    const button = compiled.querySelector<HTMLButtonElement>('[data-testid="notifications-button"]');
    expect(button).toBeTruthy();
    expect(button?.getAttribute('aria-label')).toBe('Notificaciones');
  });

  it('renders the three nav groups: Principal, Inteligencia and Colegio (for school_admin)', () => {
    const { compiled } = setup(Role.SchoolAdmin);

    expect(compiled.textContent).toContain('Principal');
    expect(compiled.textContent).toContain('Inteligencia');
    expect(compiled.textContent).toContain('Colegio');
    expect(compiled.textContent).toContain('Configuración');
  });

  it('hides the Colegio group for a teacher role', () => {
    const { compiled } = setup(Role.Teacher);

    expect(compiled.textContent).not.toContain('Colegio');
    expect(compiled.textContent).not.toContain('Configuración');
  });

  it('labels the exams nav item "Mis exámenes"', () => {
    const { compiled } = setup(Role.Teacher);

    expect(compiled.textContent).toContain('Mis exámenes');
  });

  it('keeps the desktop sidebar structurally collapsed at mobile widths (hidden md:block)', () => {
    const { compiled } = setup(Role.Teacher);

    const desktopSidebar = compiled.querySelector('[data-testid="shell-sidebar-desktop"]')!;
    expect(desktopSidebar.className).toContain('hidden');
    expect(desktopSidebar.className).toContain('md:block');
  });

  it('opens a mobile drawer when the topbar menu button is toggled, closed by default', () => {
    const { fixture, compiled } = setup(Role.Teacher);

    expect(compiled.querySelector('[data-testid="shell-mobile-drawer"]')).toBeFalsy();

    compiled.querySelector<HTMLButtonElement>('[data-testid="topbar-menu-button"]')!.click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="shell-mobile-drawer"]')).toBeTruthy();
  });

  it('shows the school name as the topbar title', () => {
    const { compiled } = setup(Role.Teacher);
    expect(compiled.textContent).toContain('San Marcos School');
  });

  it('logs out and redirects to /login from the user menu', () => {
    const { compiled, fixture, logout, navigateByUrl } = setup(Role.Teacher);
    (compiled.querySelector('[data-testid="user-menu-button"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="logout-button"]') as HTMLButtonElement).click();
    expect(logout).toHaveBeenCalledTimes(1);
    expect(navigateByUrl).toHaveBeenCalledWith('/login');
  });

  it('shows the pending-drafts count as a badge on "Cola de revisión"', () => {
    const { compiled } = setup(Role.Teacher, 7);

    const links = Array.from(compiled.querySelectorAll('a[data-testid="nav-item"]'));
    const reviewLink = links.find((l) => l.textContent?.includes('Cola de revisión'));
    expect(reviewLink?.querySelector('[data-testid="nav-item-badge"]')?.textContent?.trim()).toBe('7');
  });

  it('omits the badge while the pending-drafts count has not loaded yet', () => {
    const { compiled } = setup(Role.Teacher, null);

    const links = Array.from(compiled.querySelectorAll('a[data-testid="nav-item"]'));
    const reviewLink = links.find((l) => l.textContent?.includes('Cola de revisión'));
    expect(reviewLink?.querySelector('[data-testid="nav-item-badge"]')).toBeFalsy();
  });

  it('lists "Dashboard" as the first item of the Principal group', () => {
    const { compiled } = setup(Role.Teacher);

    // NOTE: this file's Router mock stubs `serializeUrl: () => ''`, so
    // `RouterLink`'s computed `href` is always empty here — assert on the
    // rendered label/order instead (same style as this file's other tests),
    // not on `getAttribute('href')`.
    const links = Array.from(compiled.querySelectorAll('a[data-testid="nav-item"]'));
    expect(links[0]?.textContent).toContain('Dashboard');
  });

  it('renders a theme toggle button that calls ThemeService.toggle() on click', () => {
    const { compiled, toggleTheme } = setup(Role.Teacher);

    const button = compiled.querySelector<HTMLButtonElement>('[data-testid="theme-toggle-button"]');
    expect(button).toBeTruthy();

    button!.click();
    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });
});
