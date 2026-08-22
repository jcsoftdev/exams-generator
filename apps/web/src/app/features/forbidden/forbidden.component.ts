import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LucideAngularModule, ShieldAlert } from 'lucide-angular';
import { ButtonComponent } from '../../ui/button/button.component';

/**
 * 403 screen — the only auth-gate error page (route guards redirect here on
 * a role mismatch). Uses the same design-system tokens/primitives as every
 * other screen instead of unstyled default HTML (audit P0).
 */
@Component({
  selector: 'app-forbidden',
  standalone: true,
  imports: [ButtonComponent, LucideAngularModule],
  providers: [LucideAngularModule.pick({ ShieldAlert }).providers ?? []],
  template: `
    <main
      class="flex min-h-screen flex-col items-center justify-center gap-4 bg-n50 px-6 text-center"
    >
      <lucide-icon name="shield-alert" class="h-12 w-12 text-hard-text"></lucide-icon>
      <h1 class="text-2xl font-semibold text-n900">No tienes acceso a esta página</h1>
      <p class="max-w-sm text-sm text-n600">
        Tu cuenta no tiene permisos para ver este contenido. Si crees que es un error, contacta al
        administrador de tu colegio.
      </p>
      <ui-button variant="primary" (clicked)="goBack()">Volver al inicio</ui-button>
    </main>
  `,
})
export class ForbiddenComponent {
  private readonly router = inject(Router);

  protected goBack(): void {
    this.router.navigateByUrl('/app/dashboard');
  }
}
