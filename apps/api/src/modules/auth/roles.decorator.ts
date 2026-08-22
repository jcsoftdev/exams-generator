import { Role } from "@exams-generator/shared";
import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "roles";

/** Marks a route/controller as restricted to the given roles. Read by `RolesGuard`. */
export const Roles = (...roles: Role[]): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
