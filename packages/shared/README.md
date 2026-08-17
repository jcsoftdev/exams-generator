# @exams-generator/shared

Cross-app shared types for the pnpm workspace. Consumed by `apps/api` and
`apps/web` (never `apps/landing` — it has no runtime relationship to the
API). Part of the `exams-generator` monorepo — see the
[root README](../../README.md) for workspace-wide setup.

## ⚠️ Read this before editing an enum or DTO here

This package's `package.json` points `main`/`types` at **`dist/`, not
`src/`**:

```json
"main": "dist/index.js",
"types": "dist/index.d.ts"
```

That means `api` and `web` only ever see this package's **compiled**
output. `pnpm dev` runs `api`/`web` from source via `turbo run dev`, but it
does **not** rebuild this package — only a full `pnpm build` / `turbo build`
does, because `build` depends on `^build` in `turbo.json` (this package
builds first, before its consumers). So editing an enum here and expecting
`pnpm dev` to pick it up immediately is a trap: nothing breaks loudly, the
consumers just keep importing the old `dist/` output until you rebuild.

To pick up a change during local dev, rebuild this package explicitly:

```bash
pnpm --filter @exams-generator/shared build
```

## What lives here

The entire public surface is five barrel `export *` lines in
`src/index.ts` — nothing outside that file is part of the package's
contract:

- `src/enums/role.enum.ts` — `Role` (tenant user roles). Used broadly across
  `api`'s auth guards/decorators and `web`'s `role.guard.ts` /
  `auth.models.ts` — and, because guards gate most controllers, it shows up
  as an import in many otherwise-unrelated modules (`ai`, `bank`, `exams`,
  `dashboard`, `tenants`, `users`, ...). That's role-checking, not those
  modules depending on shared domain logic.
- `src/enums/difficulty.enum.ts` — `Difficulty`, used across question
  generation, bank filters, and exam blueprints on both sides. Genuinely a
  cross-cutting domain concept, not auth-adjacent.
- `src/dto/jwt-payload.dto.ts`, `login-request.dto.ts`,
  `login-response.dto.ts`, `login-exchange.dto.ts` — the JWT payload shape
  and the login/login-exchange HTTP contract, so `api`'s auth module and
  `web`'s `auth.service.ts` / `token.service.ts` can't silently diverge on
  field names.

Despite the generic package name, this is intentionally narrow. Anything
else two apps need to share (e.g. exam/question shapes) is **not**
centralized here today — each app defines its own `*.models.ts` /
interfaces for that.

`apps/web/src/app/shared-package.smoke.spec.ts` and
`apps/api/src/shared/shared-package.smoke.spec.ts` exist specifically to
catch this package failing to resolve/import correctly from each
consumer — a canary for the workspace-link + build-output setup above, not
a test of the DTOs' logic (there is none to test).

## Commands

```bash
pnpm build   # tsc -p tsconfig.build.json — the only thing that produces
             # what api/web actually import
pnpm lint    # eslint .
pnpm test    # no-op: "(no tests configured for shared)" — there is no
             # logic here, only type/shape declarations
```

Zero runtime dependencies. Consumed via the pnpm workspace protocol
(`"@exams-generator/shared": "workspace:*"` in both `apps/api/package.json`
and `apps/web/package.json`) — this package is never published to a
registry.
