import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { TenantSettingsComponent } from './tenant-settings.component';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantSettings } from './tenant-settings.models';

const SETTINGS: TenantSettings = { id: 'tenant-1', name: 'Colegio X', logoAssetId: null };

function setup(overrides: {
  getSettingsImpl?: (...args: unknown[]) => unknown;
  updateSettingsImpl?: (...args: unknown[]) => unknown;
}) {
  const getSettings = vi.fn(overrides.getSettingsImpl ?? (() => of(SETTINGS)));
  const updateSettings = vi.fn(overrides.updateSettingsImpl ?? ((payload: TenantSettings) => of(payload)));

  let objectUrlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-preview-${objectUrlCounter++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  TestBed.configureTestingModule({
    imports: [TenantSettingsComponent],
    providers: [{ provide: TenantSettingsService, useValue: { getSettings, updateSettings } }],
  });

  const fixture = TestBed.createComponent(TenantSettingsComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, getSettings, updateSettings };
}

function selectLogoFile(compiled: HTMLElement, fixture: { detectChanges: () => void }, file: File): void {
  const input = compiled.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

describe('TenantSettingsComponent', () => {
  describe('with-data', () => {
    it('loads the current tenant name on init', () => {
      const { compiled, getSettings } = setup({});

      expect(getSettings).toHaveBeenCalled();
      const nameInput = compiled.querySelector<HTMLInputElement>('input[name="name"]')!;
      expect(nameInput.value).toBe('Colegio X');
    });
  });

  describe('logo preview (TS-R1)', () => {
    it('renders a preview from the selected file immediately, with no round trip to the server', () => {
      const { compiled, fixture, updateSettings } = setup({});
      const file = new File(['fake-bytes'], 'logo.png', { type: 'image/png' });

      selectLogoFile(compiled, fixture, file);

      expect(updateSettings).not.toHaveBeenCalled();
      const preview = compiled.querySelector<HTMLImageElement>('[data-testid="logo-preview"]');
      expect(preview).toBeTruthy();
      expect(preview?.getAttribute('src')).toMatch(/^blob:/);
    });
  });

  describe('save failure (TS-R2)', () => {
    it('retains the unsaved edits (name + logo preview) and shows an error state when save fails', () => {
      const { compiled, fixture } = setup({
        updateSettingsImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })),
      });
      const file = new File(['fake-bytes'], 'logo.png', { type: 'image/png' });

      const nameInput = compiled.querySelector<HTMLInputElement>('input[name="name"]')!;
      nameInput.value = 'Nombre editado';
      nameInput.dispatchEvent(new Event('input'));
      selectLogoFile(compiled, fixture, file);

      const saveButton = compiled.querySelector<HTMLButtonElement>('[data-testid="save-button"] button')!;
      saveButton.click();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="save-error"]')).toBeTruthy();
      const nameInputAfter = compiled.querySelector<HTMLInputElement>('input[name="name"]')!;
      expect(nameInputAfter.value).toBe('Nombre editado');
      const preview = compiled.querySelector<HTMLImageElement>('[data-testid="logo-preview"]');
      expect(preview?.getAttribute('src')).toMatch(/^blob:/);
    });

    it('saves successfully and clears the error state', () => {
      const { compiled, fixture, updateSettings } = setup({});

      const nameInput = compiled.querySelector<HTMLInputElement>('input[name="name"]')!;
      nameInput.value = 'Colegio Actualizado';
      nameInput.dispatchEvent(new Event('input'));

      const saveButton = compiled.querySelector<HTMLButtonElement>('[data-testid="save-button"] button')!;
      saveButton.click();
      fixture.detectChanges();

      expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({ name: 'Colegio Actualizado' }));
      expect(compiled.querySelector('[data-testid="save-error"]')).toBeFalsy();
      expect(compiled.querySelector('[data-testid="save-success"]')).toBeTruthy();
    });
  });

  describe('loading', () => {
    it('shows a loading indicator while the initial settings call is pending', () => {
      const subject = new Subject<TenantSettings>();
      const { compiled, fixture } = setup({ getSettingsImpl: () => subject.asObservable() });

      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeTruthy();

      subject.next(SETTINGS);
      subject.complete();
      fixture.detectChanges();

      expect(compiled.querySelector('[data-testid="loading-indicator"]')).toBeFalsy();
    });
  });
});
