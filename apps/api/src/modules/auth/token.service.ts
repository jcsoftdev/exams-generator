import { Role } from "@exams-generator/shared";
import jwt from "jsonwebtoken";
import { resolveJwtSecret } from "./env";

/**
 * `tenantId: null` = platform staff (`platform_admin`, `content_editor` —
 * global scope, mirrors `users.tenant_id`'s convention). Non-null = scoped
 * to that tenant.
 */
export interface AuthTokenPayload {
  readonly sub: string;
  readonly tenantId: string | null;
  readonly role: Role;
}

export class InvalidTokenError extends Error {
  constructor(message = "Invalid or expired token") {
    super(message);
    this.name = "InvalidTokenError";
  }
}

/**
 * Session length. It is no longer the revocation window: `AccountStatusService`
 * re-checks the account behind every request, so a deactivated or deleted user
 * loses access within `ACCOUNT_STATUS_TTL_MS` (a minute), not whenever this
 * expires (audit 2026-08-20, H3). What this still bounds is a token STOLEN from
 * an account that stays active — nothing re-checks that. 24h was too long a
 * tail for that case; 8h cuts it to same-day without kicking a working teacher
 * hourly. The 401 path redirects cleanly to /login?expired=1 and the
 * exam builder persists in-progress work, so a mid-session expiry is
 * recoverable. Relax only if real revocation (short-TTL active-check cache or a
 * revocation list) lands first — see docs/audit-security-2026-08-18.md.
 */
const TOKEN_TTL = "8h";

/**
 * Minimal JWT issue/verify service — the auth prerequisite for tenant
 * scoping in the bank module. Deliberately does NOT include a login
 * endpoint, password hashing, or refresh tokens: those belong to a full
 * auth module (out of this PR's scope). Callers (tests, and eventually a
 * real login endpoint) sign tokens directly via `sign()`.
 */
export class TokenService {
  constructor(private readonly secret: string = resolveJwtSecret()) {}

  sign(payload: AuthTokenPayload): string {
    return jwt.sign(payload, this.secret, { expiresIn: TOKEN_TTL });
  }

  verify(token: string): AuthTokenPayload {
    let decoded: string | jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, this.secret);
    } catch {
      throw new InvalidTokenError();
    }

    if (typeof decoded !== "object" || decoded === null) {
      throw new InvalidTokenError();
    }

    const { sub, tenantId, role } = decoded as Record<string, unknown>;

    if (typeof sub !== "string" || typeof role !== "string") {
      throw new InvalidTokenError();
    }
    if (tenantId !== null && typeof tenantId !== "string") {
      throw new InvalidTokenError();
    }

    return { sub, tenantId: tenantId ?? null, role: role as Role };
  }
}
