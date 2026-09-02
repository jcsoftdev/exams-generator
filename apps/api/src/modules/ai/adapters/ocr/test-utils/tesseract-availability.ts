import { execSync } from "node:child_process";

/**
 * Synchronous, collection-time check for the `tesseract` CLI binary (installed
 * in infra/Dockerfile.api alongside typst). Synchronous on purpose: jest
 * evaluates `describe`/`describe.skip` at collection time, before any
 * `beforeAll` hook runs, so an async check can't gate it. Mirrors
 * `isTypstAvailableSync` in `typst-cli.adapter.golden.spec.ts`.
 *
 * When tesseract isn't installed, callers use this to fall back to
 * `describe.skip` — reported as SKIPPED by jest, never as a false PASS.
 */
export function isTesseractAvailableSync(): boolean {
  try {
    execSync("tesseract --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
