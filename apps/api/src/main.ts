import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  // Routes Nest's own internal logging (bootstrap messages, framework
  // warnings) through the same structured pino output as request logs and
  // `AllExceptionsFilter` — `bufferLogs: true` above holds anything logged
  // before this line until it's set, so nothing before this point is lost.
  app.useLogger(app.get(Logger));
  app.use(helmet());
  // No `app.enableCors()` call — DELIBERATE, not an oversight (audit P2).
  // Nest ships CORS disabled by default, so with no explicit config the API
  // already rejects cross-origin browser reads. Prod is same-origin by
  // design: nginx proxies `/api/*` to this service under the SAME origin as
  // the Angular app (`infra/nginx/web.conf`), and dev mirrors that via the
  // Angular CLI proxy. Enabling CORS here would only be needed for a future
  // consumer on a different origin (e.g. a separate marketing site calling
  // the API directly) — none exists today.
  // Safety net for any FUTURE class-based DTO (class-validator decorators).
  // Every DTO today (`LoginRequestDto` etc., see @exams-generator/shared) is
  // a plain TS interface — deliberately framework-agnostic so it can be
  // shared verbatim with Angular — which means this pipe validates NOTHING
  // on them: Nest's ValidationPipe skips validation when the reflected
  // metatype resolves to the generic `Object` (interfaces don't exist at
  // runtime). This does NOT fix the audit's "DTOs son interfaces casteadas"
  // finding — that needs the affected DTOs converted to class-validator
  // classes, a separate, larger change. `whitelist`/`forbidNonWhitelisted`
  // are still no-ops for the same reason; kept for when a class DTO exists.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  // Express's default json() body limit is 100kb — too small for the
  // exam-builder's stock-batch call, which sends one cell per
  // course·topic·difficulty for an entire grade's catalog (preuniversitario
  // alone is 100+ topics × 3 difficulties). 5mb is generous headroom for an
  // authenticated internal tool, not a public endpoint.
  //
  // Set via Nest's own platform-express body parser rather than
  // `import { json } from "express"` — the direct express import is NOT
  // resolvable in the `pnpm deploy --prod` isolated bundle (express is only a
  // transitive dep of @nestjs/platform-express), which crash-looped prod with
  // `Cannot find module 'express'`.
  app.useBodyParser("json", { limit: "5mb" });
  // Dev default is the port-registry-assigned port for this project's nestjs
  // service (3012), so `pnpm dev` matches the web dev proxy with no setup.
  // Prod (docker-compose / Dokploy) always sets PORT explicitly (3000).
  const port = process.env.PORT ?? 3012;
  await app.listen(port);
}

void bootstrap();
