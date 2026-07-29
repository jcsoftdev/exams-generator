import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';

const originalLocation = window.location;

function setHostname(hostname: string): void {
  Object.defineProperty(window, 'location', {
    writable: true,
    configurable: true,
    value: { ...originalLocation, hostname, href: '' },
  });
}

function restoreLocation(): void {
  Object.defineProperty(window, 'location', { writable: true, configurable: true, value: originalLocation });
}

function setup(
  opts: {
    expired?: boolean;
    loginImpl?: (...a: unknown[]) => unknown;
    requestExchangeCodeImpl?: (...a: unknown[]) => unknown;
  } = {},
) {
  const login = vi.fn(opts.loginImpl ?? (() => of({ accessToken: 'jwt', tenantSlug: null })));
  const requestExchangeCode = vi.fn(opts.requestExchangeCodeImpl ?? (() => of({ code: 'one-time-code' })));
  const navigateByUrl = vi.fn();
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      { provide: AuthService, useValue: { login, requestExchangeCode } },
      { provide: Router, useValue: { navigateByUrl } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(opts.expired ? { expired: '1' } : {}) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled, login, requestExchangeCode, navigateByUrl };
}

function typeInto(compiled: HTMLElement, testid: string, value: string) {
  const input = compiled.querySelector(`[data-testid="${testid}"] input`) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function submit(compiled: HTMLElement) {
  (compiled.querySelector('[data-testid="login-submit"] button') as HTMLButtonElement).click();
}

describe('LoginComponent', () => {
  it('renders the brand promise on the dark panel', () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="login-brand-panel"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/listos para imprimir/i);
  });

  it('shows the "sesión expiró" notice when ?expired=1', () => {
    const { compiled } = setup({ expired: true });
    expect(compiled.querySelector('[data-testid="login-expired"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/tu sesión expiró/i);
  });

  it('does not show the expired notice by default', () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="login-expired"]')).toBeFalsy();
  });

  it('logs in and navigates to /app on success', () => {
    const { compiled, fixture, login, navigateByUrl } = setup();
    typeInto(compiled, 'login-email', 'profe@colegio.pe');
    typeInto(compiled, 'login-password', 'secret123');
    fixture.detectChanges();
    submit(compiled);
    expect(login).toHaveBeenCalledWith({ email: 'profe@colegio.pe', password: 'secret123' });
    expect(navigateByUrl).toHaveBeenCalledWith('/app');
  });

  it('shows an inline error on 401', () => {
    const { compiled, fixture } = setup({
      loginImpl: () => throwError(() => new HttpErrorResponse({ status: 401 })),
    });
    typeInto(compiled, 'login-email', 'profe@colegio.pe');
    typeInto(compiled, 'login-password', 'bad');
    fixture.detectChanges();
    submit(compiled);
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="login-error"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/incorrectos/i);
  });

  it('does not call login when the form is invalid', () => {
    const { compiled, fixture, login } = setup();
    typeInto(compiled, 'login-email', 'not-an-email');
    typeInto(compiled, 'login-password', '');
    fixture.detectChanges();
    submit(compiled);
    expect(login).not.toHaveBeenCalled();
  });

  it('disables the submit button and shows a loading indicator while the login call is pending', () => {
    const subject = new Subject<{ accessToken: string; tenantSlug: string | null }>();
    const { compiled, fixture } = setup({ loginImpl: () => subject.asObservable() });
    typeInto(compiled, 'login-email', 'profe@colegio.pe');
    typeInto(compiled, 'login-password', 'secret123');
    fixture.detectChanges();
    submit(compiled);
    fixture.detectChanges();

    const button = compiled.querySelector<HTMLButtonElement>('[data-testid="login-submit"] button')!;
    expect(button.disabled).toBe(true);

    subject.next({ accessToken: 'jwt', tenantSlug: null });
    subject.complete();
    fixture.detectChanges();
  });

  it('does not fire a second login request when submit is triggered again while a call is pending', () => {
    const subject = new Subject<{ accessToken: string; tenantSlug: string | null }>();
    const { compiled, fixture, login } = setup({ loginImpl: () => subject.asObservable() });
    typeInto(compiled, 'login-email', 'profe@colegio.pe');
    typeInto(compiled, 'login-password', 'secret123');
    fixture.detectChanges();
    submit(compiled);
    fixture.detectChanges();
    expect(login).toHaveBeenCalledTimes(1);

    submit(compiled);
    fixture.detectChanges();

    expect(login).toHaveBeenCalledTimes(1);
  });

  describe('cross-domain redirect', () => {
    afterEach(() => restoreLocation());

    it('requests an exchange code and redirects when tenantSlug does not match the current subdomain', () => {
      setHostname('creaexamen.com');
      const { compiled, fixture, requestExchangeCode } = setup({
        loginImpl: () => of({ accessToken: 'jwt-abc', tenantSlug: 'colegio-demo' }),
      });
      typeInto(compiled, 'login-email', 'profe@colegio.pe');
      typeInto(compiled, 'login-password', 'secret123');
      fixture.detectChanges();
      submit(compiled);

      expect(requestExchangeCode).toHaveBeenCalledWith('jwt-abc');
      expect(window.location.href).toBe(
        'https://colegio-demo.creaexamen.com/auth/callback#code=one-time-code',
      );
    });

    it('navigates to /app without an exchange when tenantSlug already matches the current subdomain', () => {
      setHostname('colegio-demo.creaexamen.com');
      const { compiled, fixture, requestExchangeCode, navigateByUrl } = setup({
        loginImpl: () => of({ accessToken: 'jwt-abc', tenantSlug: 'colegio-demo' }),
      });
      typeInto(compiled, 'login-email', 'profe@colegio.pe');
      typeInto(compiled, 'login-password', 'secret123');
      fixture.detectChanges();
      submit(compiled);

      expect(requestExchangeCode).not.toHaveBeenCalled();
      expect(navigateByUrl).toHaveBeenCalledWith('/app');
    });

    it('shows an inline error when minting the exchange code fails', () => {
      setHostname('creaexamen.com');
      const { compiled, fixture } = setup({
        loginImpl: () => of({ accessToken: 'jwt-abc', tenantSlug: 'colegio-demo' }),
        requestExchangeCodeImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      typeInto(compiled, 'login-email', 'profe@colegio.pe');
      typeInto(compiled, 'login-password', 'secret123');
      fixture.detectChanges();
      submit(compiled);
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="login-error"]')).toBeTruthy();
    });
  });
});
