import { Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { Router } from '@angular/router';
import { ButtonComponent } from '../../ui/button/button.component';
import { InputComponent } from '../../ui/input/input.component';
import { AuthService } from '../../core/auth/auth.service';

/**
 * Login screen (design doc §4, spec LG-R1/R2). Redesigned with `ui/input` +
 * `ui/button` — plain signal-bound fields (not Reactive Forms, since the
 * `ui/*` primitives two-way bind via `model()`, not `ControlValueAccessor`).
 * `submitting()` both disables the submit button (native form re-submit
 * guard, LG-R2) and drives `ui-button`'s `loading` state; the 401 error
 * renders inline (LG-R1) — never a browser `alert()`.
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

  protected readonly email = signal('');
  protected readonly password = signal('');

  protected readonly errorMessage = signal<string | null>(null);
  protected readonly submitting = signal(false);

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
    this.submitting.set(true);

    this.authService.login({ email: this.email(), password: this.password() }).subscribe({
      next: () => {
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
}
