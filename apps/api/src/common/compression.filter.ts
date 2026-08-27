import compression from "compression";
import type { Request, Response } from "express";

/**
 * Which responses gzip on the way out (docs/audit-2026-08-26-prod-latency.md
 * §5.3).
 *
 * Cloudflare already compresses edge→browser, so the hop this recovers is
 * origin→edge — the one that crosses from a server in France to a Cloudflare
 * colo, and the one that actually costs. A page of 50 bank questions carries
 * a `bodyTypst` string and an `alternatives` jsonb array per row.
 *
 * The whole reason this is a named predicate rather than a bare
 * `app.use(compression())`: the default filter delegates to `compressible()`,
 * which accepts `text/*`, which includes `text/event-stream`. Compressing an
 * SSE response buffers it, and the two hand-rolled SSE endpoints here
 * (`/exams/:examId/versions/jobs/:jobId/stream`,
 * `/ai/questions/jobs/:id/stream`) emit one frame per completed unit of work.
 * Those frames would accumulate in the compressor instead of reaching the
 * browser: a stream that stays open and silent. That failure is invisible —
 * no error, no log, just a progress bar that never moves — which is exactly
 * why it gets an explicit test rather than a comment.
 */
export function shouldCompress(req: Request, res: Response): boolean {
  const contentType = res.getHeader("Content-Type");
  if (typeof contentType === "string" && contentType.includes("text/event-stream")) {
    return false;
  }
  return compression.filter(req, res);
}
