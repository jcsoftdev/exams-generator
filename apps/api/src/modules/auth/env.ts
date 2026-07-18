/**
 * Resolves `JWT_SECRET` the same way `db/env.ts` resolves `DATABASE_URL`:
 * local dev/test contexts that haven't sourced the root `.env` fall back to
 * the exact default documented in `infra/env.example`. Production deploys
 * (Dokploy, `infra/docker-compose.yml` `api` service) require `JWT_SECRET`
 * explicitly (`${JWT_SECRET:?JWT_SECRET must be set}`), so the fallback
 * never applies there.
 */
export function resolveJwtSecret(): string {
  return process.env.JWT_SECRET ?? "change-me-in-every-environment";
}
