import "reflect-metadata";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import compression from "compression";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { Logger } from "nestjs-pino";
import { AppModule } from "./app.module";
import { shouldCompress } from "./common/compression.filter";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  // Routes Nest's own internal logging (bootstrap messages, framework
  // warnings) through the same structured pino output as request logs and
  // `AllExceptionsFilter` — `bufferLogs: true` above holds anything logged
  // before this line until it's set, so nothing before this point is lost.
  app.useLogger(app.get(Logger));
  app.use(helmet());
  // Compresses origin→edge, the hop that crosses an ocean; Cloudflare handles
  // edge→browser on its own. `shouldCompress` (and its spec) exist because the
  // default filter would happily buffer the SSE streams — see that file.
  //
  // `compression` is a DIRECT dependency of this package, not a transitive
  // one, for the same reason the body-parser note below spells out: the
  // `pnpm deploy --prod` isolated bundle only carries direct deps, and a
  // transitive import crash-loops prod with `Cannot find module`.
  app.use(compression({ filter: shouldCompress }));
  // Parses the `Cookie` request header into `req.cookies` — needed only for
  // the non-sensitive `lastTenant` hint (see auth/cookie.util.ts). Auth
  // itself is still Bearer-token-in-header (apps/web auth.interceptor);
  // no session or credential ever lives in a cookie.
  app.use(cookieParser());
  // The web app now lives on a tenant subdomain (`{slug}.creaexamen.com`)
  // while the API is centralized on `api.creaexamen.com` — no longer
  // same-origin, so cross-origin browser reads need explicit CORS.
  // `credentials: true` is required for the browser to send/store the
  // `lastTenant` cookie across that origin split — it does NOT enable
  // cookie-based auth (still Bearer-token-in-header) and carries no CSRF
  // exposure of its own, since the cookie is non-sensitive (a tenant slug,
  // never the access token) and every state-changing route still requires
  // the bearer token.
  app.enableCors({
    origin: [/^https:\/\/([a-z0-9-]+\.)?creaexamen\.com$/],
    credentials: true,
  });
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
