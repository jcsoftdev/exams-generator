import { Role } from "./role.enum";

// These string values are a wire/DB contract (JWT payloads, `users.role`
// column, API request/response bodies) shared verbatim with apps/api and
// apps/web — see jwt-payload.dto.ts and me-response.dto.ts. Pinning every
// member here means an accidental rename breaks the build for whoever
// renamed it, instead of silently drifting into stored data and getting
// caught only once a role check in production stops matching.
describe("Role", () => {
  it("keeps its member set stable", () => {
    expect(Object.keys(Role)).toEqual(["PlatformAdmin", "ContentEditor", "SchoolAdmin", "Teacher"]);
  });

  it.each([
    [Role.PlatformAdmin, "platform_admin"],
    [Role.ContentEditor, "content_editor"],
    [Role.SchoolAdmin, "school_admin"],
    [Role.Teacher, "teacher"],
  ])("%s serializes to %j", (member, value) => {
    expect(member).toBe(value);
  });
});
