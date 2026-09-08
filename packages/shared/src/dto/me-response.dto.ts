import { Role } from "../enums/role.enum";
import { FeatureFlagsDto } from "./feature-flag.dto";

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
  /**
   * Effective feature flags for this user, resolved server-side from the
   * platform kill switch AND (for a user with a tenant) that tenant's
   * overrides. Booleans only — the platform/tenant split stays in the
   * superadmin's screens. Carried here rather than in the JWT because a
   * token does not refresh when a switch moves.
   */
  features: FeatureFlagsDto;
}
