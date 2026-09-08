import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseComposeApiHealthcheck } from "./parse-compose-api-healthcheck";

/**
 * Regression guard for a deploy that failed while production was fine.
 *
 * In the Dokploy compose the api runs `migrate && seed && main`, so it does not
 * answer `/health` until the boot seed finishes — and that seed grows with every
 * lot the question bank gains. On 2026-09-07 it finally ran past the healthcheck
 * window: compose called the container unhealthy, failed the deploy and reported
 * an error, while the container went on to finish the seed and serve normally.
 *
 * The damage is not cosmetic. `web` waits on `api: service_healthy`, so on a
 * stack brought up from nothing the frontend never starts at all, and every
 * later deploy reports a failure nobody can act on.
 *
 * A container is called unhealthy `start_period + interval × retries` after it
 * starts, because failures inside the grace period count for nothing. That
 * total is what has to cover a full seed, so it is what this test measures.
 */
describe("docker-compose api boot grace", () => {
  /**
   * Twenty minutes. The seed that broke the deploy took under four, so this is
   * five times the worst run observed rather than a number tuned to just pass.
   * It costs nothing when the seed is quick: the healthcheck still turns the
   * container healthy the moment `/health` answers, and the grace period only
   * decides how long a silent api is given before compose gives up on it.
   */
  const REQUIRED_GRACE_SECONDS = 20 * 60;

  it.each(["docker-compose.dokploy.yml", "docker-compose.yml"])(
    "gives the boot seed room to finish in %s",
    (file) => {
      const yaml = readFileSync(resolve(__dirname, "../../../../infra", file), "utf-8");
      const healthcheck = parseComposeApiHealthcheck(yaml);

      expect(healthcheck).toBeDefined();
      const grace =
        healthcheck!.startPeriodSeconds + healthcheck!.intervalSeconds * healthcheck!.retries;
      expect(grace).toBeGreaterThanOrEqual(REQUIRED_GRACE_SECONDS);
    },
  );
});
