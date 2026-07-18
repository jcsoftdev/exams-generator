/**
 * Resolves `DATABASE_URL` for local dev/test contexts where a shell
 * profile hasn't exported it (e.g. running `pnpm test` directly against
 * the docker-compose Postgres without sourcing the root `.env`). Falls
 * back to the exact docker-compose default documented in
 * `infra/env.example`. Production deploys (Dokploy, `infra/docker-compose.yml`
 * `api` service) always set `DATABASE_URL` explicitly, so the fallback
 * never applies there.
 */
export function resolveDatabaseUrl(): string {
  return process.env.DATABASE_URL ?? "postgres://exams:exams@localhost:5439/exams_generator";
}
