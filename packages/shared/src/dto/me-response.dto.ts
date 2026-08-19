import { Role } from "../enums/role.enum";

/**
 * Response for `GET /auth/me` — the signed-in user's OWN identity, read
 * from the JWT `sub` server-side (never a client-supplied id). Deliberately
 * excludes `passwordHash` — see `AuthService.me()`, which selects columns
 * explicitly rather than spreading the DB row for exactly this reason.
 */
export interface MeResponseDto {
  id: string;
  name: string | null;
  email: string;
  role: Role;
  tenantId: string | null;
}
