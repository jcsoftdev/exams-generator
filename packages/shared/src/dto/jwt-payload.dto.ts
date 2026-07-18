import { Role } from "../enums/role.enum";

/**
 * Shape encoded into every access token's payload. `tenantId: null` marks
 * platform staff (`platform_admin`, `content_editor`) with global scope —
 * see `users.schema.ts` / `questions.schema.ts` for the same nullable-FK
 * convention at the DB layer. Structurally identical to
 * `auth/token.service.ts`'s `AuthTokenPayload` — kept as a separate shared
 * DTO so the Angular app can import it without depending on the API's
 * internal auth module.
 */
export interface JwtPayload {
  sub: string;
  role: Role;
  tenantId: string | null;
}
