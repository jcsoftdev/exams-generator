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
} from 'lucide-angular';
import { Role } from '@exams-generator/shared';
import { ShellComponent } from './shell.component';
import { AuthService } from '../../core/auth/auth.service';
import { TenantSettingsService } from '../../features/tenant-settings/tenant-settings.service';

function setup(role: Role | null) {
  const logout = vi.fn();
  const navigateByUrl = vi.fn();
  TestBed.configureTestingModule({
    imports: [ShellComponent],
    providers: [
      provideRouter([]),
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
  return { fixture, compiled: fixture.nativeElement as HTMLElement, logout, navigateByUrl };
}

describe('ShellComponent', () => {
  it('composes ui-sidebar, ui-topbar and a router-outlet', () => {
    const { compiled } = setup(Role.Teacher);

    expect(compiled.querySelector('ui-sidebar')).toBeTruthy();
    expect(compiled.querySelector('ui-topbar')).toBeTruthy();
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
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
});
