import { TestBed } from '@angular/core/testing';
import { importProvidersFrom } from '@angular/core';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { describe, it, expect } from 'vitest';
import { Role } from '@exams-generator/shared';
import { LucideAngularModule, Menu, X, Sparkles, Lock, Download, Ellipsis, Check, TriangleAlert, Search, School, LogOut, User, Users, Trash2, Pencil, Archive, ChevronLeft, ChevronRight, ChevronDown, Plus, Minus } from 'lucide-angular';
import { ShellComponent } from './shell.component';
import { AuthService } from '../../core/auth/auth.service';

function setup(role: Role) {
  TestBed.configureTestingModule({
    imports: [ShellComponent],
    providers: [
      provideRouter([]),
      { provide: AuthService, useValue: { currentRole: signal(role) } },
      importProvidersFrom(
        LucideAngularModule.pick({
          Menu, X, Sparkles, Lock, Download, Ellipsis, Check, TriangleAlert, Search, School,
          LogOut, User, Users, Trash2, Pencil, Archive, ChevronLeft, ChevronRight, ChevronDown, Plus, Minus,
        }),
      ),
    ],
  });

  const fixture = TestBed.createComponent(ShellComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled };
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
});
