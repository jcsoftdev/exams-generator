import { execSync } from "node:child_process";

/**
 * Synchronous, collection-time check for the `typst` CLI binary (installed
 * in infra/Dockerfile.api — pinned version, see that file). Synchronous on
 * purpose: jest evaluates `describe`/`describe.skip` at collection time,
 * before any `beforeAll` hook runs, so an async check can't gate it.
 *
 * When typst isn't installed (e.g. this sandbox), callers use this to fall
 * back to `describe.skip` — reported as SKIPPED by jest, never as a false
 * PASS.
 */
export function isTypstAvailableSync(): boolean {
  try {
    execSync("typst --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
