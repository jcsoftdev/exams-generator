import { randomUUID } from "node:crypto";
import { Module } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { AiModule } from "./modules/ai/ai.module";
import { AllExceptionsFilter } from "./common/all-exceptions.filter";
import { AssetsModule } from "./modules/assets/assets.module";
import { AuthModule } from "./modules/auth/auth.module";
import { BankModule } from "./modules/bank/bank.module";
import { DashboardModule } from "./modules/dashboard/dashboard.module";
import { ExamsModule } from "./modules/exams/exams.module";
import { HealthModule } from "./modules/health/health.module";
import { MetricsModule } from "./modules/metrics/metrics.module";
import { QueueModule } from "./common/queue.module";
import { TaxonomyModule } from "./modules/taxonomy/taxonomy.module";
import { TenantsModule } from "./modules/tenants/tenants.module";
import { UsersModule } from "./modules/users/users.module";

@Module({
  imports: [
    // Structured (JSON) request logging with a correlation id per request
    // (audit P2 — "sin logging estructurado", 500s previously had nothing
    // to grep/correlate). `genReqId` prefers an inbound `x-request-id`
    // (nginx/load-balancer-set) and falls back to a fresh uuid; the id is
    // echoed back on the response and available to every log line for that
    // request via pino-http's AsyncLocalStorage-backed logger.
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req, res) => {
          const inbound = req.headers["x-request-id"];
          const id = (Array.isArray(inbound) ? inbound[0] : inbound) ?? randomUUID();
          res.setHeader("x-request-id", id);
          return id;
        },
        redact: ["req.headers.authorization"],
        // Deliberately always raw JSON, no `pino-pretty` transport: this repo
        // never sets `NODE_ENV` (`pnpm dev` runs with it unset), and a pretty
        // transport spins up a worker thread per Nest app instance — every
        // e2e spec boots a full app, so that risks Jest hanging on open
        // handles across the whole suite for a purely cosmetic dev win.
        // Pipe through `pino-pretty` manually (`pnpm dev | npx pino-pretty`)
        // if you want colorized local output.
        // Health polling every 5s (docker-compose) would otherwise drown out
        // every other log line.
        autoLogging: { ignore: (req) => req.url === "/health" },
      },
    }),
    // Global default: 100 req/min per IP. Login has its own tighter
    // @Throttle() override (see AuthController) since brute-force is the
    // actual threat there. `skipIf` disables throttling under Jest (which
    // sets NODE_ENV=test by default, unset anywhere else in this repo) —
    // e2e specs share one process/IP across many `POST /auth/login` calls
    // (e.g. `tenants.e2e.spec.ts` logs in 15+ times), so without this the
    // 5/min login throttle 429s partway through a spec file and every
    // request after that runs on an empty/undefined token, failing with
    // unrelated-looking 401s instead of the real rate-limit error.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100, skipIf: () => process.env.NODE_ENV === "test" }]),
    // Shared BullMQ connection for every queue (`generation`, `exam-versions`).
    QueueModule,
    HealthModule,
    MetricsModule,
    AuthModule,
    BankModule,
    TenantsModule,
    ExamsModule,
    AiModule,
    TaxonomyModule,
    AssetsModule,
    UsersModule,
    DashboardModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
