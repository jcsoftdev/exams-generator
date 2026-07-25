import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from "@nestjs/common";
import { Request, Response } from "express";
import { Logger } from "nestjs-pino";

/**
 * Global catch-all filter (audit P2 — "sin logging estructurado", 500s and
 * job failures had no correlation-id to grep). Does NOT change any response
 * body Nest would already produce for a thrown `HttpException` (same
 * `getResponse()` shape callers/e2e specs already assert on) — it only adds
 * structured (pino) logging around it, keyed by the per-request id
 * `LoggerModule.forRoot`'s `genReqId` assigns (`app.module.ts`). A truly
 * unhandled (non-`HttpException`) error still gets Nest's default generic
 * 500 body — never the raw error message/stack, which stays server-side
 * only, in the log line.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = (request as { id?: string }).id;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error({ err: exception, requestId, path: request.url }, "Unhandled server error");
      }
      response.status(status).json(exception.getResponse() as object);
      return;
    }

    this.logger.error({ err: exception, requestId, path: request.url }, "Unhandled exception");
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    });
  }
}
