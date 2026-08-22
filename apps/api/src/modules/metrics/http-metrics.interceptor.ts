import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Request, Response } from "express";
import { Observable, tap } from "rxjs";
import { MetricsService } from "./metrics.service";

/**
 * Times every request into the histogram (audit 2026-08-20, M6).
 *
 * Labels use the ROUTE TEMPLATE from Express (`/exams/:examId`), never the
 * concrete path: one series per endpoint instead of one per exam id, which is
 * the difference between a useful dashboard and a Prometheus instance that
 * runs out of memory.
 *
 * `tap`'s error branch matters as much as the success one — a request that
 * throws is exactly the one worth timing, and recording only successes makes
 * an endpoint look healthy while it 500s.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") {
      return next.handle();
    }

    const startedAt = Date.now();
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const record = (statusCode: number): void => {
      this.metrics.recordRequest({
        method: request.method,
        route: routeTemplateOf(request),
        statusCode,
        durationMs: Date.now() - startedAt,
      });
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode),
        error: (error: { status?: number }) => record(typeof error?.status === "number" ? error.status : 500),
      }),
    );
  }
}

/**
 * Falls back to a literal `unmatched` rather than the raw URL when Express has
 * no route for it: a 404 flood on random paths would otherwise create one
 * series per path — the cardinality explosion this label exists to avoid.
 */
function routeTemplateOf(request: Request): string {
  // Express types `req.route` as `any`; narrow it here rather than sprinkling
  // assertions at the call site.
  const route: unknown = (request as { route?: unknown }).route;
  const path = (route as { path?: unknown } | undefined)?.path;
  return typeof path === "string" ? path : "unmatched";
}
