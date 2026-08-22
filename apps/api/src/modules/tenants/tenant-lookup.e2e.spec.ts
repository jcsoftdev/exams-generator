import { randomUUID } from "node:crypto";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../../app.module";
import {
  closeDbPool,
  createTenantFixture,
  deleteTenantFixture,
  ensureMigrated,
  TenantFixture,
} from "../../test-utils/db-fixtures";

describe("Tenant lookup (e2e)", () => {
  let app: INestApplication;
  let tenant: TenantFixture;

  beforeAll(async () => {
    await ensureMigrated();

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    tenant = await createTenantFixture();
  });

  afterAll(async () => {
    await deleteTenantFixture(tenant.id);
    await app.close();
    await closeDbPool();
  });

  describe("GET /tenant-lookup/:slug", () => {
    it("returns 204 with no body for a slug that exists, without an auth header", async () => {
      const res = await request(app.getHttpServer()).get(`/tenant-lookup/${tenant.slug}`);

      expect(res.status).toBe(204);
      expect(res.body).toEqual({});
    });

    it("returns 404 for a slug that does not exist", async () => {
      const res = await request(app.getHttpServer()).get(`/tenant-lookup/no-such-tenant-${randomUUID()}`);

      expect(res.status).toBe(404);
    });
  });
});
