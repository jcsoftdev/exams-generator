import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FeatureFlag, TenantFeatureFlagStateDto } from '@exams-generator/shared';
import { ButtonComponent } from '../../../ui/button/button.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { AdminFeatureFlagsService } from '../admin-feature-flags.service';

/** Human labels for the catalog. The enum is a wire contract; this is not. */
const FLAG_LABELS: Readonly<Record<FeatureFlag, string>> = {
  [FeatureFlag.GlobalBank]: 'Banco central de preguntas',
  [FeatureFlag.AiGeneration]: 'Generar preguntas con IA',
  [FeatureFlag.AiExtraction]: 'Extraer preguntas de una foto',
  [FeatureFlag.ExamVersions]: 'Generar formas de examen',
  [FeatureFlag.TenantBranding]: 'Logo del colegio en el PDF',
};

/**
 * One school's feature flags, showing all three values rather than one
 * toggle.
 *
 * Collapsing them would make the screen lie: switching a school ON while the
 * platform kill switch is off leaves the school on 403s, and an admin
 * reading a single toggle that says "on" has no way to find out why. So the
 * platform column is rendered read-only next to the override, and the
 * effective value is stated outright.
 */
@Component({
  selector: 'app-tenant-feature-flags',
  standalone: true,
  imports: [ButtonComponent, TagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tenant-feature-flags.component.html',
})
export class TenantFeatureFlagsComponent {
  private readonly service = inject(AdminFeatureFlagsService);

  readonly tenantId = input.required<string>();
  readonly tenantName = input.required<string>();
  /**
   * Bumped by the parent whenever the platform layer moves. This panel's
   * `platform` column is a copy of that layer, so it has to be re-read; the
   * alternative is a screen where one panel says "cortado" and the one
   * below it still says "permitido".
   */
  readonly refreshToken = input(0);

  protected readonly rows = signal<readonly TenantFeatureFlagStateDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly errorMessage = signal<string | null>(null);
  /** The key currently being written, so only its own row shows a pending state. */
  protected readonly saving = signal<FeatureFlag | null>(null);

  constructor() {
    // `input.required` is not readable in a field initializer, so the first
    // load waits for the first change detection pass instead.
    queueMicrotask(() => this.reload());

    // Skips its own first run: the microtask above is already loading, and a
    // second request on mount would be pure waste.
    let seen = false;
    effect(() => {
      this.refreshToken();
      if (seen) {
        this.reload();
      }
      seen = true;
    });
  }

  protected label(key: FeatureFlag): string {
    return FLAG_LABELS[key];
  }

  protected reload(): void {
    this.loading.set(true);
    this.service.listForTenant(this.tenantId()).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
        this.errorMessage.set(null);
      },
      error: (error: HttpErrorResponse) => {
        this.loading.set(false);
        this.errorMessage.set(
          error.status === 404
            ? 'Ese colegio ya no existe.'
            : 'No se pudieron cargar los permisos. Reintenta.',
        );
      },
    });
  }

  protected setOverride(row: TenantFeatureFlagStateDto, enabled: boolean): void {
    this.write(row.key, this.service.setForTenant(this.tenantId(), row.key, enabled));
  }

  /**
   * Removes the override entirely. Distinct from writing the default's
   * current value: a school with no row FOLLOWS the default, so if the
   * default ever changes it moves with it, while a school that decided
   * otherwise stays put.
   */
  protected clearOverride(row: TenantFeatureFlagStateDto): void {
    this.write(row.key, this.service.clearForTenant(this.tenantId(), row.key));
  }

  private write(
    key: FeatureFlag,
    request: ReturnType<AdminFeatureFlagsService['setForTenant']>,
  ): void {
    this.saving.set(key);
    request.subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.saving.set(null);
        this.errorMessage.set(null);
      },
      error: () => {
        this.saving.set(null);
        this.errorMessage.set('No se pudo guardar el cambio.');
      },
    });
  }
}
