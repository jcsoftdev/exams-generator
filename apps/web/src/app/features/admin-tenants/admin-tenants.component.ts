import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ButtonComponent } from '../../ui/button/button.component';
import { InputComponent } from '../../ui/input/input.component';
import { ModalComponent } from '../../ui/modal/modal.component';
import { TagComponent } from '../../ui/tag/tag.component';
import { PaginationComponent } from '../../ui/pagination/pagination.component';
import { AdminTenantsService } from './admin-tenants.service';
import { AdminTenant } from './admin-tenants.models';

const ERROR_MESSAGE = 'No se pudieron cargar los colegios. Inténtalo de nuevo.';

/**
 * `platform_admin`-only "Colegios" screen (audit P1 — the backend has a
 * full tenant CRUD but the frontend had zero routes for it; a platform_admin
 * landed on a dashboard with everything at zero and no way to create a
 * school). List + create + edit(name/city) + activate/deactivate + delete,
 * same confirm-modal/danger-button conventions as every other destructive
 * action in the app (bank-list, tenant-settings).
 */
@Component({
  selector: 'app-admin-tenants',
  standalone: true,
  imports: [ButtonComponent, InputComponent, ModalComponent, TagComponent, PaginationComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './admin-tenants.component.html',
})
export class AdminTenantsComponent {
  private readonly service = inject(AdminTenantsService);

  protected readonly PAGE_SIZE = 20;
  protected readonly tenants = signal<AdminTenant[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);

  // ---- create ----
  protected readonly createOpen = signal(false);
  protected readonly createName = signal('');
  protected readonly createSlug = signal('');
  protected readonly creating = signal(false);
  protected readonly createError = signal<string | null>(null);

  // ---- edit ----
  protected readonly editing = signal<AdminTenant | null>(null);
  protected readonly editName = signal('');
  protected readonly editCity = signal('');
  protected readonly savingEdit = signal(false);
  protected readonly editError = signal<string | null>(null);

  // ---- deactivate/delete confirms ----
  protected readonly pendingDeactivate = signal<AdminTenant | null>(null);
  protected readonly pendingDelete = signal<AdminTenant | null>(null);
  protected readonly actionError = signal<string | null>(null);

  constructor() {
    this.load();
  }

  private load(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.service.list(this.page(), this.PAGE_SIZE).subscribe({
      next: (res) => {
        this.loading.set(false);
        this.tenants.set([...res.items]);
        this.total.set(res.total);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(ERROR_MESSAGE);
      },
    });
  }

  protected retry(): void {
    this.load();
  }

  protected onPageChange(page: number): void {
    this.page.set(page);
    this.load();
  }

  // ---- create ----
  protected openCreate(): void {
    this.createName.set('');
    this.createSlug.set('');
    this.createError.set(null);
    this.createOpen.set(true);
  }

  protected closeCreate(): void {
    this.createOpen.set(false);
  }

  protected createValid(): boolean {
    return (
      this.createName().trim().length > 0 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(this.createSlug())
    );
  }

  protected submitCreate(): void {
    if (!this.createValid() || this.creating()) return;
    this.creating.set(true);
    this.createError.set(null);
    this.service.create({ name: this.createName().trim(), slug: this.createSlug() }).subscribe({
      next: () => {
        this.creating.set(false);
        this.createOpen.set(false);
        this.page.set(1);
        this.load();
      },
      error: (e: HttpErrorResponse) => {
        this.creating.set(false);
        this.createError.set(
          e.status === 409
            ? 'Ya existe un colegio con ese slug.'
            : 'No se pudo crear el colegio. Inténtalo de nuevo.',
        );
      },
    });
  }

  // ---- edit ----
  protected openEdit(tenant: AdminTenant): void {
    this.editing.set(tenant);
    this.editName.set(tenant.name);
    this.editCity.set(tenant.city ?? '');
    this.editError.set(null);
  }

  protected closeEdit(): void {
    this.editing.set(null);
  }

  protected editValid(): boolean {
    return this.editName().trim().length > 0;
  }

  protected submitEdit(): void {
    const tenant = this.editing();
    if (!tenant || !this.editValid() || this.savingEdit()) return;
    this.savingEdit.set(true);
    this.editError.set(null);
    this.service
      .update(tenant.id, { name: this.editName().trim(), city: this.editCity().trim() })
      .subscribe({
        next: () => {
          this.savingEdit.set(false);
          this.editing.set(null);
          this.load();
        },
        error: () => {
          this.savingEdit.set(false);
          this.editError.set('No se pudo guardar el colegio. Inténtalo de nuevo.');
        },
      });
  }

  // ---- activate/deactivate ----
  protected toggleActive(tenant: AdminTenant): void {
    if (tenant.active) {
      this.pendingDeactivate.set(tenant);
      return;
    }
    this.setActive(tenant, true);
  }

  protected cancelDeactivate(): void {
    this.pendingDeactivate.set(null);
  }

  protected confirmDeactivate(): void {
    const tenant = this.pendingDeactivate();
    this.pendingDeactivate.set(null);
    if (tenant) {
      this.setActive(tenant, false);
    }
  }

  private setActive(tenant: AdminTenant, active: boolean): void {
    this.actionError.set(null);
    this.service.update(tenant.id, { active }).subscribe({
      next: () => this.load(),
      error: () => this.actionError.set('No se pudo actualizar el estado. Inténtalo de nuevo.'),
    });
  }

  // ---- delete ----
  protected requestDelete(tenant: AdminTenant): void {
    this.pendingDelete.set(tenant);
  }

  protected cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  protected confirmDelete(): void {
    const tenant = this.pendingDelete();
    this.pendingDelete.set(null);
    if (!tenant) return;
    this.actionError.set(null);
    this.service.remove(tenant.id).subscribe({
      next: () => this.load(),
      error: () => this.actionError.set('No se pudo borrar el colegio. Inténtalo de nuevo.'),
    });
  }
}
