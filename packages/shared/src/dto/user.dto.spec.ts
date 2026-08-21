import { Role } from "../enums/role.enum";
import { CREATABLE_USER_ROLES } from "./user.dto";

describe("CREATABLE_USER_ROLES", () => {
  it("pins the two roles a school_admin may assign via POST /users", () => {
    // users.service.ts#create validates against this exact list; a role
    // added here without updating that check (or vice versa) is the kind of
    // drift this guards against.
    expect([...CREATABLE_USER_ROLES]).toEqual([Role.Teacher, Role.SchoolAdmin]);
  });
});
