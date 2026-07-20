// NOTE: intentionally does NOT `import type { AppEnvironment } from './environment'`.
// Angular's fileReplacements swaps the *path* `src/environments/environment.ts`
// wherever it's imported -- including inside this very file's own import --
// which turns that import into a self-reference once the replacement is
// applied (TS2724: no exported member 'AppEnvironment'). The literal object
// shape is duplicated here instead; `environment.ts` stays the single source
// of truth for the `AppEnvironment` type used by dev code and tests.
export const environment: { production: boolean; apiBaseUrl: string } = {
  production: true,
  apiBaseUrl: '/api',
};
