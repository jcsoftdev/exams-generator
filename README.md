# Exams Generator (GeneraExamen)

Multi-tenant web platform for schools and academies to generate
admission-style exams (PDF) from a shared central question bank plus each
school's own private questions. Supports multiple shuffled versions
(Forma A/B/C, ...), each with its own answer key, and AI-assisted question
generation.

The question bank is the platform operator's core asset: schools (tenants)
consume the shared bank, add their own private questions, and generate
branded exams with their own logo.

Full design (data model, roles, flows) lives in
`docs/superpowers/specs/2026-07-17-exams-generator-design.md`.

## Workspaces

pnpm monorepo (Turborepo), Node >= 22.13.

| Workspace         | Stack      | What it does                                                                                                                                           |
| ----------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api`        | NestJS     | REST API, hexagonal architecture — auth, tenants, question bank, AI question generation, exam building/versioning, Typst→PDF rendering, MinIO storage. |
| `apps/web`        | Angular 22 | Teacher/admin SPA — bank browser, AI question generation, exam builder, exam versions.                                                                 |
| `apps/landing`    | Astro 7    | Public marketing site (static).                                                                                                                        |
| `packages/shared` | TypeScript | Shared types/DTOs/contracts consumed by `apps/api` and `apps/web`.                                                                                     |

## Prerequisites

- Node >= 22.13
- pnpm 11.9 (pinned via `packageManager` in `package.json`)
- Docker, for local Postgres/MinIO/Redis (`infra/docker-compose.yml`)
- An OpenRouter API key for AI features — optional to boot; it's resolved
  lazily and only required the first time you hit an AI endpoint.

## Getting started

```bash
pnpm install

# 1. Env — copy the template to a root-level .env (never committed)
cp infra/env.example .env

# 2. Start local infra: postgres, minio, redis
pnpm dev:infra

# 3. Run migrations + seed the database
pnpm db:setup

# 4. Run everything — api on :3012, web on :4201 (proxied to the api), and
#    the landing dev server on :4322
pnpm dev
```

Then open `http://localhost:4201` and log in with the seeded demo account:

- email: `admin@colegio-demo.test`
- password: `demo-password-123`

(`school_admin` role for the seeded "Colegio Demo" tenant — see
`DEMO_ADMIN` / `DEMO_ADMIN_PASSWORD` in `apps/api/src/db/seed.ts`.)

## Other useful root scripts

| Script          | What it does                             |
| --------------- | ---------------------------------------- |
| `pnpm test`     | Run every workspace's test suite (turbo) |
| `pnpm lint`     | Lint every workspace (turbo)             |
| `pnpm dev:down` | Stop the local infra containers          |
| `pnpm build`    | Build every workspace (turbo)            |

## Deployment

See `infra/dokploy.md` for the Dokploy deployment notes — required env vars
per environment, port mapping, and the post-deploy smoke checklist.
