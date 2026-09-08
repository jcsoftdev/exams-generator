import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FeatureFlag, PlatformFeatureFlagDto } from '@exams-generator/shared';
import { ButtonComponent } from '../../../ui/button/button.component';
import { TagComponent } from '../../../ui/tag/tag.component';
import { AdminFeatureFlagsService } from '../admin-feature-flags.service';

const FLAG_LABELS: Readonly<Record<FeatureFlag, string>> = {
  [FeatureFlag.GlobalBank]: 'Banco central de preguntas',
  [FeatureFlag.AiGeneration]: 'Generar preguntas con IA',
  [FeatureFlag.AiExtraction]: 'Extraer preguntas de una foto',
  [FeatureFlag.ExamVersions]: 'Generar formas de examen',
  [FeatureFlag.TenantBranding]: 'Logo del colegio en el PDF',
};

/**
 * The kill switch: one control per feature, reaching every school at once.
 *
 * Kept collapsed by default and worded as cutting rather than granting,
 * because that is what this layer does. Turning something off here overrides
 * every school's own permission, which is the point when a provider is down
 * or a cost runs away, and a disaster when clicked by accident.
 */
@Component({
  selector: 'app-platform-feature-flags',
  standalone: true,
  imports: [ButtonComponent, TagComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './platform-feature-flags.component.html',
})
export class PlatformFeatureFlagsComponent {
  private readonly service = inject(AdminFeatureFlagsService);

  /**
   * Fires after a cut or a restore lands. Any tenant panel open on the same
   * screen is showing a `platform` column that just went stale, and a panel
   * still reading "permitido" next to a feature that was cut seconds ago is
   * exactly the confusion the three-column layout exists to prevent.
   */
  readonly changed = output<void>();

  protected readonly open = signal(false);
  protected readonly rows = signal<readonly PlatformFeatureFlagDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly saving = signal<FeatureFlag | null>(null);

  protected label(key: FeatureFlag): string {
    return FLAG_LABELS[key];
  }

  protected toggleOpen(): void {
    const next = !this.open();
    this.open.set(next);
    if (next && this.rows().length === 0) {
      this.reload();
    }
  }

  protected reload(): void {
    this.loading.set(true);
    this.service.listPlatform().subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.loading.set(false);
        this.errorMessage.set(null);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set('No se pudo cargar el corte de plataforma.');
      },
    });
  }

  protected set(row: PlatformFeatureFlagDto, enabled: boolean): void {
    this.saving.set(row.key);
    this.service.setPlatform(row.key, enabled).subscribe({
      next: (rows) => {
        this.rows.set(rows);
        this.saving.set(null);
        this.errorMessage.set(null);
        this.changed.emit();
      },
      error: () => {
        this.saving.set(null);
        this.errorMessage.set('No se pudo guardar el cambio.');
      },
    });
  }
}
