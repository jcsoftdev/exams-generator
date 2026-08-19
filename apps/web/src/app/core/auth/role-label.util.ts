import { Role } from '@exams-generator/shared';

/**
 * Spanish (Peru), tuteo-neutral display label for a `Role`. Single source
 * of truth — previously `TenantSettingsComponent` had its own two-branch
 * `roleLabel()` covering only `teacher`/`school_admin` (the only roles it
 * can assign), which silently fell back to "Profesor" for anything else.
 * That was fine there (a school_admin can only create those two roles) but
 * broke for the shell's user menu, which must label EVERY role, including
 * the tenant-less `platform_admin`/`content_editor` staff roles.
 */
const ROLE_LABELS: Record<Role, string> = {
  [Role.Teacher]: 'Profesor',
  [Role.SchoolAdmin]: 'Administrador',
  [Role.PlatformAdmin]: 'Administrador de plataforma',
  [Role.ContentEditor]: 'Editor de contenido',
};

export function roleLabel(role: Role | string | null | undefined): string {
  if (role && role in ROLE_LABELS) {
    return ROLE_LABELS[role as Role];
  }
  return 'Profesor';
}
