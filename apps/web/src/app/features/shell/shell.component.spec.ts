import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { EMPTY, of, throwError } from 'rxjs';
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
  History,
  Sun,
  Moon,
} from 'lucide-angular';
import { Role, MeResponseDto } from '@exams-generator/shared';
import { ShellComponent } from './shell.component';
import { AuthService } from '../../core/auth/auth.service';
import { TenantSettingsService } from '../../features/tenant-settings/tenant-settings.service';
import { DraftCountService } from '../ai/draft-count.service';
import { ThemeService } from '../../core/theme/theme.service';

function setup(
  role: Role | null,
  draftCount: number | null = 7,
  tenantId: string | null = 't1',
  meOverride?: Partial<MeResponseDto> | 'error',
) {
  const logout = vi.fn();
  const navigateByUrl = vi.fn();
  const toggleTheme = vi.fn();
  const me = vi.fn(() =>
    meOverride === 'error'
      ? throwError(() => new Error('me failed'))
      : of({
          id: 'u1',
          name: 'Ana Torres',
          email: 'ana@test.local',
          role: role ?? Role.Teacher,
          tenantId,
          ...meOverride,
        } as MeResponseDto),
  );
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
          History,
          Sun,
          Moon,
        }),
      ),
      { provide: AuthService, useValue: { currentRole: signal(role), currentTenantId: signal(tenantId), logout, me } },
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
  return { fixture, compiled: fixture.nativeElement as HTMLElement, logout, navigateByUrl, toggleTheme, me };
}

/** Opens the user menu the same way a real click would, then flushes pending change detection. */
function openUserMenu(fixture: ReturnType<typeof setup>['fixture'], compiled: HTMLElement): void {
  compiled.querySelector<HTMLButtonElement>('[data-testid="user-menu-button"]')!.click();
  fixture.detectChanges();
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

  it('labels the exams nav item "Exámenes"', () => {
    const { compiled } = setup(Role.Teacher);

    expect(compiled.textContent).toContain('Exámenes');
  });

  it('hides "Exámenes" for platform_admin — the backend exams controller 403s the role, so the nav must not lead to a dead 403 screen', () => {
    const { compiled } = setup(Role.PlatformAdmin);

    expect(compiled.textContent).not.toContain('Exámenes');
  });

  it('hides "Exámenes" for content_editor (same backend 403)', () => {
    const { compiled } = setup(Role.ContentEditor);

    expect(compiled.textContent).not.toContain('Exámenes');
  });

  it('shows "Colegios" (admin tenants screen) only for platform_admin', () => {
    const { compiled } = setup(Role.PlatformAdmin);

    expect(compiled.textContent).toContain('Colegios');
  });

  it('hides "Colegios" for content_editor', () => {
    expect(setup(Role.ContentEditor).compiled.textContent).not.toContain('Colegios');
  });

  it('hides "Colegios" for school_admin', () => {
    expect(setup(Role.SchoolAdmin).compiled.textContent).not.toContain('Colegios');
  });

  it('does not crash and skips TenantSettingsService for platform staff with no tenantId', () => {
    let compiled!: HTMLElement;
    expect(() => {
      compiled = setup(Role.PlatformAdmin, 7, null).compiled;
    }).not.toThrow();
    expect(compiled.textContent).toContain('GeneraExamen');
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

  it('shows the signed-in user\'s name, email and role label in the user menu', () => {
    const { fixture, compiled } = setup(Role.Teacher);
    openUserMenu(fixture, compiled);

    expect(compiled.textContent).toContain('Ana Torres');
    expect(compiled.textContent).toContain('ana@test.local');
    expect(compiled.textContent).toContain('Profesor');
  });

  it('labels a platform_admin session "Administrador de plataforma" in the user menu', () => {
    const { fixture, compiled } = setup(Role.PlatformAdmin, 7, null);
    openUserMenu(fixture, compiled);

    expect(compiled.textContent).toContain('Administrador de plataforma');
  });

  it('labels a content_editor session "Editor de contenido" in the user menu', () => {
    const { fixture, compiled } = setup(Role.ContentEditor, 7, null);
    openUserMenu(fixture, compiled);

    expect(compiled.textContent).toContain('Editor de contenido');
  });

  it('does not crash and still shows "Cerrar sesión" when the identity fetch fails', () => {
    let compiled!: HTMLElement;
    let fixture!: ReturnType<typeof setup>['fixture'];
    expect(() => {
      ({ fixture, compiled } = setup(Role.Teacher, 7, 't1', 'error'));
    }).not.toThrow();

    openUserMenu(fixture, compiled);
    expect(compiled.textContent).toContain('Cerrar sesión');
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

  // "Dashboard" era la única etiqueta en inglés de un nav 100% español (audit
  // 2026-08-15); el título de la ruta ya decía "Panel".
  it('lists "Panel" as the first item of the Principal group', () => {
    const { compiled } = setup(Role.Teacher);

    // NOTE: this file's Router mock stubs `serializeUrl: () => ''`, so
    // `RouterLink`'s computed `href` is always empty here — assert on the
    // rendered label/order instead (same style as this file's other tests),
    // not on `getAttribute('href')`.
    const links = Array.from(compiled.querySelectorAll('a[data-testid="nav-item"]'));
    expect(links[0]?.textContent).toContain('Panel');
  });

  it('renders a theme toggle button that calls ThemeService.toggle() on click', () => {
    const { compiled, toggleTheme } = setup(Role.Teacher);

    const button = compiled.querySelector<HTMLButtonElement>('[data-testid="theme-toggle-button"]');
    expect(button).toBeTruthy();

    button!.click();
    expect(toggleTheme).toHaveBeenCalledTimes(1);
  });

  // P0 3 (2026-08-18 mobile audit): the drawer had no dialog semantics, never
  // received focus, didn't trap Tab, and Escape did nothing — a keyboard user
  // could Tab straight past it into `theme-toggle-button` behind the backdrop.
  describe('mobile drawer accessibility (P0 — 2026-08-18 audit)', () => {
    function openDrawer(fixture: ReturnType<typeof setup>['fixture'], compiled: HTMLElement): HTMLElement {
      const menuButton = compiled.querySelector<HTMLElement>('[data-testid="topbar-menu-button"]')!;
      menuButton.focus();
      menuButton.click();
      fixture.detectChanges();
      return menuButton;
    }

    it('gives the drawer panel dialog semantics: role=dialog, aria-modal=true, a real aria-label', () => {
      const { fixture, compiled } = setup(Role.Teacher);
      document.body.appendChild(fixture.nativeElement);
      try {
        openDrawer(fixture, compiled);
        const panel = compiled.querySelector<HTMLElement>('[data-testid="shell-mobile-drawer"] [role="dialog"]');

        expect(panel).toBeTruthy();
        expect(panel!.getAttribute('aria-modal')).toBe('true');
        expect(panel!.getAttribute('aria-label')).toBeTruthy();
      } finally {
        fixture.nativeElement.remove();
      }
    });

    it('moves focus into the drawer panel when it opens', async () => {
      const { fixture, compiled } = setup(Role.Teacher);
      document.body.appendChild(fixture.nativeElement);
      try {
        openDrawer(fixture, compiled);
        const panel = compiled.querySelector<HTMLElement>('[data-testid="shell-mobile-drawer"] [role="dialog"]')!;

        await vi.waitFor(() => expect(document.activeElement).toBe(panel));
      } finally {
        fixture.nativeElement.remove();
      }
    });

    it('closes on Escape and returns focus to the button that opened it', async () => {
      const { fixture, compiled } = setup(Role.Teacher);
      document.body.appendChild(fixture.nativeElement);
      try {
        const menuButton = openDrawer(fixture, compiled);
        const panel = compiled.querySelector<HTMLElement>('[data-testid="shell-mobile-drawer"] [role="dialog"]')!;
        await vi.waitFor(() => expect(document.activeElement).toBe(panel));

        panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        fixture.detectChanges();

        expect(compiled.querySelector('[data-testid="shell-mobile-drawer"]')).toBeFalsy();
        await vi.waitFor(() => expect(document.activeElement).toBe(menuButton));
      } finally {
        fixture.nativeElement.remove();
      }
    });

    it('traps Tab inside the drawer, wrapping from the last focusable element back to the first', async () => {
      const { fixture, compiled } = setup(Role.Teacher);
      document.body.appendChild(fixture.nativeElement);
      try {
        openDrawer(fixture, compiled);
        const panel = compiled.querySelector<HTMLElement>('[data-testid="shell-mobile-drawer"] [role="dialog"]')!;
        await vi.waitFor(() => expect(document.activeElement).toBe(panel));

        const navLinks = Array.from(panel.querySelectorAll<HTMLElement>('a[data-testid="nav-item"]'));
        expect(navLinks.length).toBeGreaterThan(0);
        const first = navLinks[0]!;
        const last = navLinks[navLinks.length - 1]!;

        last.focus();
        const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
        last.dispatchEvent(event);
        fixture.detectChanges();

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(first);
      } finally {
        fixture.nativeElement.remove();
      }
    });

    it('traps Shift+Tab inside the drawer, wrapping from the first focusable element to the last', async () => {
      const { fixture, compiled } = setup(Role.Teacher);
      document.body.appendChild(fixture.nativeElement);
      try {
        openDrawer(fixture, compiled);
        const panel = compiled.querySelector<HTMLElement>('[data-testid="shell-mobile-drawer"] [role="dialog"]')!;
        await vi.waitFor(() => expect(document.activeElement).toBe(panel));

        const navLinks = Array.from(panel.querySelectorAll<HTMLElement>('a[data-testid="nav-item"]'));
        const first = navLinks[0]!;
        const last = navLinks[navLinks.length - 1]!;

        first.focus();
        const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
        first.dispatchEvent(event);
        fixture.detectChanges();

        expect(event.defaultPrevented).toBe(true);
        expect(document.activeElement).toBe(last);
      } finally {
        fixture.nativeElement.remove();
      }
    });

    it('marks the app content behind the drawer inert while open, and not inert once closed', () => {
      const { fixture, compiled } = setup(Role.Teacher);
      document.body.appendChild(fixture.nativeElement);
      try {
        const appColumn = compiled.querySelector<HTMLElement>('main')!.parentElement!;
        expect(appColumn.hasAttribute('inert')).toBe(false);

        openDrawer(fixture, compiled);
        expect(appColumn.hasAttribute('inert')).toBe(true);

        compiled.querySelector<HTMLElement>('[data-testid="shell-mobile-backdrop"]')!.click();
        fixture.detectChanges();
        expect(appColumn.hasAttribute('inert')).toBe(false);
      } finally {
        fixture.nativeElement.remove();
      }
    });
  });
});
