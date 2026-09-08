import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { FeatureFlag, TenantFeatureFlagStateDto } from '@exams-generator/shared';
import { AdminFeatureFlagsService } from '../admin-feature-flags.service';
import { TenantFeatureFlagsComponent } from './tenant-feature-flags.component';

function row(
  o: Partial<TenantFeatureFlagStateDto> & { key: FeatureFlag },
): TenantFeatureFlagStateDto {
  const platform = o.platform ?? true;
  const tenant = o.tenant ?? null;
  const defaultEnabled = o.defaultEnabled ?? false;
  return {
    key: o.key,
    platform,
    tenant,
    defaultEnabled,
    effective: o.effective ?? (platform && (tenant ?? defaultEnabled)),
  };
}

function setup(
  overrides: {
    listImpl?: () => unknown;
    setImpl?: () => unknown;
    clearImpl?: () => unknown;
  } = {},
) {
  const listForTenant = vi.fn(
    overrides.listImpl ??
      (() =>
        of([
          row({ key: FeatureFlag.GlobalBank, defaultEnabled: true }),
          row({ key: FeatureFlag.AiGeneration }),
        ])),
  );
  const setForTenant = vi.fn(
    overrides.setImpl ??
      (() => of([row({ key: FeatureFlag.AiGeneration, tenant: true, effective: true })])),
  );
  const clearForTenant = vi.fn(
    overrides.clearImpl ?? (() => of([row({ key: FeatureFlag.AiGeneration })])),
  );

  TestBed.configureTestingModule({
    imports: [TenantFeatureFlagsComponent],
    providers: [
      {
        provide: AdminFeatureFlagsService,
        useValue: { listForTenant, setForTenant, clearForTenant },
      },
    ],
  });

  const fixture = TestBed.createComponent(TenantFeatureFlagsComponent);
  fixture.componentRef.setInput('tenantId', 't1');
  fixture.componentRef.setInput('tenantName', 'Colegio X');
  fixture.detectChanges();

  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listForTenant,
    setForTenant,
    clearForTenant,
    // The first load is queued on a microtask, since `input.required` is not
    // readable in a field initializer.
    settle: async () => {
      await Promise.resolve();
      fixture.detectChanges();
    },
  };
}

describe('TenantFeatureFlagsComponent', () => {
  it('loads the school it was given', async () => {
    const { listForTenant, settle } = setup();
    await settle();

    expect(listForTenant).toHaveBeenCalledWith('t1');
  });

  it('shows the platform value next to the override, not just the result', async () => {
    // A single toggle would make the screen lie: an override switched on
    // under a cut platform layer still leaves the school on 403s, and an
    // admin reading "on" has no way to find out why.
    const { compiled, settle } = setup({
      listImpl: () =>
        of([
          row({
            key: FeatureFlag.AiGeneration,
            platform: false,
            tenant: true,
            effective: false,
          }),
        ]),
    });
    await settle();

    const text = compiled.textContent ?? '';
    expect(text).toMatch(/cortado/i);
    expect(compiled.querySelector('[data-testid="flag-effective"]')?.textContent).toMatch(
      /inactivo/i,
    );
  });

  it('says a flag with no override is following the default, and what that default is', async () => {
    const { compiled, settle } = setup({
      listImpl: () =>
        of([row({ key: FeatureFlag.GlobalBank, defaultEnabled: true, tenant: null })]),
    });
    await settle();

    expect(compiled.textContent).toMatch(/por defecto/i);
  });

  it('writes an override when the admin grants a feature', async () => {
    const { compiled, setForTenant, settle } = setup();
    await settle();

    compiled.querySelectorAll<HTMLButtonElement>('[data-testid="flag-enable"] button')[1]!.click();

    expect(setForTenant).toHaveBeenCalledWith('t1', FeatureFlag.AiGeneration, true);
  });

  it('offers dropping the override only where one exists', async () => {
    const { compiled, settle } = setup({
      listImpl: () =>
        of([
          row({ key: FeatureFlag.GlobalBank, defaultEnabled: true, tenant: null }),
          row({ key: FeatureFlag.AiGeneration, tenant: true, effective: true }),
        ]),
    });
    await settle();

    // One row has a decision to undo, the other has nothing to undo.
    expect(compiled.querySelectorAll('[data-testid="flag-clear"]').length).toBe(1);
  });

  it('drops the override rather than writing the default value back', async () => {
    const { compiled, clearForTenant, settle } = setup({
      listImpl: () => of([row({ key: FeatureFlag.AiGeneration, tenant: false })]),
    });
    await settle();

    compiled.querySelector<HTMLButtonElement>('[data-testid="flag-clear"] button')!.click();

    // Writing the default's current value would look identical today and
    // diverge the day the default changes.
    expect(clearForTenant).toHaveBeenCalledWith('t1', FeatureFlag.AiGeneration);
  });

  it('says so when the school no longer exists', async () => {
    const { compiled, settle } = setup({
      listImpl: () => throwError(() => new HttpErrorResponse({ status: 404 })),
    });
    await settle();

    expect(compiled.querySelector('[data-testid="flags-error"]')?.textContent).toMatch(
      /ya no existe/i,
    );
  });

  it('reports a failed write instead of showing a value that was never saved', async () => {
    const { compiled, settle, fixture } = setup({
      setImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    await settle();

    compiled.querySelectorAll<HTMLButtonElement>('[data-testid="flag-enable"] button')[1]!.click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="flags-error"]')?.textContent).toMatch(
      /no se pudo guardar/i,
    );
  });

  it('re-reads the platform column when the kill switch moves', async () => {
    const { fixture, listForTenant, settle } = setup();
    await settle();
    expect(listForTenant).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('refreshToken', 1);
    fixture.detectChanges();

    // Otherwise the panel keeps saying "permitido" next to a feature the
    // admin cut seconds ago, one section up the same screen.
    expect(listForTenant).toHaveBeenCalledTimes(2);
  });

  it('does not fire a second request just for mounting', async () => {
    const { listForTenant, settle } = setup();
    await settle();

    // The constructor already loads; an effect that ran on its first pass
    // would double every open.
    expect(listForTenant).toHaveBeenCalledTimes(1);
  });
});
