import { Role } from "@exams-generator/shared";
import { canManageQuestionTenant } from "./can-manage-question-tenant";

describe("canManageQuestionTenant", () => {
  it.each([Role.PlatformAdmin, Role.ContentEditor])(
    "allows %s to manage central questions (targetTenantId=null)",
    (role) => {
      expect(canManageQuestionTenant(role, null)).toBe(true);
    },
  );

  it.each([Role.SchoolAdmin, Role.Teacher])(
    "denies %s from managing central questions (targetTenantId=null)",
    (role) => {
      expect(canManageQuestionTenant(role, null)).toBe(false);
    },
  );

  it.each([Role.SchoolAdmin, Role.Teacher])(
    "allows %s to manage a tenant's private questions",
    (role) => {
      expect(canManageQuestionTenant(role, "tenant-1")).toBe(true);
    },
  );

  it.each([Role.PlatformAdmin, Role.ContentEditor])(
    "denies %s from managing a tenant's private questions",
    (role) => {
      expect(canManageQuestionTenant(role, "tenant-1")).toBe(false);
    },
  );
});
