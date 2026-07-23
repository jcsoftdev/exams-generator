import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseComposeApiEnvironmentKeys } from "./parse-compose-api-environment";

/**
 * Regression guard for the "Redis/OPENROUTER_API_KEY forwarded in dev
 * compose but silently missing from the Dokploy compose" class of bug: the
 * `api` service's `environment:` keys must be the SAME set in both compose
 * files. A key added to one and forgotten in the other should fail this
 * test locally instead of surfacing as a deploy-only "works on my machine"
 * failure days later.
 */
describe("docker-compose api environment parity", () => {
  it("has the exact same api environment keys in docker-compose.yml and docker-compose.dokploy.yml", () => {
    const infraDir = resolve(__dirname, "../../../../infra");
    const devKeys = parseComposeApiEnvironmentKeys(readFileSync(resolve(infraDir, "docker-compose.yml"), "utf-8"));
    const dokployKeys = parseComposeApiEnvironmentKeys(
      readFileSync(resolve(infraDir, "docker-compose.dokploy.yml"), "utf-8"),
    );

    expect(devKeys.length).toBeGreaterThan(0);
    expect([...dokployKeys].sort()).toEqual([...devKeys].sort());
  });
});
