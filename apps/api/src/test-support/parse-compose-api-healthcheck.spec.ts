import { parseComposeApiHealthcheck } from "./parse-compose-api-healthcheck";

describe("parseComposeApiHealthcheck", () => {
  const compose = (healthcheck: string) => `services:
  api:
    command: ["sh", "-c", "node dist/db/migrate.js && node dist/db/seed.js && node dist/main.js"]
    healthcheck:
${healthcheck}

  web:
    image: nginx
`;

  it("reads the three numbers that decide when a container is called unhealthy", () => {
    expect(
      parseComposeApiHealthcheck(
        compose(["      interval: 10s", "      timeout: 5s", "      retries: 10", "      start_period: 600s"].join("\n")),
      ),
    ).toEqual({ intervalSeconds: 10, retries: 10, startPeriodSeconds: 600 });
  });

  it("reads a grace period written in minutes", () => {
    expect(
      parseComposeApiHealthcheck(
        compose(["      interval: 10s", "      retries: 10", "      start_period: 10m"].join("\n")),
      )?.startPeriodSeconds,
    ).toBe(600);
  });

  /** Docker's own default when the key is absent is no grace period at all. */
  it("reports no grace period when start_period is missing", () => {
    expect(
      parseComposeApiHealthcheck(compose(["      interval: 10s", "      retries: 10"].join("\n")))
        ?.startPeriodSeconds,
    ).toBe(0);
  });

  it("returns nothing for a compose file with no api healthcheck", () => {
    expect(parseComposeApiHealthcheck("services:\n  web:\n    image: nginx\n")).toBeUndefined();
  });
});
