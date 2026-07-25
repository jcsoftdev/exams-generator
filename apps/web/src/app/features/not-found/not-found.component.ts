import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { LucideAngularModule, SearchX } from 'lucide-angular';
import { ButtonComponent } from '../../ui/button/button.component';

/**
 * 404 screen for the wildcard route — previously redirected straight to
 * /login, which looked like a session bug instead of a bad URL (audit P1).
 */
@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [ButtonComponent, LucideAngularModule],
  providers: [LucideAngularModule.pick({ SearchX }).providers ?? []],
  template: `
    <main class="flex min-h-screen flex-col items-center justify-center gap-4 bg-n50 px-6 text-center">
      <lucide-icon name="search-x" class="h-12 w-12 text-n500"></lucide-icon>
      <h1 class="text-2xl font-semibold text-n900">Página no encontrada</h1>
      <p class="max-w-sm text-sm text-n600">La página que buscas no existe o cambió de dirección.</p>
      <ui-button variant="primary" (clicked)="goHome()">Volver al inicio</ui-button>
    </main>
  `,
})
export class NotFoundComponent {
  private readonly router = inject(Router);

  protected goHome(): void {
    this.router.navigateByUrl('/app/dashboard');
  }
}
