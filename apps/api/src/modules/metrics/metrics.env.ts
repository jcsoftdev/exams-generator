/**
 * Who may scrape `GET /metrics`.
 *
 * Metrics are not secret the way a password is, but they do describe traffic
 * shape, queue backlogs and error rates, and the endpoint is unauthenticated
 * by design (a Prometheus scraper cannot log in). So: in production a token is
 * REQUIRED, and the app refuses to serve metrics without one rather than
 * quietly exposing them — the same stance `resolveJwtSecret` takes about a
 * forgeable secret. Outside production, no token means open, because a dev
 * machine scraping its own API through curl should not need ceremony.
 */
export function resolveMetricsToken(): string | undefined {
  const token = process.env.METRICS_TOKEN?.trim();
  return token && token.length > 0 ? token : undefined;
}

export function metricsRequireToken(): boolean {
  return process.env.NODE_ENV === "production";
}
