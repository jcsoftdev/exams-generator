import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { LucideAngularModule, Ellipsis, Plus } from 'lucide-angular';
import { TenantSettingsComponent } from './tenant-settings.component';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantSettings } from './tenant-settings.models';
import { UsersService } from '../users/users.service';
import { TenantUser } from '../users/users.models';

const SETTINGS: TenantSettings = { id: 'tenant-1', name: 'Colegio X', logoAssetId: null };

function user(o: Partial<TenantUser> & { id: string }): TenantUser {
  return {
    id: o.id,
    email: o.email ?? 'p@col.pe',
    role: o.role ?? 'teacher',
    active: o.active ?? true,
    createdAt: '2026-07-18T00:00:00Z',
  };
}

function setup(overrides: {
  getSettingsImpl?: (...args: unknown[]) => unknown;
  updateSettingsImpl?: (...args: unknown[]) => unknown;
  usersImpl?: () => unknown;
  createImpl?: () => unknown;
  setActiveImpl?: () => unknown;
  resetImpl?: () => unknown;
} = {}) {
  const getSettings = vi.fn(overrides.getSettingsImpl ?? (() => of(SETTINGS)));
  const updateSettings = vi.fn(overrides.updateSettingsImpl ?? ((payload: TenantSettings) => of(payload)));
  const list = vi.fn(overrides.usersImpl ?? (() => of([user({ id: 'u1' }), user({ id: 'u2', active: false })])));
  const create = vi.fn(
    overrides.createImpl ??
      (() => of({ id: 'u3', email: 'n@col.pe', role: 'teacher', temporaryPassword: 'temp12345678' })),
  );
  const setActive = vi.fn(overrides.setActiveImpl ?? ((id: string, active: boolean) => of({ id, active })));
  const resetPassword = vi.fn(overrides.resetImpl ?? ((id: string) => of({ id, temporaryPassword: 'reset1234567' })));

  let objectUrlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-preview-${objectUrlCounter++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  TestBed.configureTestingModule({
    imports: [TenantSettingsComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Ellipsis, Plus })),
      { provide: TenantSettingsService, useValue: { getSettings, updateSettings } },
      { provide: UsersService, useValue: { list, create, setActive, resetPassword } },
    ],
  });

  const fixture = TestBed.createComponent(TenantSettingsComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, getSettings, updateSettings, list, create, setActive, resetPassword };
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
      const { compiled, getSettings } = setup();

      expect(getSettings).toHaveBeenCalled();
      const nameInput = compiled.querySelector<HTMLInputElement>('input[name="name"]')!;
      expect(nameInput.value).toBe('Colegio X');
    });
  });

  describe('logo preview (TS-R1)', () => {
    it('renders a preview from the selected file immediately, with no round trip to the server', () => {
      const { compiled, fixture, updateSettings } = setup();
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
      const { compiled, fixture, updateSettings } = setup();

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

describe('TenantSettingsComponent — tabs', () => {
  it('shows the data tab by default', () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="tab-data-panel"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="tab-teachers-panel"]')).toBeFalsy();
  });

  it('loads and lists teachers on the teachers tab', () => {
    const { compiled, fixture, list } = setup();
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(list).toHaveBeenCalledTimes(1);
    expect(compiled.querySelectorAll('[data-testid="teacher-row"]').length).toBe(2);
  });

  it('adds a teacher and shows the temporary password once', () => {
    const { compiled, fixture, create } = setup();
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="add-teacher"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.componentInstance as unknown as { newEmail: { set(v: string): void } }).newEmail.set('n@col.pe');
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="add-teacher-submit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(create).toHaveBeenCalledWith({ email: 'n@col.pe', role: 'teacher' });
    expect(compiled.querySelector('[data-testid="temp-password"]')?.textContent).toContain('temp12345678');
  });

  it('deactivates a teacher from the row menu', () => {
    const { compiled, fixture, setActive } = setup();
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelectorAll('[data-testid="teacher-menu"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="teacher-toggle-active"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(setActive).toHaveBeenCalledWith('u1', false);
  });

  it('resets a teacher password and shows it once', () => {
    const { compiled, fixture, resetPassword } = setup();
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelectorAll('[data-testid="teacher-menu"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="teacher-reset"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(resetPassword).toHaveBeenCalledWith('u1');
    expect(compiled.querySelector('[data-testid="temp-password"]')?.textContent).toContain('reset1234567');
  });

  it('shows an empty state when there are no teachers', () => {
    const { compiled, fixture } = setup({ usersImpl: () => of([]) });
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="empty-teachers"]')).toBeTruthy();
  });
});
