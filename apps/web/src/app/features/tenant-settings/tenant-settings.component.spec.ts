import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { LucideAngularModule, Ellipsis, Plus, School } from 'lucide-angular';
import { TenantSettingsComponent } from './tenant-settings.component';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantSettings } from './tenant-settings.models';
import { UsersService } from '../users/users.service';
import { TenantUser } from '../users/users.models';

const SETTINGS: TenantSettings = { id: 'tenant-1', name: 'Colegio X', city: 'Arequipa', logoAssetId: null };

function user(o: Partial<TenantUser> & { id: string }): TenantUser {
  return {
    id: o.id,
    email: o.email ?? 'p@col.pe',
    name: o.name ?? 'Profesor Prueba',
    role: o.role ?? 'teacher',
    active: o.active ?? true,
    createdAt: '2026-07-18T00:00:00Z',
  };
}

function setup(overrides: {
  getSettingsImpl?: (...args: unknown[]) => unknown;
  updateSettingsImpl?: (...args: unknown[]) => unknown;
  fetchLogoImpl?: (...args: unknown[]) => unknown;
  usersImpl?: () => unknown;
  createImpl?: () => unknown;
  setActiveImpl?: () => unknown;
  resetImpl?: () => unknown;
} = {}) {
  const getSettings = vi.fn(overrides.getSettingsImpl ?? (() => of(SETTINGS)));
  const updateSettings = vi.fn(overrides.updateSettingsImpl ?? ((payload: TenantSettings) => of(payload)));
  const fetchLogo = vi.fn(overrides.fetchLogoImpl ?? (() => of(new Blob(['fake'], { type: 'image/png' }))));
  const list = vi.fn(overrides.usersImpl ?? (() => of([user({ id: 'u1' }), user({ id: 'u2', active: false })])));
  const create = vi.fn(
    overrides.createImpl ??
      (() =>
        of({ id: 'u3', email: 'n@col.pe', name: 'Nuevo Profesor', role: 'teacher', temporaryPassword: 'temp12345678' })),
  );
  const setActive = vi.fn(overrides.setActiveImpl ?? ((id: string, active: boolean) => of({ id, active })));
  const resetPassword = vi.fn(overrides.resetImpl ?? ((id: string) => of({ id, temporaryPassword: 'reset1234567' })));

  let objectUrlCounter = 0;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-preview-${objectUrlCounter++}`);
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  TestBed.configureTestingModule({
    imports: [TenantSettingsComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Ellipsis, Plus, School })),
      { provide: TenantSettingsService, useValue: { getSettings, updateSettings, fetchLogo } },
      { provide: UsersService, useValue: { list, create, setActive, resetPassword } },
    ],
  });

  const fixture = TestBed.createComponent(TenantSettingsComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, getSettings, updateSettings, fetchLogo, list, create, setActive, resetPassword };
}

function selectLogoFile(compiled: HTMLElement, fixture: { detectChanges: () => void }, file: File): void {
  const input = compiled.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
  fixture.detectChanges();
}

describe('TenantSettingsComponent', () => {
  describe('with-data', () => {
    it('loads the current tenant name and city on init', () => {
      const { compiled, getSettings } = setup();

      expect(getSettings).toHaveBeenCalled();
      const nameInput = compiled.querySelector<HTMLInputElement>('input[name="name"]')!;
      expect(nameInput.value).toBe('Colegio X');
      const cityInput = compiled.querySelector<HTMLInputElement>('input[name="city"]')!;
      expect(cityInput.value).toBe('Arequipa');
    });
  });

  describe('logo placeholder / saved-logo preview', () => {
    it('shows a placeholder (school icon) when the tenant has no logo yet', () => {
      const { compiled, fetchLogo } = setup();

      expect(fetchLogo).not.toHaveBeenCalled();
      expect(compiled.querySelector('[data-testid="logo-placeholder"]')).toBeTruthy();
      expect(compiled.querySelector('[data-testid="logo-preview"]')).toBeFalsy();
    });

    it('fetches and shows the 64px preview of the logo already saved on the tenant', () => {
      const { compiled, fetchLogo } = setup({
        getSettingsImpl: () => of({ ...SETTINGS, logoAssetId: 'asset-9' }),
      });

      expect(fetchLogo).toHaveBeenCalledWith('asset-9');
      const preview = compiled.querySelector<HTMLImageElement>('[data-testid="logo-preview"]');
      expect(preview).toBeTruthy();
      expect(preview?.getAttribute('src')).toMatch(/^blob:/);
      expect(compiled.querySelector('[data-testid="logo-placeholder"]')).toBeFalsy();
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

  it('shows the teacher name (falling back to email only when name is missing) and the email alongside it', () => {
    const { compiled, fixture } = setup({
      usersImpl: () => of([user({ id: 'u1', name: 'María Rojas', email: 'mrojas@sanmartin.edu.pe' })]),
    });
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const name = compiled.querySelector('[data-testid="teacher-name"]')!;
    expect(name.textContent).toContain('María Rojas');
    expect(name.textContent).toContain('mrojas@sanmartin.edu.pe');
  });

  it('renders the role chip with the primary-100/tint-texto token pair (not the ai/easy tag variants)', () => {
    const { compiled, fixture } = setup({
      usersImpl: () => of([user({ id: 'u1', role: 'school_admin' })]),
    });
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const chip = compiled.querySelector('[data-testid="teacher-role-chip"]')!;
    expect(chip.className).toContain('bg-primary-100');
    expect(chip.className).toContain('text-tint-texto');
    expect(chip.textContent).toContain('Administra');
  });

  it('pluralizes the active-count label: singular for 1, plural otherwise', () => {
    const { compiled, fixture } = setup({ usersImpl: () => of([user({ id: 'u1', active: true })]) });
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="active-count"]')?.textContent?.trim()).toBe('1 profesor activo');
  });

  it('adds a teacher (name required) and shows the temporary password once', () => {
    const { compiled, fixture, create } = setup();
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="add-teacher"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const instance = fixture.componentInstance as unknown as {
      newName: { set(v: string): void };
      newEmail: { set(v: string): void };
    };
    instance.newName.set('Nuevo Profesor');
    instance.newEmail.set('n@col.pe');
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="add-teacher-submit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(create).toHaveBeenCalledWith({ email: 'n@col.pe', name: 'Nuevo Profesor', role: 'teacher' });
    expect(compiled.querySelector('[data-testid="temp-password"]')?.textContent).toContain('temp12345678');
  });

  it('creates a teacher by typing into the real form fields and shows the name (+ initials) in the row after reload', () => {
    let listCall = 0;
    const { compiled, fixture } = setup({
      usersImpl: () =>
        of(listCall++ === 0 ? [] : [user({ id: 'u9', name: 'Profesor Prueba QA', email: 'qa-visual@col.pe' })]),
      createImpl: () =>
        of({ id: 'u9', email: 'qa-visual@col.pe', name: 'Profesor Prueba QA', role: 'teacher', temporaryPassword: 'temp12345678' }),
    });
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="add-teacher"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const nameInput = compiled.querySelector<HTMLInputElement>('input[name="new-teacher-name"]')!;
    nameInput.value = 'Profesor Prueba QA';
    nameInput.dispatchEvent(new Event('input'));
    const emailInput = compiled.querySelector<HTMLInputElement>('input[type="email"]')!;
    emailInput.value = 'qa-visual@col.pe';
    emailInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (compiled.querySelector('[data-testid="add-teacher-submit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const nameCell = compiled.querySelector('[data-testid="teacher-name"]')!;
    expect(nameCell.textContent).toContain('Profesor Prueba QA');
    expect(nameCell.textContent).toContain('qa-visual@col.pe');
    const avatar = compiled.querySelector('.h-9.w-9.rounded-full')!;
    expect(avatar.textContent?.trim()).toBe('PP');
  });

  it('does not submit when the name field is blank', () => {
    const { compiled, fixture, create } = setup();
    (compiled.querySelector('[data-testid="tab-teachers"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="add-teacher"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.componentInstance as unknown as { newEmail: { set(v: string): void } }).newEmail.set('n@col.pe');
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="add-teacher-submit"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(create).not.toHaveBeenCalled();
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
