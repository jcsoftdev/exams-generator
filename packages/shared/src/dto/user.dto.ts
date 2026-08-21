import { Role } from "../enums/role.enum";

/**
 * Roles a `school_admin` may assign when creating a tenant user via
 * `POST /users` — enforced in
 * `apps/api/src/modules/users/users.service.ts#create`
 * (`role !== Role.Teacher && role !== Role.SchoolAdmin` → 400 `BadRequestException`).
 * A strict SUBSET of `Role`: `platform_admin`/`content_editor` are platform
 * staff, never created through this form (seeded directly — `db/seed.ts`).
 *
 * Declared here rather than twice — it was a hand-rolled
 * `'teacher' | 'school_admin'` union, `UserRole`, in the web's
 * `users.models.ts`, plus the identical inline literal union on the API
 * controller's `@Body()` parameter (`users.controller.ts`) — neither side
 * reused `Role`, which is already this package's single source of truth for
 * every role value (audit 2026-08-21, M4b).
 */
export const CREATABLE_USER_ROLES = [Role.Teacher, Role.SchoolAdmin] as const;

export type CreatableUserRole = (typeof CREATABLE_USER_ROLES)[number];

/**
 * One row of `GET /users` (S8) — a user scoped to the caller's own tenant.
 *
 * `role` was typed as a bare `string` on both sides — `TenantUser` in the
 * web's `users.models.ts` AND the API's OWN `UsersRepository`'s `TenantUser`
 * (`users.repository.ts`, a second, independent declaration on the API side
 * itself) — so nothing stopped either copy from drifting away from the
 * actual `role` Postgres enum (`roleEnum` in `db/schema/enums.ts`, itself
 * derived from this package's `Role`) (audit 2026-08-21, M4b, same class of
 * defect as `ExamListItem.status` in `exam.dto.ts`).
 *
 * Typed as the FULL `Role` here, not the narrower `CreatableUserRole`: the
 * `users` table stores every role — `platform_admin` included (`db/seed.ts`)
 * — and `UsersRepository#listByTenant` does not filter by role. Narrowing
 * this to the creatable subset would make a tenant with a stray
 * non-teacher/school_admin row silently lie about its own users list.
 */
export interface TenantUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
  readonly role: Role;
  readonly active: boolean;
  readonly createdAt: string;
}

/** `GET /users` (S8) response — paginated (audit P1). */
export interface PagedTenantUsers {
  readonly items: readonly TenantUser[];
  readonly total: number;
}

/** `POST /users` request body. */
export interface CreateUserPayload {
  readonly email: string;
  readonly name: string;
  readonly role: CreatableUserRole;
}

/**
 * `POST /users` (201) response. `temporaryPassword` is a ONE-TIME secret,
 * generated server-side and shown to the admin exactly once — only its hash
 * is ever stored, so it cannot be re-derived or re-fetched.
 *
 * It exists on THIS response and on `ResetPasswordResult` ONLY. It is
 * deliberately absent from `TenantUser` — which is what `GET /users` returns
 * for the very same row on every later read — rather than modelled as an
 * optional field on one shared "user" response type: "sometimes present"
 * would compile whether a future response leaked it or a client silently
 * ignored it (audit 2026-08-21, M4b).
 */
export interface CreateUserResult {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly role: CreatableUserRole;
  readonly temporaryPassword: string;
}

/** `PATCH /users/:id` (`{ active }`) response. */
export interface SetActiveResult {
  readonly id: string;
  readonly active: boolean;
}

/** `POST /users/:id/reset-password` response — see `CreateUserResult` doc re: `temporaryPassword`. */
export interface ResetPasswordResult {
  readonly id: string;
  readonly temporaryPassword: string;
}
