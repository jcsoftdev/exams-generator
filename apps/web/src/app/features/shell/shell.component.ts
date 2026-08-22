import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { MeResponseDto, Role } from '@exams-generator/shared';
import { LucideAngularModule } from 'lucide-angular';
import { SidebarComponent } from '../../ui/sidebar/sidebar.component';
import { TopbarComponent } from '../../ui/topbar/topbar.component';
import { TagComponent } from '../../ui/tag/tag.component';
import { NavGroup } from '../../ui/ui.types';
import { AuthService } from '../../core/auth/auth.service';
import { roleLabel } from '../../core/auth/role-label.util';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';
import { DraftCountService } from '../ai/draft-count.service';
import { ThemeService } from '../../core/theme/theme.service';
import { EXAMS_ROLES } from '../exams/exams.roles';

const PRINCIPAL_GROUP: NavGroup = {
  title: 'Principal',
  items: [
    { label: 'Panel', route: '/app/dashboard', icon: 'layout-dashboard' },
    { label: 'Banco de preguntas', route: '/app/bank', icon: 'book-open' },
    { label: 'Exámenes', route: '/app/exams', icon: 'file-text' },
  ],
};

const COLEGIO_GROUP: NavGroup = {
  title: 'Colegio',
  items: [{ label: 'Configuración', route: '/app/settings', icon: 'settings' }],
};

const ADMIN_GROUP: NavGroup = {
  title: 'Administración',
  items: [{ label: 'Colegios', route: '/app/admin/tenants', icon: 'school' }],
};

/**
 * App frame (design doc §4): dark sidebar + topbar + `<router-outlet>`.
 * Nav groups (Principal/Inteligencia/Colegio) are built here from
 * `AuthService.currentRole()` — the sidebar primitive receives them as
 * pure data. "Colegio" (school settings) is only visible to
 * `school_admin`. At mobile widths the desktop sidebar hides
 * (`hidden md:block`) and a drawer opens via the topbar's `menuToggle`.
 * The topbar title is the tenant's school name (`TenantSettingsService`)
 * and its `[actions]` slot hosts the user menu (logout via `AuthService`).
 * "Cola de revisión" carries a pending-drafts count badge (design doc §4
 * pantalla 4 / shell fix #6), read from `DraftCountService.count()` — a
 * `providedIn: 'root'` singleton that fetches once on app start and is kept
 * fresh afterwards by the review queue itself (no per-render request here).
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent, TagComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
})
export class ShellComponent {
  private static readonly FOCUSABLE_SELECTOR =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

  private readonly authService = inject(AuthService);
  private readonly tenantSettings = inject(TenantSettingsService);
  private readonly router = inject(Router);
  private readonly draftCount = inject(DraftCountService);
  private readonly themeService = inject(ThemeService);

  protected readonly mobileOpen = signal(false);
  private readonly drawerPanel = viewChild<ElementRef<HTMLElement>>('drawerPanel');
  private readonly appColumn = viewChild<ElementRef<HTMLElement>>('appColumn');
  /**
   * Element focused right before the drawer opened; restored on close.
   * Mirrors `ui-modal`'s own focus trap (same reasoning, same shape) — see
   * that component's doc comment. Unlike the modal, the shell DOES own a
   * well-defined "rest of the page" (the app column next to the drawer),
   * so it also gets `inert` while the drawer is open (P0 — 2026-08-18
   * audit: Tab was reaching `theme-toggle-button` behind the backdrop).
   *
   * `inert` is toggled imperatively here — NOT via an `[attr.inert]`
   * template binding — deliberately. A real browser refuses `.focus()` on
   * an element that is still (or newly) inert; jsdom does not enforce
   * that, which is why a template-binding version of this passed every
   * unit test yet silently failed to restore focus in real Chrome — the
   * `inert` attribute was cleared by Angular's own CD in the same tick
   * but there is no ordering guarantee that it lands before this effect's
   * `.focus()` call. Doing both from one place removes the race.
   */
  private drawerTrigger: HTMLElement | null = null;
  private drawerWasOpen = false;
  protected readonly userMenuOpen = signal(false);
  protected readonly schoolName = signal('GeneraExamen');
  protected readonly themeMode = computed(() => this.themeService.mode());
  /** `null` until `GET /auth/me` resolves, or forever if it fails — the menu just falls back to no identity block (see constructor). */
  protected readonly currentUser = signal<MeResponseDto | null>(null);
  protected readonly currentUserRoleLabel = computed(() =>
    roleLabel(this.currentUser()?.role ?? null),
  );

  protected readonly navGroups = computed<NavGroup[]>(() => {
    const role = this.authService.currentRole();
    const pendingDrafts = this.draftCount.count();
    const principalGroup: NavGroup = {
      ...PRINCIPAL_GROUP,
      items: PRINCIPAL_GROUP.items.filter(
        (item) => item.route !== '/app/exams' || (role !== null && EXAMS_ROLES.includes(role)),
      ),
    };
    const inteligenciaGroup: NavGroup = {
      title: 'Inteligencia',
      items: [
        { label: 'Generar con IA', route: '/app/ai/generate', icon: 'sparkles' },
        {
          label: 'Cola de revisión',
          route: '/app/ai/review',
          icon: 'inbox',
          ...(pendingDrafts !== null ? { badge: pendingDrafts } : {}),
        },
        { label: 'Historial IA', route: '/app/ai/jobs', icon: 'history' },
      ],
    };
    const groups: NavGroup[] = [principalGroup, inteligenciaGroup];
    if (role === Role.SchoolAdmin) {
      groups.push(COLEGIO_GROUP);
    }
    if (role === Role.PlatformAdmin) {
      groups.push(ADMIN_GROUP);
    }
    return groups;
  });

  constructor() {
    // `TenantSettingsService.getSettings()` requires a tenantId and THROWS
    // synchronously otherwise (`requireTenantId()`) — platform staff
    // (`platform_admin`/`content_editor`) have `tenantId: null` on their
    // token, so calling it unconditionally crashed the shell for them
    // before it ever rendered (audit P1 — "platform_admin sin UI").
    if (this.authService.currentTenantId()) {
      this.tenantSettings.getSettings().subscribe({
        next: (s) => this.schoolName.set(s.name),
        error: () => {},
      });
    } else {
      this.schoolName.set('GeneraExamen');
    }

    // Unlike `tenantSettings.getSettings()` above, `AuthService.me()` works
    // for EVERY role (including tenant-less platform staff) — no precondition
    // guard needed. Still swallows the error the same way: the identity
    // block in the menu just doesn't render, "Cerrar sesión" always does.
    this.authService.me().subscribe({
      next: (user) => this.currentUser.set(user),
      error: () => {},
    });

    effect(() => {
      const isOpen = this.mobileOpen();
      const appColumnEl = this.appColumn()?.nativeElement;
      if (isOpen && !this.drawerWasOpen) {
        this.drawerTrigger =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        appColumnEl?.setAttribute('inert', '');
        queueMicrotask(() => this.drawerPanel()?.nativeElement.focus());
      } else if (!isOpen && this.drawerWasOpen) {
        // Clear `inert` BEFORE focusing — see the field doc above.
        appColumnEl?.removeAttribute('inert');
        this.drawerTrigger?.focus();
        this.drawerTrigger = null;
      }
      this.drawerWasOpen = isOpen;
    });
  }

  protected toggleMobileMenu(): void {
    this.mobileOpen.update((open) => !open);
  }

  protected closeMobileMenu(): void {
    this.mobileOpen.set(false);
  }

  /** Keeps Tab/Shift+Tab cycling through the drawer's own focusable elements instead of leaking into the app column behind it. */
  protected onDrawerTab(event: Event, backward: boolean): void {
    const panelEl = this.drawerPanel()?.nativeElement;
    if (!panelEl) {
      return;
    }

    const focusable = Array.from(
      panelEl.querySelectorAll<HTMLElement>(ShellComponent.FOCUSABLE_SELECTOR),
    );
    if (focusable.length === 0) {
      event.preventDefault();
      panelEl.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (backward && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!backward && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  protected toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  protected toggleTheme(): void {
    this.themeService.toggle();
  }

  protected logout(): void {
    this.userMenuOpen.set(false);
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }
}
