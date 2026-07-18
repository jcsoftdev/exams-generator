import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { Role } from '@exams-generator/shared';
import { LucideAngularModule } from 'lucide-angular';
import { SidebarComponent } from '../../ui/sidebar/sidebar.component';
import { TopbarComponent } from '../../ui/topbar/topbar.component';
import { NavGroup } from '../../ui/ui.types';
import { AuthService } from '../../core/auth/auth.service';
import { TenantSettingsService } from '../tenant-settings/tenant-settings.service';

const PRINCIPAL_GROUP: NavGroup = {
  title: 'Principal',
  items: [
    { label: 'Banco de preguntas', route: '/app/bank' },
    { label: 'Exámenes', route: '/app/exams' },
  ],
};

const INTELIGENCIA_GROUP: NavGroup = {
  title: 'Inteligencia',
  items: [
    { label: 'Generar con IA', route: '/app/ai/generate' },
    { label: 'Cola de revisión', route: '/app/ai/review' },
  ],
};

const COLEGIO_GROUP: NavGroup = {
  title: 'Colegio',
  items: [{ label: 'Configuración', route: '/app/settings' }],
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
 */
@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, SidebarComponent, TopbarComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
})
export class ShellComponent {
  private readonly authService = inject(AuthService);
  private readonly tenantSettings = inject(TenantSettingsService);
  private readonly router = inject(Router);

  protected readonly mobileOpen = signal(false);
  protected readonly userMenuOpen = signal(false);
  protected readonly schoolName = signal('Exams Generator');

  protected readonly navGroups = computed<NavGroup[]>(() => {
    const groups: NavGroup[] = [PRINCIPAL_GROUP, INTELIGENCIA_GROUP];
    if (this.authService.currentRole() === Role.SchoolAdmin) {
      groups.push(COLEGIO_GROUP);
    }
    return groups;
  });

  constructor() {
    this.tenantSettings.getSettings().subscribe({
      next: (s) => this.schoolName.set(s.name),
      error: () => {},
    });
  }

  protected toggleMobileMenu(): void {
    this.mobileOpen.update((open) => !open);
  }

  protected closeMobileMenu(): void {
    this.mobileOpen.set(false);
  }

  protected toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  protected logout(): void {
    this.userMenuOpen.set(false);
    this.authService.logout();
    this.router.navigateByUrl('/login');
  }
}
