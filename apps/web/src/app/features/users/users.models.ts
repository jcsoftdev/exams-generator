/**
 * Local model shapes for the users module (backend S8, `apps/api/src/modules/users/*`).
 * Consumed only by `features/tenant-settings` (Task 11 — tab "Profesores").
 * Backend `UsersController` is `@Roles(Role.SchoolAdmin)`-only and derives the
 * tenant from the authenticated user (`@CurrentUser()`) — no tenant id in the URL.
 */
export type UserRole = 'teacher' | 'school_admin';

export interface TenantUser {
  readonly id: string;
  readonly email: string;
  readonly role: string;
  readonly active: boolean;
  readonly createdAt: string;
}

export interface CreateUserPayload {
  readonly email: string;
  readonly role: UserRole;
}

export interface CreateUserResult {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly temporaryPassword: string;
}

export interface SetActiveResult {
  readonly id: string;
  readonly active: boolean;
}

export interface ResetPasswordResult {
  readonly id: string;
  readonly temporaryPassword: string;
}
