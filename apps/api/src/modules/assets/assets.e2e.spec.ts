import { randomUUID } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { inArray } from "drizzle-orm";
import request from "supertest";
import { AppModule } from "../../app.module";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { assets, tenants, users } from "../../db/schema";
import { STORAGE_PORT } from "../bank/bank.constants";
import { TokenService } from "../auth/token.service";
import { StoragePort } from "../exams/domain/ports/storage.port";

/**
 * Full HTTP e2e — real Nest app, real Postgres, real MinIO (docker-compose
 * `minio` service). `GET /assets/:id` streams the raw bytes previously
 * `put()` via the same `StoragePort` the bank module uses, with the same
 * tenant-visibility rule as `GET /bank/questions` (design doc §3).
 */
describe("Assets module (e2e)", () => {
  let app: INestApplication;
  let tokenService: TokenService;
  let storage: StoragePort;

  let tenantAId: string;
  let tenantATeacherId: string;
  let tenantBId: string;
  let tenantBTeacherId: string;

  let tenantAToken: string;
  let tenantBToken: string;

  const createdAssetIds: string[] = [];
  const createdUserIds: string[] = [];
  const createdTenantIds: string[] = [];
  const createdKeys: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    tokenService = moduleRef.get(TokenService);
    storage = moduleRef.get(STORAGE_PORT);

    const suffix = randomUUID();

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `Assets E2E Tenant A ${suffix}`, slug: `assets-e2e-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;
    createdTenantIds.push(tenantAId);

    const [teacherA] = await db
      .insert(users)
      .values({
        tenantId: tenantAId,
        email: `assets-e2e-teacher-a-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantATeacherId = teacherA!.id;
    createdUserIds.push(tenantATeacherId);

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `Assets E2E Tenant B ${suffix}`, slug: `assets-e2e-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;
    createdTenantIds.push(tenantBId);

    const [teacherB] = await db
      .insert(users)
      .values({
        tenantId: tenantBId,
        email: `assets-e2e-teacher-b-${suffix}@exams-generator.test`,
        passwordHash: "test-hash",
        role: Role.Teacher,
      })
      .returning({ id: users.id });
    tenantBTeacherId = teacherB!.id;
    createdUserIds.push(tenantBTeacherId);

    tenantAToken = tokenService.sign({ sub: tenantATeacherId, tenantId: tenantAId, role: Role.Teacher });
    tenantBToken = tokenService.sign({ sub: tenantBTeacherId, tenantId: tenantBId, role: Role.Teacher });
  });

  afterAll(async () => {
    for (const key of createdKeys) {
      await storage.delete(key);
    }
    if (createdAssetIds.length > 0) {
      await db.delete(assets).where(inArray(assets.id, createdAssetIds));
    }
    if (createdUserIds.length > 0) {
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    if (createdTenantIds.length > 0) {
      await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
    }
    await app.close();
    await pool.end();
  });

  async function createAsset(tenantId: string | null, mime: string, bytes: Buffer): Promise<string> {
    const key = `test/assets-e2e/${randomUUID()}`;
    await storage.put(key, bytes, mime);
    createdKeys.push(key);

    const [row] = await db
      .insert(assets)
      .values({ tenantId, storageKey: key, mime })
      .returning({ id: assets.id });
    createdAssetIds.push(row!.id);
    return row!.id;
  }

  it("GET /assets/:id — 200 with the exact bytes and Content-Type for a central (tenantId=null) asset, visible to any tenant", async () => {
    const bytes = Buffer.from("central-fake-png-bytes");
    const id = await createAsset(null, "image/png", bytes);

    const response = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(response.headers["content-type"]).toBe("image/png");
    expect(Buffer.compare(response.body as Buffer, bytes)).toBe(0);
  });

  it("GET /assets/:id — 200 for a tenant's own private asset", async () => {
    const bytes = Buffer.from("tenant-a-fake-jpeg-bytes");
    const id = await createAsset(tenantAId, "image/jpeg", bytes);

    const response = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(response.headers["content-type"]).toBe("image/jpeg");
    expect(Buffer.compare(response.body as Buffer, bytes)).toBe(0);
  });

  it("GET /assets/:id — 404 when tenant B requests tenant A's private asset (cross-tenant)", async () => {
    const id = await createAsset(tenantAId, "image/jpeg", Buffer.from("private"));

    await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .expect(404);
  });

  it("GET /assets/:id — 404 for a non-existent id", async () => {
    await request(app.getHttpServer())
      .get(`/assets/${randomUUID()}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(404);
  });

  it("GET /assets/:id — 401 when no Authorization header is sent", async () => {
    const id = await createAsset(null, "image/png", Buffer.from("x"));

    await request(app.getHttpServer()).get(`/assets/${id}`).expect(401);
  });

  it("GET /assets/:id — collapses a hostile stored mime to octet-stream with nosniff (no stored XSS)", async () => {
    // A stored row whose mime was spoofed at upload time — the exact payload
    // an attacker would use to get a script rendered inline in a same-tenant
    // admin's tab.
    const svg = Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>");
    const id = await createAsset(tenantAId, "image/svg+xml", svg);

    const response = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/^application\/octet-stream/);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    // Bytes still round-trip — the object is retrievable, just never executable.
    expect(Buffer.compare(response.body as Buffer, svg)).toBe(0);
  });

  it("GET /assets/:id — sets nosniff even on a legit image", async () => {
    const id = await createAsset(tenantAId, "image/png", Buffer.from("real-png-ish"));

    const response = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/^image\/png/);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
