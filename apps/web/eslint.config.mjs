// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import angular from "angular-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", ".angular/**", "coverage/**"],
  },
  {
    files: ["**/*.ts"],
    extends: [eslint.configs.recommended, ...tseslint.configs.recommended, ...angular.configs.tsRecommended],
    processor: angular.processInlineTemplates,
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      "@angular-eslint/directive-selector": ["error", { type: "attribute", prefix: "app", style: "camelCase" }],
      "@angular-eslint/component-selector": ["error", { type: "element", prefix: "app", style: "kebab-case" }],
      // Pragmatic relaxation: this is a young codebase; `any` shows up mostly in
      // HTTP response typing and test doubles. Downgraded to warning instead of
      // rewriting API response types across every feature module.
      "@typescript-eslint/no-explicit-any": "warn",
      // Repo convention: catch-block error params and intentionally-discarded
      // destructured values are prefixed with `_` (e.g. `catch (_error)`).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Design-system primitives live under `app/ui/` and are prefixed `ui-`
    // (`ui-button`, `ui-modal`, `ui-table`, …) to mark them as generic,
    // feature-agnostic building blocks; feature components keep `app-`.
    // The split is exact today: every `ui-*` selector is inside this folder and
    // every component outside it uses `app-`. Scoping the override to this path
    // (instead of adding "ui" to the global prefix list) keeps that true — a
    // feature component still cannot claim a `ui-` selector.
    files: ["src/app/ui/**/*.ts"],
    rules: {
      "@angular-eslint/component-selector": ["error", { type: "element", prefix: "ui", style: "kebab-case" }],
    },
  },
  {
    // Test files use Vitest globals (describe/it/expect/vi) injected by the
    // Angular CLI's unit-test builder, not imported explicitly.
    files: ["**/*.spec.ts"],
    languageOptions: {
      globals: {
        ...globals.vitest,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  {
    files: ["**/*.html"],
    extends: [...angular.configs.templateRecommended, ...angular.configs.templateAccessibility],
    rules: {},
  },
);
