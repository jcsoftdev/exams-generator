import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { FeatureFlag, PlatformFeatureFlagDto } from '@exams-generator/shared';
import { AdminFeatureFlagsService } from '../admin-feature-flags.service';
import { PlatformFeatureFlagsComponent } from './platform-feature-flags.component';

function row(key: FeatureFlag, enabled = true): PlatformFeatureFlagDto {
  return { key, enabled, updatedAt: null };
}

function setup(overrides: { listImpl?: () => unknown; setImpl?: () => unknown } = {}) {
  const listPlatform = vi.fn(
    overrides.listImpl ??
      (() => of([row(FeatureFlag.GlobalBank), row(FeatureFlag.AiGeneration, false)])),
  );
  const setPlatform = vi.fn(overrides.setImpl ?? (() => of([row(FeatureFlag.GlobalBank, false)])));

  TestBed.configureTestingModule({
    imports: [PlatformFeatureFlagsComponent],
    providers: [{ provide: AdminFeatureFlagsService, useValue: { listPlatform, setPlatform } }],
  });

  const fixture = TestBed.createComponent(PlatformFeatureFlagsComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  const open = () => {
    compiled
      .querySelector<HTMLButtonElement>('[data-testid="platform-flags-toggle"] button')!
      .click();
    fixture.detectChanges();
  };

  return { fixture, compiled, listPlatform, setPlatform, open };
}

describe('PlatformFeatureFlagsComponent', () => {
  it('does not fetch anything until the admin opens it', () => {
    // This panel cuts every school at once. It stays shut, and costs
    // nothing, until somebody deliberately goes looking for it.
    const { listPlatform, compiled } = setup();

    expect(listPlatform).not.toHaveBeenCalled();
    expect(compiled.querySelector('[data-testid="platform-flag-row"]')).toBeNull();
  });

  it('loads the kill switch on first open', () => {
    const { listPlatform, open } = setup();

    open();

    expect(listPlatform).toHaveBeenCalledTimes(1);
  });

  it('words an untouched flag as permitted, not as granted', () => {
    // Absence on this layer means "nobody cut it". Calling it "granted"
    // would suggest the platform is what turns features on, which is the
    // tenant layer's job.
    const { compiled, open } = setup();
    open();

    expect(compiled.textContent).toMatch(/permitido/i);
    expect(compiled.textContent).toMatch(/cortado/i);
  });

  it('cuts a feature for every school at once', () => {
    const { compiled, setPlatform, open } = setup();
    open();

    compiled.querySelector<HTMLButtonElement>('[data-testid="platform-flag-cut"] button')!.click();

    expect(setPlatform).toHaveBeenCalledWith(FeatureFlag.GlobalBank, false);
  });

  it('offers restoring only what is currently cut', () => {
    const { compiled, open } = setup();
    open();

    expect(compiled.querySelectorAll('[data-testid="platform-flag-cut"]').length).toBe(1);
    expect(compiled.querySelectorAll('[data-testid="platform-flag-restore"]').length).toBe(1);
  });

  it('says so when the load fails instead of showing an empty list', () => {
    const { compiled, open } = setup({
      listImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
    });
    open();

    expect(compiled.querySelector('[data-testid="platform-flags-error"]')?.textContent).toMatch(
      /no se pudo cargar/i,
    );
  });

  it('announces a cut so the tenant panels can re-read it', () => {
    const { fixture, compiled, open } = setup();
    open();
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    compiled.querySelector<HTMLButtonElement>('[data-testid="platform-flag-cut"] button')!.click();

    expect(changed).toHaveBeenCalled();
  });
});
