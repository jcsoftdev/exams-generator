import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '../../ui/button/button.component';
import { InputComponent } from '../../ui/input/input.component';
import { AuthService } from '../../core/auth/auth.service';
import {
  extractTenantSlug,
  isTenantScopedHost,
  TENANT_ROOT_DOMAIN,
} from '../../core/tenant/tenant-lookup.service';

/**
 * Login screen (design doc §4, spec LG-R1/R2). Panel dividido: marca oscura
 * a la izquierda (promesa + mini-preview del examen), form claro a la
 * derecha con `ui/input` + `ui/button` — plain signal-bound fields (not
 * Reactive Forms, since the `ui/*` primitives two-way bind via `model()`,
 * not `ControlValueAccessor`). Lee `?expired=1` del query param para
 * mostrar el aviso de sesión expirada (redirect desde el `authInterceptor`
 * en un 401 fuera del flujo de login). `submitting()` both disables the
 * submit button (native form re-submit guard, LG-R2) and drives
 * `ui-button`'s `loading` state; the 401 error renders inline (LG-R1) —
 * never a browser `alert()`.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ButtonComponent, InputComponent],
  templateUrl: './login.component.html',
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly email = signal('');
  protected readonly password = signal('');

  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitting = signal(false);
  protected readonly sessionExpired = signal(
    this.route.snapshot.queryParamMap.get('expired') === '1',
  );

  constructor() {
    // Skip login for an already-authenticated visitor (valid, unexpired
    // token in localStorage) — e.g. reopening the tab or a bookmark to /login.
    if (this.authService.isAuthenticated()) {
      this.router.navigateByUrl('/app');
      return;
    }

    // The bare root domain (`creaexamen.com`, no subdomain) can't see a
    // tenant subdomain's localStorage — different origin. If this browser
    // has logged into a tenant before (the `lastTenant` cookie, set by
    // AuthService.login()), send it there instead of asking for credentials
    // again; that subdomain's own LoginComponent constructor (this same
    // check, `isAuthenticated()`) then decides if the session is still good.
    const hostname = window.location.hostname;
    if (isTenantScopedHost(hostname) && extractTenantSlug(hostname) === null) {
      this.authService.getLastTenant().subscribe(({ slug }) => {
        if (slug) {
          window.location.href = `https://${slug}${TENANT_ROOT_DOMAIN}/login`;
        }
      });
    }
  }

  private isValid(): boolean {
    return /\S+@\S+\.\S+/.test(this.email()) && this.password().length > 0;
  }

  protected onFormSubmit(event: Event): void {
    event.preventDefault();
    this.onSubmit();
  }

  protected onSubmit(): void {
    if (!this.isValid() || this.submitting()) {
      return;
    }

    this.errorMessage.set(null);
    this.sessionExpired.set(false);
    this.submitting.set(true);

    this.authService.login({ email: this.email(), password: this.password() }).subscribe({
      next: (response) => {
        const hostname = window.location.hostname;
        const currentSlug = extractTenantSlug(hostname);
        // The handoff only makes sense on hosts that PARTICIPATE in the
        // tenant-subdomain scheme. On localhost or the sslip.io fallback there
        // is no other origin to hand off TO — localStorage is already the right
        // one — and redirecting would send the developer (plus a live one-time
        // code) straight to production.
        if (
          isTenantScopedHost(hostname) &&
          response.tenantSlug &&
          response.tenantSlug !== currentSlug
        ) {
          // Wrong subdomain for this account (e.g. an old bookmark, or the
          // tenant was renamed) — localStorage doesn't cross origins, so
          // hand the session off via a one-time code instead of just
          // navigating to /app on a subdomain the token isn't valid for.
          this.redirectToTenant(response.tenantSlug, response.accessToken);
          return;
        }
        this.submitting.set(false);
        this.router.navigateByUrl('/app');
      },
      error: (error: HttpErrorResponse) => {
        this.submitting.set(false);
        this.errorMessage.set(
          error.status === 401
            ? 'Correo o contraseña incorrectos.'
            : 'Ocurrió un error. Inténtalo de nuevo.',
        );
      },
    });
  }

  private redirectToTenant(slug: string, accessToken: string): void {
    this.authService.requestExchangeCode(accessToken).subscribe({
      next: ({ code }) => {
        window.location.href = `https://${slug}${TENANT_ROOT_DOMAIN}/auth/callback#code=${code}`;
      },
      error: () => {
        this.submitting.set(false);
        this.errorMessage.set('Ocurrió un error. Inténtalo de nuevo.');
      },
    });
  }
}
