/**
 * Local model shapes for the users module (backend S8, `apps/api/src/modules/users/*`).
 * Consumed only by `features/tenant-settings` (Task 11 — tab "Profesores").
 * Backend `UsersController` is `@Roles(Role.SchoolAdmin)`-only and derives the
 * tenant from the authenticated user (`@CurrentUser()`) — no tenant id in the URL.
 *
 * The wire shapes come from `@exams-generator/shared`, which the API compiles
 * against too — re-exported here so this feature keeps its own local
 * imports. `TenantUser.role` used to be typed as a bare `string` here (and
 * independently on the API side), and `UserRole` was a hand-rolled
 * `'teacher' | 'school_admin'` union instead of reusing `Role` — both fixed
 * as part of moving this contract to `@exams-generator/shared`
 * (audit 2026-08-21, M4b; see `user.dto.ts` for the full rationale, including
 * why `temporaryPassword` is NOT on `TenantUser`).
 */
export type {
  CreatableUserRole as UserRole,
  CreateUserPayload,
  CreateUserResult,
  PagedTenantUsers,
  ResetPasswordResult,
  SetActiveResult,
  TenantUser,
} from '@exams-generator/shared';
