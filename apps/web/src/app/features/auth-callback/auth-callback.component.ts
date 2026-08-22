import { Component, OnInit, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { LucideAngularModule, TriangleAlert } from 'lucide-angular';
import { ButtonComponent } from '../../ui/button/button.component';
import { AuthService } from '../../core/auth/auth.service';

/** `#code=abc123` -> `'abc123'`. Missing/empty fragment -> `null`. */
function extractExchangeCode(hash: string): string | null {
  const match = /(?:^#|&)code=([^&]+)/.exec(hash);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Cross-origin login handoff, landing spot: reached via a redirect from
 * either the central login page (creaexamen.com/login) or this same SPA's
 * own `/login` when the account's tenant doesn't match the current
 * subdomain (see `login.component.ts`'s `redirectToTenant`). The URL
 * fragment carries a one-time code, never the real JWT — fragments are
 * never sent to a server, so neither this app's nginx nor the API ever log
 * it. Redeems the code for the real accessToken and stores it exactly like
 * a normal login (`AuthService.applyToken`), then continues into the app.
 */
@Component({
  selector: 'app-auth-callback',
  standalone: true,
  imports: [ButtonComponent, LucideAngularModule],
  providers: [LucideAngularModule.pick({ TriangleAlert }).providers ?? []],
  template: `
    @if (errorMessage()) {
      <main
        class="flex min-h-screen flex-col items-center justify-center gap-4 bg-n50 px-6 text-center"
      >
        <lucide-icon name="triangle-alert" class="h-12 w-12 text-hard-text"></lucide-icon>
        <h1 class="text-2xl font-semibold text-n900">No se pudo iniciar sesión</h1>
        <p data-testid="auth-callback-error" class="max-w-sm text-sm text-n600">
          {{ errorMessage() }}
        </p>
        <ui-button variant="primary" (clicked)="goToLogin()">Volver a intentar</ui-button>
      </main>
    } @else {
      <main class="flex min-h-screen items-center justify-center bg-n50">
        <p class="text-sm text-n600">Iniciando sesión…</p>
      </main>
    }
  `,
})
export class AuthCallbackComponent implements OnInit {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly errorMessage = signal<string | null>(null);

  ngOnInit(): void {
    const code = extractExchangeCode(window.location.hash);
    if (!code) {
      this.errorMessage.set('Enlace inválido. Vuelve a iniciar sesión.');
      return;
    }

    this.authService.exchangeCode(code).subscribe({
      next: ({ accessToken }) => {
        this.authService.applyToken(accessToken);
        this.router.navigateByUrl('/app');
      },
      error: () => {
        this.errorMessage.set('El enlace expiró o ya fue usado. Vuelve a iniciar sesión.');
      },
    });
  }

  protected goToLogin(): void {
    this.router.navigateByUrl('/login');
  }
}
