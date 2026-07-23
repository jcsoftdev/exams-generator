# Dokploy deployment notes

This describes how the two application images in this repo map onto Dokploy.
It documents the current MVP state — not aspirational config. Update it as
`infra/docker-compose.yml` changes.

## Applications

Two Dokploy "application" resources, one per Dockerfile in this directory:

| Dokploy app | Build source | Context | Exposes |
| ----------- | ------------ | ------- | ------- |
| `api`       | `infra/Dockerfile.api` | repo root (`..` relative to `infra/`) | container port `3000` |
| `web`       | `infra/Dockerfile.web` | repo root (`..` relative to `infra/`) | container port `80` |

Both Dockerfiles expect the build context to be the **repo root**, not
`infra/`, because they `COPY` files from `apps/*` and `packages/*` (pnpm
workspace members). If Dokploy's UI asks for a build context path, set it to
the repository root and point "Dockerfile path" at `infra/Dockerfile.api` or
`infra/Dockerfile.web`.

### Compose-based deploy

`infra/docker-compose.dokploy.yml` is the Dokploy-targeted compose file
(single-domain variant of the dev compose). It declares `api` and `web` as
build-from-Dockerfile services plus the `postgres`, `minio`, and `redis`
dependencies, with `depends_on` health/order constraints and no host port
mappings (Dokploy routes by domain). Point Dokploy's Compose provider at this
file and supply the env vars below per environment (Dokploy injects them,
`env.example` is the local-dev template only and is never read at deploy
time).

`infra/docker-compose.yml` remains the local-dev compose — same services, but
with host port mappings for running everything outside Dokploy.

If deploying as two separate Dokploy Applications (not Compose), `postgres`,
`minio`, and `redis` still need to run somewhere reachable by `api` — either
as Dokploy-managed database/service resources or as the compose stack with
only `api`/`web` swapped for Dokploy-managed application resources.

## Dependencies

- **postgres** (`postgres:17.2-bookworm`): required by `api`. Provisioned
  either via the compose stack's `postgres` service or a Dokploy-managed
  Postgres resource. `api` needs `DATABASE_URL` pointing at it.
- **minio** (`minio/minio:latest`, S3-compatible): required by `api` for
  generated-PDF storage (per design). `api` needs `MINIO_ENDPOINT` +
  `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` (or an equivalent managed S3
  bucket's credentials, if MinIO is swapped for a hosted object store later).
- **redis** (`redis:7.4-bookworm`): required by `api` — the AI question
  generation queue (BullMQ `generation` queue) connects at boot and the app
  will not process generation jobs without it. The compose stack provides it;
  if swapped for a managed Redis, set `REDIS_HOST` / `REDIS_PORT` on `api`
  accordingly (container-internal default is `redis:6379`).

## Required environment variables (per environment — set in Dokploy, not committed)

| Var | Used by | Notes |
| --- | ------- | ----- |
| `DATABASE_URL` | api | Full postgres connection string. Must point at the environment's own postgres instance, not the local dev one in `env.example`. |
| `MINIO_ENDPOINT` | api | Hostname of the MinIO/S3 endpoint for this environment. |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` | api, minio | Credentials pair; must match what the MinIO instance was provisioned with. |
| `JWT_SECRET` | api | Required, no default — `docker-compose.dokploy.yml` fails fast (`${JWT_SECRET:?...}`) if unset. Generate a unique per-environment secret, never reuse the local dev value. |
| `REDIS_HOST` / `REDIS_PORT` | api | Redis connection for the BullMQ `generation` queue. Set to `redis` / `6379` by the compose stack; only override when pointing at an external/managed Redis. |
| `AI_MODEL` | api | OpenRouter model id for text AI ops (generate, revise). Required for AI endpoints — resolved lazily, so the app boots without it but the first generate/revise call fails with a clear error if unset. |
| `AI_VISION_MODEL` | api | OpenRouter model id for image extraction (`POST /ai/questions/extract`). Optional — falls back to `AI_MODEL` when unset (only works if that model is vision-capable). |
| `OPENROUTER_API_KEY` | api | OpenRouter API key. Required for all AI endpoints (lazy, same as `AI_MODEL`). Compose passes it through only if set — supply it per environment. |
| `PORT` | api | Container-internal port, defaults to `3000`. Only change if the base image/CMD changes too. |
| `API_PORT` | host mapping | Host-side port mapped to the api container's `3000`, default `3012` (compose only — not meaningful for Dokploy Application resources, which manage their own routing/domains). |
| `WEB_PORT` | host mapping | Host-side port mapped to the web container's `80`, default `8080` (compose only, same caveat as `API_PORT`). |

`DB_USER` / `DB_PASSWORD` / `DB_NAME` / `DB_PORT` and `MINIO_API_PORT` /
`MINIO_CONSOLE_PORT` are only consumed by the `postgres` and `minio` services
in `docker-compose.yml` itself — irrelevant if those are swapped for
Dokploy-managed resources instead of the compose services.

## Port mappings (local dev compose only)

These host port mappings exist only in `infra/docker-compose.yml` (local
dev). `infra/docker-compose.dokploy.yml` declares NO host port mappings —
Dokploy routes by domain to the container-internal ports.

| Service | Container port | Host port (default) | Notes |
| ------- | -------------- | -------------------- | ----- |
| postgres | 5432 | `${DB_PORT:-5439}` | |
| minio | 9000 (API), 9001 (console) | `${MINIO_API_PORT:-9030}`, `${MINIO_CONSOLE_PORT:-9003}` | |
| redis | 6379 | `${REDIS_HOST_PORT:-6390}` | |
| api | 3000 | `${API_PORT:-3012}` | healthcheck: `GET /health` |
| web | 80 | `${WEB_PORT:-8080}` | nginx serving the Angular static bundle, SPA fallback to `index.html` |

If Dokploy manages `api`/`web` as separate Applications with its own reverse
proxy/domain routing, these host port mappings do not apply — only the
container-internal ports (`3000`, `80`) and the env vars above matter.

## Post-deploy smoke check (manual, until CI wires this up)

Not automated yet — this PR only ships the deploy config, not a live smoke
test (that needs a running deployment, which does not exist yet). Once a real
environment is up, verify:

1. `GET {api-base-url}/health` returns `200`. This is also what the compose
   `api` service's own Docker healthcheck already polls internally
   (`infra/docker-compose.yml`, `api.healthcheck`).
2. `GET {web-base-url}/` returns `200` and serves the Angular `index.html`
   (confirms the nginx `web` container built and started correctly).
3. A deep-linked Angular route (e.g. `{web-base-url}/some/client/route`) also
   returns `200` and serves `index.html` — confirms the SPA `try_files`
   fallback in `infra/nginx/web.conf` is active behind Dokploy's proxy too.
4. Once exam/PDF-generation endpoints exist (later PRs): exercise the sample
   PDF-generation path end-to-end (submit an exam request through the API,
   confirm a PDF is produced and retrievable from MinIO) to validate the
   `typst` toolchain baked into `Dockerfile.api` actually works in the deploy
   environment, not just locally.
