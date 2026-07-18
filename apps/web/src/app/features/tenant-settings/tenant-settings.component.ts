import { Component, DestroyRef, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { ButtonComponent } from '../../ui/button/button.component';
import { InputComponent } from '../../ui/input/input.component';
import { TenantSettingsService } from './tenant-settings.service';
import { TenantSettings } from './tenant-settings.models';

/**
 * New tenant-settings screen (design doc §6, spec TS-R1/R2). Logo upload
 * shows a preview from the SELECTED FILE (`URL.createObjectURL(file)`)
 * immediately — no round trip to the server needed before the preview
 * renders (TS-R1). On a failed save, the form retains every unsaved edit
 * (name + logo preview) and shows the error inline — it never resets
 * (TS-R2).
 */
@Component({
  selector: 'app-tenant-settings',
  standalone: true,
  imports: [ButtonComponent, InputComponent],
  templateUrl: './tenant-settings.component.html',
})
export class TenantSettingsComponent {
  private readonly tenantSettingsService = inject(TenantSettingsService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);

  protected readonly name = signal('');
  protected readonly selectedLogo = signal<File | null>(null);
  protected readonly logoPreviewUrl = signal<string | null>(null);

  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);
  protected readonly saveSuccess = signal(false);

  private readonly objectUrls: string[] = [];

  constructor() {
    this.load();
    this.destroyRef.onDestroy(() => {
      for (const url of this.objectUrls) {
        URL.revokeObjectURL(url);
      }
    });
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set(null);

    this.tenantSettingsService.getSettings().subscribe({
      next: (settings: TenantSettings) => {
        this.loading.set(false);
        this.name.set(settings.name);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('No se pudo cargar la configuración. Inténtalo de nuevo.');
      },
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

    this.tenantSettingsService
      .updateSettings({ name: this.name(), ...(logo ? { logo } : {}) })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.saveSuccess.set(true);
        },
        error: (_error: HttpErrorResponse) => {
          this.saving.set(false);
          this.saveError.set('No se pudo guardar la configuración. Inténtalo de nuevo.');
        },
      });
  }
}
