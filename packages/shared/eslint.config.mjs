// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    // Only lint TypeScript source. Ignore build output and any stray compiled
    // artifacts (a misfired `tsc` can emit .js/.d.ts next to source; those are
    // never linted).
    ignores: ["dist/**", "node_modules/**", "**/*.js", "**/*.mjs", "**/*.cjs", "**/*.d.ts", "**/*.map"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
);
