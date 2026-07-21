import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { json } from "express";
import { AppModule } from "./app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Express's default json() body limit is 100kb — too small for the
  // exam-builder's stock-batch call, which sends one cell per
  // course·topic·difficulty for an entire grade's catalog (preuniversitario
  // alone is 100+ topics × 3 difficulties). 5mb is generous headroom for an
  // authenticated internal tool, not a public endpoint.
  app.use(json({ limit: "5mb" }));
  // Dev default is the port-registry-assigned port for this project's nestjs
  // service (3012), so `pnpm dev` matches the web dev proxy with no setup.
  // Prod (docker-compose / Dokploy) always sets PORT explicitly (3000).
  const port = process.env.PORT ?? 3012;
  await app.listen(port);
}

void bootstrap();
