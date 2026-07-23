import { Role } from '@exams-generator/shared';

/**
 * Roles the backend exams controller accepts (`@Roles(Teacher, SchoolAdmin)`
 * in apps/api exams.controller.ts) — single source of truth for both the
 * `/app/exams*` route guards (app.routes.ts) and the "Mis exámenes" nav-item
 * visibility (shell.component.ts) so the two can't silently drift apart.
 */
export const EXAMS_ROLES: readonly Role[] = [Role.Teacher, Role.SchoolAdmin];
