import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
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
