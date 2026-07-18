import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { EMPTY, of } from 'rxjs';
import { importProvidersFrom, signal } from '@angular/core';
import { provideRouter, Router } from '@angular/router';
import { LucideAngularModule, Menu, User, LogOut } from 'lucide-angular';
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
      importProvidersFrom(LucideAngularModule.pick({ Menu, User, LogOut })),
      { provide: AuthService, useValue: { currentRole: signal(role), logout } },
      { provide: TenantSettingsService, useValue: { getSettings: () => of({ id: 't1', name: 'Colegio San Marcos', logoAssetId: null }) } },
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
  it('shows the school name as the topbar title', () => {
    const { compiled } = setup(Role.Teacher);
    expect(compiled.textContent).toContain('Colegio San Marcos');
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
