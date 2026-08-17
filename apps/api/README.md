# API

NestJS REST API for GeneraExamen. Owns every business rule and the database:
auth, tenants, question bank, AI-assisted question generation, exam
building/versioning, Typst→PDF rendering, MinIO asset storage. Part of the
`exams-generator` monorepo.

For workspace-wide install/setup (Node/pnpm versions, `.env`, starting infra,
`pnpm dev`), see the [root README](../../README.md). This file only covers
what's specific to `apps/api`.

## Development server

From the repo root (starts postgres, minio, redis — required before the api
can boot cleanly):

```bash
pnpm dev:infra
```

Then, from `apps/api/` (or `pnpm --filter @exams-generator/api dev` from the
root):

```bash
pnpm dev
```

This runs `PORT=3012 ts-node-dev --respawn --exit-child --transpile-only ... src/main.ts`
against the root `.env` (`apps/api/package.json`), and serves on
`http://localhost:3012`. `OPENROUTER_API_KEY` is resolved lazily (first AI
call, not boot), so the api boots fine without it — only AI endpoints throw
until it's set.

From the repo root, `pnpm dev` (turbo) runs `api` + `web` + `landing`
together, with `web`'s dev proxy already pointed at `:3012`.

## Module layout

`src/app.module.ts` wires one Nest module per bounded context under
`src/modules/*`: `ai`, `assets`, `auth`, `bank`, `dashboard`, `exams`,
`health`, `taxonomy`, `tenants`, `users` — plus a global `ThrottlerGuard`
(100 req/min/IP; disabled under Jest), `AllExceptionsFilter`, and
`nestjs-pino` structured logging.

The modules with real external dependencies to swap — **`ai`, `bank`,
`exams`** — follow Hexagonal Architecture:

- `domain/` — pure functions and validators, plus a `ports/` subfolder of
  interfaces (e.g. `exams/domain/ports/pdf-compiler.port.ts`).
- `adapters/` — concrete implementations (Typst CLI, MinIO/in-memory
  storage, OpenRouter — e.g. `exams/adapters/pdf/typst-cli.adapter.ts`).
- `*.service.ts` — orchestrates domain + ports.

Simpler modules (`health`, `taxonomy`, `users`, `tenants`, `dashboard`)
intentionally skip this ceremony — they have nothing to swap.

## Database: migrations, snapshots, seed

- `src/db/schema/*.schema.ts` — Drizzle table definitions, the source of
  truth for the DB shape.
- `drizzle/*.sql` — committed, numbered migrations (`0000`…`0019` as of this
  writing), each paired with a `drizzle/meta/<n>_snapshot.json`.

```bash
pnpm db:generate   # drizzle-kit generate — diffs schema against the last
                    # committed snapshot, writes a new drizzle/*.sql +
                    # drizzle/meta/*_snapshot.json pair
pnpm db:migrate    # applies every committed migration that hasn't run yet
                    # (src/db/migrate.ts, via drizzle-orm's node-postgres migrator)
pnpm db:seed       # src/db/seed.ts
```

Or, from the repo root: `pnpm db:setup` runs `db:migrate` then `db:seed` in
one shot (`package.json`).

**Warning — hand-written migrations must regenerate the snapshot too.** A
migration written by hand and dropped into `drizzle/*.sql` without its
matching `drizzle/meta/<n>_snapshot.json` silently breaks the migration
chain: the next `db:generate` diffs against a stale snapshot and either
produces a wrong migration or misses real drift. `src/db/migration-snapshot.spec.ts`
exists specifically to catch this — it regenerates migrations from the
*current* schema into a scratch directory and asserts the SQL is
byte-identical to what's committed. It runs as part of the normal `non-e2e`
Jest project, so a drifted/hand-edited migration fails `pnpm test`, not just
`db:generate`.

## Testing

```bash
pnpm test
```

runs three Jest projects in sequence (`apps/api/jest.config.js`,
`apps/api/package.json`), always finishing with the taxonomy purge script
regardless of pass/fail:

| Project    | What                                                                 | Invocation            |
| ---------- | --------------------------------------------------------------------- | ---------------------- |
| `non-e2e`  | Unit specs + repository/seed specs hitting Postgres directly          | parallel workers        |
| `db-serial`| `db/seed-idempotency.spec.ts` only — runs the real `seed()` twice, mutates global taxonomy, can't share workers with anything else | `--runInBand`          |
| `e2e`      | Full HTTP app via supertest, real Postgres, real Typst compiler (AI provider is mocked) | `--runInBand`          |

All three need **Postgres** up (`pnpm dev:infra`). `e2e` additionally boots
the real `AppModule` + BullMQ, so it needs **Redis** up too, and isolates
BullMQ per Jest worker via `BULLMQ_PREFIX` (`src/test-support/`).

**External binaries are optional, by design — specs `describe.skip`
themselves when the dependency is absent, never a false pass:**

- **Typst-dependent** e2e specs (`ai.e2e.spec.ts`, `ai-revise.e2e.spec.ts`,
  `ai-generate-stream.e2e.spec.ts`, `ai-jobs.e2e.spec.ts`,
  `exam-ai-structured-flow.e2e.spec.ts`,
  `exams/adapters/pdf/typst-cli.adapter.golden.spec.ts`) gate on
  `isTypstAvailableSync()`
  (`src/modules/exams/adapters/pdf/test-utils/typst-availability.ts`), which
  synchronously shells out to `typst --version`. Install a pinned local
  binary with `apps/api/scripts/install-typst-dev.sh` (keeps the version in
  sync with `infra/Dockerfile.api`'s `TYPST_VERSION`) to run these for real.
- **MinIO-dependent** specs (`exams/adapters/storage/minio-storage.adapter.spec.ts`)
  gate on `isMinioReachableSync()` the same way — needs the `minio` service
  from `pnpm dev:infra` reachable.

`pnpm test:watch` runs plain `jest --watch` (all projects' default config,
no project selection) for local iteration.

## Building

```bash
pnpm build
```

Runs `tsc -p tsconfig.build.json` and then manually copies
`src/db/data/` (seed JSON + question images) into `dist/db/data/` — `tsc`
alone does not carry non-`.ts` assets, so a custom build step that skips
this copy silently ships an API that can't seed.

## Environment variables

See [`infra/env.example`](../../infra/env.example) for the full list
(Postgres, MinIO, Redis, JWT, OpenRouter/AI model slugs, ports) and
[`infra/dokploy.md`](../../infra/dokploy.md) for what's required per
deployment environment.
