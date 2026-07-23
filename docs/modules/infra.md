# Module: infra

## Purpose

Deployment and local-dev infrastructure: Docker images for both apps, the
compose stacks that wire them to their dependencies, env templates, and
Dokploy deployment notes.

## Key Files

- `docker-compose.yml` — local-dev compose: postgres, minio, redis, api, web
  with host port mappings (pg `5439`, minio `9030/9003`, redis `6390`, api
  `3012`, web `8080`). `pnpm dev:infra` / `dev:down` start/stop ONLY the
  three infra services (postgres minio redis) — api/web run from source.
- `docker-compose.dokploy.yml` — Dokploy-targeted single-domain variant:
  same services, no host port mappings (Dokploy routes by domain).
- `Dockerfile.api` / `Dockerfile.web` — app images; build context must be the
  REPO ROOT (they COPY from `apps/*` and `packages/*`, pnpm workspace).
- `nginx/web.conf` — static Angular bundle serving + SPA `try_files` fallback.
- `env.example` — env template (copy to root `.env`; the `.env*` filename is
  intentionally never committed). Documents the OpenRouter model-picking
  rules (free-tier slugs ROTATE — check the curl/jq one-liner in the file).
- `dokploy.md` — Dokploy deployment notes: dependency list (postgres, minio,
  redis), required env vars per environment, port tables, smoke checklist.

## Dependencies

- postgres 17 (`DATABASE_URL`), minio (S3-compatible asset storage), redis 7
  (BullMQ `generation` queue — required at api boot since the AI jobs
  feature; `REDIS_HOST`/`REDIS_PORT`).
- Both compose files pass `AI_MODEL`, `AI_VISION_MODEL`,
  `OPENROUTER_API_KEY` to the api container; `JWT_SECRET` is hard-required
  (`${JWT_SECRET:?}` fails fast).

## Data Flow

Dokploy injects env vars per environment → compose builds api/web images
from repo root → api connects to postgres/minio/redis by service name on the
internal network. Local dev: `pnpm dev:infra` starts infra containers →
`pnpm dev` (turbo) runs api/web from source, reading root `.env` directly
(api reaches redis at `localhost:6390`, the host-mapped port).

## Gotchas

- The api resolves `OPENROUTER_API_KEY` LAZILY (first AI call, not boot) —
  boot succeeds without it; generate/revise/extract then throw a clear error.
- `resolveRedisConnection()` (apps/api/src/modules/ai/generation-jobs.env.ts)
  defaults to `localhost:6390` (host-mapped) so bare local dev outside Docker
  works; inside Docker the compose files always set `redis:6379`.
- E2E tests isolate BullMQ per jest worker via `BULLMQ_PREFIX`
  (`apps/api/src/test-support/`) — without it parallel suites steal each
  other's generation jobs from the shared local Redis.

## Last Updated

2026-07-22 — redis added to dokploy compose + dev:infra scripts; AI env vars
wired to api container in both composes.
