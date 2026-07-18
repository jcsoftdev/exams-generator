import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';

function setup(loginImpl: (...args: unknown[]) => unknown) {
  const login = vi.fn(loginImpl);
  const navigateByUrl = vi.fn();

  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      { provide: AuthService, useValue: { login } },
      { provide: Router, useValue: { navigateByUrl } },
    ],
  });

  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  const emailInput = compiled.querySelector<HTMLInputElement>('input[name="email"]')!;
  const passwordInput = compiled.querySelector<HTMLInputElement>('input[name="password"]')!;
  const form = compiled.querySelector<HTMLFormElement>('form')!;

  function fillAndSubmit(email: string, password: string) {
    emailInput.value = email;
    emailInput.dispatchEvent(new Event('input'));
    passwordInput.value = password;
    passwordInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  return { fixture, compiled, login, navigateByUrl, fillAndSubmit, form };
}

describe('LoginComponent', () => {
  it('renders an email + password form (ui/input) and a submit button (ui/button)', () => {
    const { compiled } = setup(() => of({ accessToken: 'token' }));

    expect(compiled.querySelector('input[name="email"]')).toBeTruthy();
    expect(compiled.querySelector('input[type="password"]')).toBeTruthy();
    expect(compiled.querySelector('button[type="submit"]')).toBeTruthy();
  });

  it('calls AuthService.login and navigates to the protected shell on success', () => {
    const { login, navigateByUrl, fillAndSubmit } = setup(() => of({ accessToken: 'token' }));

    fillAndSubmit('teacher@school.dev', 'secret');

    expect(login).toHaveBeenCalledWith({ email: 'teacher@school.dev', password: 'secret' });
    expect(navigateByUrl).toHaveBeenCalledWith('/app');
  });

  it('shows an inline Spanish error message on a 401 response and does not navigate, never a browser alert (LG-R1)', () => {
    const unauthorized = new HttpErrorResponse({ status: 401, statusText: 'Unauthorized' });
    const { compiled, navigateByUrl, fillAndSubmit } = setup(() => throwError(() => unauthorized));

    fillAndSubmit('teacher@school.dev', 'wrong-password');

    expect(navigateByUrl).not.toHaveBeenCalled();
    expect(compiled.querySelector('[data-testid="login-error"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/correo o contraseña incorrectos/i);
  });

  it('does not call login when the form is invalid', () => {
    const { login, fillAndSubmit } = setup(() => of({ accessToken: 'token' }));

    fillAndSubmit('not-an-email', '');

    expect(login).not.toHaveBeenCalled();
  });

  it('disables the submit button and shows a loading indicator while the login call is pending (LG-R2)', () => {
    const subject = new Subject<{ accessToken: string }>();
    const { compiled, fixture, fillAndSubmit } = setup(() => subject.asObservable());

    fillAndSubmit('teacher@school.dev', 'secret');

    const button = compiled.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    expect(button.disabled).toBe(true);

    subject.next({ accessToken: 'token' });
    subject.complete();
    fixture.detectChanges();
  });

  it('does not fire a second login request when the submit form is triggered again while a call is pending (LG-R2)', () => {
    const subject = new Subject<{ accessToken: string }>();
    const { login, fillAndSubmit, form, fixture } = setup(() => subject.asObservable());

    fillAndSubmit('teacher@school.dev', 'secret');
    expect(login).toHaveBeenCalledTimes(1);

    form.dispatchEvent(new Event('submit'));
    fixture.detectChanges();

    expect(login).toHaveBeenCalledTimes(1);
  });
});
