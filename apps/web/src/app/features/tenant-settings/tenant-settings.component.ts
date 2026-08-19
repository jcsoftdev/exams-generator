import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule } from 'lucide-angular';
import { ButtonComponent } from '../../ui/button/button.component';
import { InputComponent } from '../../ui/input/input.component';
import { SelectComponent } from '../../ui/select/select.component';
import { TagComponent } from '../../ui/tag/tag.component';
import { ModalComponent } from '../../ui/modal/modal.component';
import { PaginationComponent } from '../../ui/pagination/pagination.component';
import { TabsComponent, TabItem } from '../../ui/tabs/tabs.component';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantSettings } from './tenant-settings.models';
import { UsersService } from '../users/users.service';
import { TenantUser, UserRole } from '../users/users.models';
import { roleLabel } from '../../core/auth/role-label.util';

type Tab = 'data' | 'teachers';

/**
 * Tenant-settings screen (design doc §6, spec TS-R1/R2, plan Task 11).
 * Two tabs: "Datos y logo" (the original form — preserved, same testids so
 * the pre-existing spec keeps passing) and "Profesores" (users module S8:
 * list/create/setActive/resetPassword). Logo upload shows a preview from the
 * SELECTED FILE (`URL.createObjectURL(file)`) immediately — no round trip to
 * the server needed before the preview renders (TS-R1). On a failed save,
 * the form retains every unsaved edit (name + logo preview) and shows the
 * error inline — it never resets (TS-R2). Temporary passwords (create /
 * reset) are shown exactly once, never persisted beyond the signal.
 */
@Component({
  selector: 'app-tenant-settings',
  standalone: true,
  imports: [
    ButtonComponent,
    InputComponent,
    SelectComponent,
    TagComponent,
    ModalComponent,
    PaginationComponent,
    TabsComponent,
    LucideAngularModule,
  ],
  templateUrl: './tenant-settings.component.html',
})
export class TenantSettingsComponent {
  private readonly tenantSettingsService = inject(TenantSettingsService);
  private readonly usersService = inject(UsersService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly tab = signal<Tab>('data');
  protected readonly tabItems: readonly TabItem<Tab>[] = [
    { value: 'data', label: 'Datos y logo', testId: 'tab-data' },
    { value: 'teachers', label: 'Profesores', testId: 'tab-teachers' },
  ];

  // ---- Datos y logo (form existente) ----
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly name = signal('');
  protected readonly city = signal('');
  protected readonly selectedLogo = signal<File | null>(null);
  /** Preview from a just-picked file (highest priority) or from the logo already saved on the tenant. */
  protected readonly logoPreviewUrl = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saveSuccess = signal(false);
  private readonly objectUrls: string[] = [];

  // ---- Profesores ----
  protected readonly TEACHERS_PAGE_SIZE = 20;
  protected readonly teachers = signal<TenantUser[]>([]);
  protected readonly teachersTotal = signal(0);
  protected readonly teachersPage = signal(1);
  protected readonly teachersLoading = signal(false);
  protected readonly teachersError = signal<string | null>(null);
  protected readonly teachersLoaded = signal(false);
  protected readonly openMenuId = signal<string | null>(null);
  protected readonly addOpen = signal(false);
  protected readonly newName = signal('');
  protected readonly newEmail = signal('');
  protected readonly newRole = signal<UserRole>('teacher');
  protected readonly tempPassword = signal<string | null>(null);
  protected readonly usersActionError = signal<string | null>(null);
  protected readonly pendingReset = signal<TenantUser | null>(null);
  protected readonly pendingDeactivate = signal<TenantUser | null>(null);

  protected readonly roleOptions = [
    { value: 'teacher' as UserRole, label: 'Profesor' },
    { value: 'school_admin' as UserRole, label: 'Administrador' },
  ];
  protected readonly activeCount = computed(() => this.teachers().filter((t) => t.active).length);
  protected readonly activeCountLabel = computed(() => {
    const count = this.activeCount();
    return count === 1 ? '1 profesor activo' : `${count} profesores activos`;
  });

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => this.objectUrls.forEach((u) => URL.revokeObjectURL(u)));
  }

  protected setTab(t: Tab): void {
    this.tab.set(t);
    if (t === 'teachers' && !this.teachersLoaded()) {
      this.loadTeachers();
    }
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.tenantSettingsService.getSettings().subscribe({
      next: (s: TenantSettings) => {
        this.loading.set(false);
        this.name.set(s.name);
        this.city.set(s.city ?? '');
        if (s.logoAssetId) {
          this.loadSavedLogo(s.logoAssetId);
        }
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo cargar la configuración. Inténtalo de nuevo.');
      },
    });
  }

  /**
   * `GET /assets/:id` is Bearer-JWT protected — a plain `<img src>` bound to
   * that URL would 401, same reasoning as the bank feature's image preview
   * (`bank-list.component.ts#loadImages`). Fetches the bytes through
   * `TenantSettingsService.fetchLogo` and turns them into a `blob:` object
   * URL so the 64px preview box can show the logo ALREADY saved on the
   * tenant, not just one the admin just picked in this session.
   */
  private loadSavedLogo(logoAssetId: string): void {
    this.tenantSettingsService.fetchLogo(logoAssetId).subscribe((blob) => {
      const url = URL.createObjectURL(blob);
      this.objectUrls.push(url);
      this.logoPreviewUrl.set(url);
    });
  }

  protected onLogoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.selectedLogo.set(file);
    if (!file) {
      return;
    }
    const url = URL.createObjectURL(file);
    this.objectUrls.push(url);
    this.logoPreviewUrl.set(url);
  }

  protected onSave(): void {
    if (this.saving()) {
      return;
    }
    this.saveError.set(null);
    this.saveSuccess.set(false);
    this.saving.set(true);
    const logo = this.selectedLogo();
    this.tenantSettingsService.updateSettings({ name: this.name(), city: this.city(), ...(logo ? { logo } : {}) }).subscribe({
      next: () => {
        this.saving.set(false);
        this.saveSuccess.set(true);
      },
      error: (_e: HttpErrorResponse) => {
        this.saving.set(false);
        this.saveError.set('No se pudo guardar la configuración. Inténtalo de nuevo.');
      },
    });
  }

  private loadTeachers(): void {
    this.teachersLoading.set(true);
    this.teachersError.set(null);
    this.usersService.list(this.teachersPage(), this.TEACHERS_PAGE_SIZE).subscribe({
      next: (res) => {
        this.teachersLoading.set(false);
        this.teachersLoaded.set(true);
        this.teachers.set([...res.items]);
        this.teachersTotal.set(res.total);
      },
      error: () => {
        this.teachersLoading.set(false);
        this.teachersError.set('No se pudieron cargar los profesores. Inténtalo de nuevo.');
      },
    });
  }

  protected onTeachersPageChange(page: number): void {
    this.teachersPage.set(page);
    this.loadTeachers();
  }

  /** Two-letter avatar initials from the teacher's name (falls back to the email if a legacy row has no name). */
  protected initials(u: Pick<TenantUser, 'name' | 'email'>): string {
    const source = u.name?.trim();
    if (!source) {
      return u.email.slice(0, 2).toUpperCase();
    }
    const parts = source.split(/\s+/).filter(Boolean);
    const letters = parts.length >= 2 ? `${parts[0]![0]}${parts[1]![0]}` : source.slice(0, 2);
    return letters.toUpperCase();
  }

  /** Delegates to the shared `roleLabel` util (single source of truth — see its doc comment). */
  protected roleLabel(role: string): string {
    return roleLabel(role);
  }

  protected toggleMenu(id: string): void {
    this.openMenuId.update((c) => (c === id ? null : id));
  }

  protected openAdd(): void {
    this.newName.set('');
    this.newEmail.set('');
    this.newRole.set('teacher');
    this.tempPassword.set(null);
    this.usersActionError.set(null);
    this.addOpen.set(true);
  }

  protected closeAdd(): void {
    this.addOpen.set(false);
  }

  protected onRoleChange(role: UserRole | null): void {
    if (role) {
      this.newRole.set(role);
    }
  }

  protected addValid(): boolean {
    return this.newName().trim().length > 0 && /\S+@\S+\.\S+/.test(this.newEmail());
  }

  protected submitAdd(): void {
    if (!this.addValid()) {
      return;
    }
    this.usersActionError.set(null);
    this.usersService.create({ email: this.newEmail(), name: this.newName().trim(), role: this.newRole() }).subscribe({
      next: (res) => {
        this.tempPassword.set(res.temporaryPassword);
        this.loadTeachers();
      },
      error: () => this.usersActionError.set('No se pudo agregar el profesor (¿correo ya usado?). Inténtalo de nuevo.'),
    });
  }

  /** Reactivating isn't destructive — only deactivating goes through the confirm modal. */
  protected toggleActive(u: TenantUser): void {
    this.openMenuId.set(null);
    if (u.active) {
      this.pendingDeactivate.set(u);
      return;
    }
    this.setActive(u, true);
  }

  protected cancelDeactivate(): void {
    this.pendingDeactivate.set(null);
  }

  protected confirmDeactivate(): void {
    const u = this.pendingDeactivate();
    this.pendingDeactivate.set(null);
    if (u) {
      this.setActive(u, false);
    }
  }

  private setActive(u: TenantUser, active: boolean): void {
    this.usersActionError.set(null);
    this.usersService.setActive(u.id, active).subscribe({
      next: () => this.loadTeachers(),
      error: () => this.usersActionError.set('No se pudo actualizar el estado. Inténtalo de nuevo.'),
    });
  }

  protected requestReset(u: TenantUser): void {
    this.openMenuId.set(null);
    this.pendingReset.set(u);
  }

  protected cancelReset(): void {
    this.pendingReset.set(null);
  }

  protected confirmReset(): void {
    const u = this.pendingReset();
    this.pendingReset.set(null);
    if (!u) return;
    this.usersActionError.set(null);
    this.usersService.resetPassword(u.id).subscribe({
      next: (res) => this.tempPassword.set(res.temporaryPassword),
      error: () => this.usersActionError.set('No se pudo restablecer la contraseña. Inténtalo de nuevo.'),
    });
  }
}
