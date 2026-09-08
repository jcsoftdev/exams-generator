/** The three numbers that decide when Docker calls a container unhealthy. */
export interface ComposeApiHealthcheck {
  readonly intervalSeconds: number;
  readonly retries: number;
  /** Failures inside this window count for nothing. Absent means no grace. */
  readonly startPeriodSeconds: number;
}

const DURATION = /^(\d+)(s|m|h)?$/;

function toSeconds(raw: string): number {
  const match = DURATION.exec(raw.trim());
  if (!match) return 0;
  const value = Number(match[1]);
  return match[2] === "h" ? value * 3600 : match[2] === "m" ? value * 60 : value;
}

/**
 * Minimal line-scanner for the `services.api.healthcheck` block of one of this
 * project's docker-compose files — NOT a general YAML parser, the same deal as
 * `parseComposeApiEnvironmentKeys` beside it.
 *
 * Exists so a test can assert the api gets long enough to run its boot seed
 * before compose declares it dead. Returns `undefined` when there is no api
 * healthcheck at all, which is itself a thing worth failing on.
 */
export function parseComposeApiHealthcheck(composeYaml: string): ComposeApiHealthcheck | undefined {
  const lines = composeYaml.split("\n");
  const apiServiceIndex = lines.findIndex((line) => /^ {2}api:\s*$/.test(line));
  if (apiServiceIndex === -1) return undefined;

  const healthcheckIndex = lines.findIndex(
    (line, i) => i > apiServiceIndex && /^ {4}healthcheck:\s*$/.test(line),
  );
  if (healthcheckIndex === -1) return undefined;

  const values = new Map<string, string>();
  for (const line of lines.slice(healthcheckIndex + 1)) {
    // The block ends at the next key of the service, or the next service.
    if (line.trim().length > 0 && !/^ {6}/.test(line)) break;
    const match = /^ {6}(interval|retries|start_period):\s*(\S+)\s*$/.exec(line);
    if (match) values.set(match[1]!, match[2]!);
  }

  return {
    intervalSeconds: toSeconds(values.get("interval") ?? "0"),
    retries: Number(values.get("retries") ?? 0),
    startPeriodSeconds: toSeconds(values.get("start_period") ?? "0"),
  };
}
