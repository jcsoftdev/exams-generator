import { Role } from "@exams-generator/shared";

const STAFF_ROLES: readonly Role[] = [Role.PlatformAdmin, Role.ContentEditor];
const TENANT_ROLES: readonly Role[] = [Role.SchoolAdmin, Role.Teacher];

/**
 * Central-vs-tenant authorization rule (design doc §2): the CENTRAL bank
 * (`tenantId === null`) is managed ONLY by platform staff (`platform_admin`,
 * `content_editor`); a tenant's PRIVATE questions (`tenantId` set) are
 * managed ONLY by that school's own staff (`school_admin`, `teacher`).
 *
 * This is data-dependent (it looks at the TARGET question's tenantId, or
 * for creation, the requester's own tenantId being written to the new
 * row) — it can't be expressed as a static `@Roles(...)` guard, since the
 * guard has no visibility into which row is being touched. It is enforced
 * here, in the domain, and called from `BankService` per request.
 */
export function canManageQuestionTenant(role: Role, targetTenantId: string | null): boolean {
  const allowedRoles = targetTenantId === null ? STAFF_ROLES : TENANT_ROLES;
  return allowedRoles.includes(role);
}
