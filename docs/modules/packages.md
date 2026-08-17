# Module: packages

## Purpose

Cross-app shared code for the pnpm workspace. Today this is a single
package, `@exams-generator/shared`, whose job is to keep `apps/api` and
`apps/web` from redefining the same cross-cutting domain enums and the
login/JWT contract twice and drifting apart. It is deliberately tiny in
*surface* — nine exports total — but it is NOT narrow in *reach*: 152 files
across both apps import it (115 in `api`, 37 in `web`). It is still NOT a
general utility library; `apps/landing` does not consume it at all (the
landing site has no runtime relationship to the API).

## Key Files

- `packages/shared/src/index.ts` — the entire public surface, as six barrel
  `export *` lines (2 enums + 4 DTO files, nine exported names). There is no
  other export path; anything not re-exported here is not part of the
  package's contract.
- `packages/shared/src/enums/role.enum.ts` — the `Role` enum (tenant user
  roles) shared by `api`'s auth/guards and `web`'s `role.guard.ts` /
  `auth.models.ts`.
- `packages/shared/src/enums/difficulty.enum.ts` — the `Difficulty` enum
  used across question generation, bank filters, and exam blueprints on
  both sides.
- `packages/shared/src/dto/jwt-payload.dto.ts`,
  `login-request.dto.ts`, `login-response.dto.ts`, `login-exchange.dto.ts`
  — the shapes of the JWT payload and the login/login-exchange HTTP
  contract, so `api`'s auth module and `web`'s `auth.service.ts` /
  `token.service.ts` can't silently diverge on field names.
- `packages/shared/package.json` — `main`/`types` point at `dist/`
  (built output, not `src/`), so **`api`/`web` only see this package
  correctly after `pnpm --filter @exams-generator/shared build`** (or a
  full `pnpm build` / `turbo build`, which builds it first per the
  `dependsOn: ["^build"]` rule). No tests are configured
  (`"test": "echo ... && exit 0"`) — there's no logic here to test, only
  type/shape declarations.

## Dependencies

- Zero runtime dependencies — pure TypeScript types/enums/DTOs, compiled
  with `tsc` (`tsconfig.build.json`). Dev-only deps are ESLint tooling.
- Consumed via the pnpm workspace protocol (`"@exams-generator/shared":
  "workspace:*"` in both `apps/api/package.json` and
  `apps/web/package.json`) — never published to a registry.

## Data Flow

Not a runtime data-flow participant — it ships no server, no client, no
side effects. Its "flow" is purely at build/type-check time: `packages/shared`
builds first (Turborepo dependency graph) → both `api` and `web` import its
compiled `dist/` output → TypeScript enforces that both sides agree on
`Role`, `Difficulty`, and the login DTO shapes at compile time, so a
mismatch (e.g. `api` renaming a JWT payload field) breaks the `web` build
instead of failing silently at runtime.

## Gotchas

- **Edits here don't show up in `web`/`api` dev servers until rebuilt** —
  since consumers import compiled `dist/`, not `src/`, changing an enum and
  expecting `pnpm dev` (which runs `api`/`web` from source but this package
  from its build output) to pick it up immediately is a common trap; rerun
  the shared package's build first.
- **Verified**: `apps/web/src/app/shared-package.smoke.spec.ts` exists
  specifically to catch the package failing to resolve/import correctly
  from the web side — a canary for the workspace-link + build-output setup
  above, not a test of the DTOs' logic (there is none).
- **Its reach is much wider than its size suggests — do not treat it as an
  "auth package".** Measured usage across `apps/` (2026-08-15):
  `Difficulty` 96 files, `Role` 83, `JwtPayload` 4, the login/exchange DTOs
  1-2 each. Of the 115 importing files in `api`, only 13 are in the `auth`
  module — the rest are `exams` (31), `ai` (26), `bank` (18), `users` (4),
  `dashboard` (3), `tenants` (2), `taxonomy` (1), plus scripts and db. Same
  story in `web`: `exams` (10), `bank` (8), `ai` (5), `dashboard` (4).
  The reason is sound, not accidental sprawl: `Role` feeds the `@Roles`
  guards on nearly every controller, and `Difficulty` is a transversal
  domain concept (question generation, bank filters, exam blueprints) —
  neither belongs to auth. **Changing either enum is a wide blast radius.**
- Anything else two apps need to share (e.g. exam/question shapes) is NOT
  centralized here — each app defines its own `*.models.ts`/interfaces for
  that. That part of the original narrow-scope claim still holds.

## Last Updated

2026-08-15 — corrected the "only auth-adjacent files import it" claim, which
was wrong the day it was written (audit `docs/audit-2026-08-14.md`, hallazgo
P2). Importer counts re-measured per app, per module and per exported symbol
with `rg`, not estimated.

2026-08-14 — filled from stub; verified against
`packages/shared/src/index.ts`, `packages/shared/package.json`, and
grep of `@exams-generator/shared` importers in `apps/api` and `apps/web`.
