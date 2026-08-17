# Module: apps

## Purpose

The three deployable applications — this directory IS the product. `api`
(NestJS) owns every business rule and the database; `web` (Angular) is the
authenticated app teachers/admins use to build the question bank and exams;
`landing` (Astro) is the public marketing site that funnels visitors to
`web`'s login. No other module in this repo ships product behavior —
`packages/shared` only holds the tiny cross-cutting contracts these three
apps agree on.

## Key Files

- `apps/api/src/app.module.ts` — root NestJS module; wires
  `HealthModule`, `AuthModule`, `BankModule`, `TenantsModule`, `ExamsModule`,
  `AiModule`, `TaxonomyModule`, `AssetsModule`, `UsersModule`,
  `DashboardModule`, plus global `ThrottlerGuard` (100 req/min/IP, login has
  its own tighter `@Throttle()`), `AllExceptionsFilter`, and
  `nestjs-pino` structured JSON logging with per-request correlation ids.
- `apps/api/src/modules/*` — one folder per bounded context
  (ai, assets, auth, bank, dashboard, exams, health, taxonomy, tenants,
  users). The non-trivial ones (`ai`, `bank`, `exams`) follow **Hexagonal
  Architecture**: a `domain/` folder with pure functions and validators plus
  a `ports/` subfolder of interfaces, an `adapters/` folder with the
  concrete implementations (Typst CLI, MinIO/in-memory storage, OpenRouter),
  and a `*.service.ts` that orchestrates domain + ports. Example:
  `exams/domain/ports/pdf-compiler.port.ts` is implemented by
  `exams/adapters/pdf/typst-cli.adapter.ts`.
- `apps/api/src/db/schema/*.schema.ts` — Drizzle table definitions (source
  of truth for the DB shape); `apps/api/drizzle/*.sql` — generated,
  numbered migrations (`0000`…`0018` as of this writing), applied via
  `pnpm db:migrate`.
- `apps/api/src/db/data/*.json` — seed data: canonical taxonomy plus 100+
  web-sourced question banks (`escolar-*`, `preuni-*`) with matching
  `*-images`/`*-figures` sibling folders for the complement PNGs. Governed
  by `docs/question-collection-pipeline.md`. Seeded on deploy boot per
  commit `913110a`.
- `apps/api/src/main.ts` — process entrypoint (Nest bootstrap, global
  pipes/CORS/prefix — read directly for exact boot behavior, not
  restated here to avoid drift).
- `apps/web/src/app/core/*` — cross-cutting Angular singletons: `auth/`
  (JWT interceptor + guard + role guard), `tenant/` (tenant lookup by
  subdomain), `theme/` (light/dark).
- `apps/web/src/app/features/*` — one folder per screen area (ai, bank,
  exams, exam-versions, dashboard, taxonomy, tenant-settings, users,
  admin-tenants, login, shell, forbidden, not-found). Each typically pairs
  a container component with a `*.service.ts` HTTP client and its own
  `*.models.ts`.
- `apps/web/src/app/ui/*` — the shared presentational component library
  (button, card, modal, table, tabs, charts, etc.) — container/presentational
  split per this repo's stated architecture convention.
- `apps/landing/src/pages/*.astro` — statically-built marketing pages
  (`index`, `login`, `privacidad`, `terminos`, `404`); `src/data/bank.ts`
  feeds the landing page's sample-questions showcase.
- `apps/{api,web,landing}/package.json` — each app owns its own
  scripts/deps; there is no root-level dev script beyond `turbo run <task>`
  fanning out to these.

## Dependencies

- `api` depends on `packages/shared` (workspace) for the DTOs/enums
  shared with `web`; on Postgres (Drizzle), MinIO (asset/PDF storage), Redis
  (BullMQ queues `generation` and `exam-versions`), OpenRouter (AI), and
  the Typst CLI binary (PDF compilation — see `apps/api/scripts/install-typst-dev.sh`).
- `web` depends on `packages/shared` for the same DTOs/enums and talks to
  `api` only over HTTP (`proxy.conf.json` in dev; same-origin/reverse-proxy
  in prod per `infra/nginx/web.conf`).
- `landing` has NO runtime dependency on `api` or `web` — it is a fully
  static Astro build; its only "integration" is linking to `web`'s
  `/login` route.
- Build/test orchestration for all three goes through Turborepo
  (`turbo.json`: `build` depends on `^build` i.e. `packages/shared` builds
  first; `dev` is uncached/persistent; `test`/`lint` are plain fan-outs).

## Data Flow

Teacher/admin browser → `web` (Angular SPA) → HTTP → `api` (NestJS) →
Postgres (via Drizzle) for all persisted state; `api` also talks to MinIO
(question images, generated PDFs), Redis/BullMQ (async AI generation jobs
and async exam-version PDF compilation jobs, both with SSE progress
endpoints the frontend subscribes to), and OpenRouter (LLM calls for
question generation/extraction/revision, always behind a port so the
adapter is swappable). `landing` is a separate, unrelated request path:
static HTML/CSS served directly, no backend calls, ending at a link into
`web`.

## Gotchas

- **Hexagonal is enforced unevenly on purpose.** `ai`, `bank`, `exams` have
  full `domain/ports/adapters` separation because they have real external
  dependencies to swap (AI provider, storage, PDF compiler). Simpler modules
  (`health`, `taxonomy`, `users`, `tenants`, `dashboard`) skip the ceremony —
  don't "fix" them to match; that would be over-engineering for modules with
  nothing to swap.
- **`ThrottlerGuard` is globally applied but disabled under Jest**
  (`skipIf: () => process.env.NODE_ENV === "test"`) — e2e specs share one
  IP/process across many logins; without the skip, 429s from the throttler
  masquerade as unrelated 401s deep into a spec run.
- **`api`'s build step manually copies seed JSON/images into `dist/`**
  (`"build": "tsc ... && mkdir -p dist/db/data && cp -R src/db/data/. dist/db/data/"`)
  — `tsc` alone does not carry non-`.ts` assets; forgetting this step (e.g.
  a custom build script) silently ships an API that can't seed.
- **`api`'s test script always runs the taxonomy purge**, even on failure
  (`jest ...; status=$?; pnpm db:purge-test-taxonomy; exit $status`) — test
  runs leave taxonomy rows behind that must be cleaned regardless of pass/fail.
- Question-generation retry semantics are NOT symmetric between the AI call
  and the PDF compile step inside the same service
  (`apps/api/src/modules/ai/generate-questions.service.ts`): a Typst compile
  failure retries (cheap, deterministic-ish); an invalid AI JSON response
  does NOT retry (re-prompting burns budget for the same odds) — see
  `docs/superpowers/specs/2026-07-17-exams-generator-design.md` §7.

## Last Updated

2026-08-14 — filled from stub; verified against `apps/api/src/app.module.ts`,
module directory listings, `apps/{api,web,landing}/package.json` scripts, and
`turbo.json`/`pnpm-workspace.yaml`.
