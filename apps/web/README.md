# Web

Angular SPA for GeneraExamen — the teacher/admin app (bank browser, AI question
generation, exam builder, exam versions). Part of the `exams-generator`
monorepo.

## Development server

Run from `apps/web/` (or via the root `pnpm --filter @exams-generator/web <script>`):

```bash
pnpm dev
```

This runs `PORT=4201 ng serve --proxy-config proxy.conf.json` (see
`apps/web/package.json`) and serves on `http://localhost:4201/`.

**Do not run a bare `ng serve`** — it starts on port 4200 without
`proxy.conf.json`, and every `/api` call 404s (login included).
`proxy.conf.json` forwards `/api` to the API at `http://localhost:3012`, so
the API needs to be running too. From the repo root, `pnpm dev` starts
api + web + landing together via turbo.

## Building

```bash
pnpm build
```

Compiles the project and stores the build artifacts in `dist/` (via
`ng build`).

## Running unit tests

```bash
pnpm test
```

Runs `ng test`, which executes unit tests with the
[Vitest](https://vitest.dev/) runner (`test` architect target in
`angular.json`).

## Code scaffolding

Angular CLI scaffolding still works normally, e.g.:

```bash
pnpm ng generate component component-name
```

## Additional Resources

For more on the Angular CLI, see the
[Angular CLI Overview and Command Reference](https://angular.dev/tools/cli).
