/**
 * Values that MUST NEVER sign a production token. The literal default below is
 * published — it's in `infra/env.example` and in this repo's history — so an
 * API booted with it issues tokens anyone can forge. Verified 2026-08-18:
 * minting a `platform_admin` token with this exact string and getting 200 on
 * `GET /tenants`. Extend the list, don't remove from it.
 */
export const WEAK_JWT_SECRETS: readonly string[] = [
  "change-me-in-every-environment",
  "changeme",
  "secret",
  "",
];

/** Below this, "a secret" is a guessable string. 32 chars is the usual floor for an HS256 key. */
const MIN_PRODUCTION_SECRET_LENGTH = 32;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Resolves `JWT_SECRET`.
 *
 * Dev/test keep the documented `infra/env.example` fallback: thousands of
 * specs sign tokens and the local compose has no secret of its own. But that
 * default is public, so in PRODUCTION a weak/absent secret is not a fallback —
 * it is a refusal to boot. This turns "someone forgot to set JWT_SECRET" from
 * a silent auth bypass into a crash on the first request the process can't
 * serve, which is the failure you want.
 *
 * Belt-and-suspenders with `infra/docker-compose.yml`'s
 * `${JWT_SECRET:?...}` guard: that protects the compose path only; this
 * protects every way the process can start (a stray `node dist/main`, a cron,
 * a half-copied `.env`).
 */
export function resolveJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!isProduction()) {
    return secret ?? "change-me-in-every-environment";
  }

  if (!secret || WEAK_JWT_SECRETS.includes(secret) || secret.length < MIN_PRODUCTION_SECRET_LENGTH) {
    throw new Error(
      "JWT_SECRET is missing, a known weak default, or shorter than " +
        `${MIN_PRODUCTION_SECRET_LENGTH} characters. Refusing to start in production with a forgeable token secret.`,
    );
  }

  return secret;
}
