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

  async function createAsset(
    tenantId: string | null,
    mime: string,
    bytes: Buffer,
    basename?: string,
  ): Promise<string> {
    // `basename` lets a test control the tail of the storage key — the part
    // the download filename is derived from — while keeping the key itself
    // unique and storage-legal.
    const key = `test/assets-e2e/${randomUUID()}${basename ? `/${basename}` : ""}`;
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

  /**
   * Exam version PDFs are served through this same route
   * (`exam-generation.service.ts` stores them as `/assets/:id`), but the route
   * was written for images only: every non-image mime collapsed to
   * octet-stream and the disposition never carried a filename. Hitting the URL
   * directly — open in a new tab, "save link as", any non-browser client —
   * therefore saved the URL's last segment: a bare uuid with NO extension.
   * The web panel masked it by fetching the blob and setting `download` on the
   * anchor itself.
   */
  it("GET /assets/:id — serves a PDF as a real PDF attachment, with a filename that has the extension", async () => {
    const pdf = Buffer.from("%PDF-1.7\nfake-exam-bytes");
    const id = await createAsset(tenantAId, "application/pdf", pdf, "exam.pdf");

    const response = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(response.headers["content-type"]).toMatch(/^application\/pdf/);
    // `attachment`, never `inline`: a PDF rendered inline runs its own
    // scripting in the viewer, and the whole point here is saving the file.
    expect(response.headers["content-disposition"]).toBe('attachment; filename="exam.pdf"');
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(response.body as Buffer, pdf)).toBe(0);
  });

  it("GET /assets/:id — falls back to the asset id when the storage key's tail is not a .pdf name", async () => {
    const id = await createAsset(tenantAId, "application/pdf", Buffer.from("%PDF-1.7"));

    const response = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(response.headers["content-disposition"]).toBe(`attachment; filename="${id}.pdf"`);
  });

  it("GET /assets/:id — an image is still served inline, unchanged", async () => {
    const id = await createAsset(tenantAId, "image/png", Buffer.from("real-png-ish"));

    const response = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(response.headers["content-type"]).toBe("image/png");
    expect(response.headers["content-disposition"]).toBe("inline");
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
  /**
   * The prod-latency finding this closes (docs/audit-2026-08-26-prod-latency.md
   * §3): the route emitted no `Cache-Control` and no `ETag` at all. The web
   * fetches thumbnails as authenticated blob XHRs (bearer auth means a plain
   * `<img src>` cannot work), so a topic of 50 questions re-downloaded ~3MB of
   * images on EVERY visit — each request paying the ~620ms round-trip to an
   * origin in France measured in that audit.
   */
  it("GET /assets/:id — an image is cacheable forever and PRIVATE, with a strong ETag", async () => {
    const id = await createAsset(tenantAId, "image/png", Buffer.from("cacheable-png"));

    const response = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(response.headers["cache-control"]).toBe("private, max-age=31536000, immutable");
    // `private` is the security half, not a tuning detail: Cloudflare fronts
    // this API in production and must never store one tenant's question image.
    expect(response.headers["cache-control"]).not.toMatch(/public/);
    expect(response.headers["etag"]).toMatch(/^"[0-9a-f]+"$/);
  });

  it("GET /assets/:id — a PDF revalidates instead of caching immutably", async () => {
    // Exam-version PDFs reuse their storage key across regenerations, so an
    // already-issued asset id can come to point at different bytes. It may be
    // stored, but never reused without asking.
    const id = await createAsset(tenantAId, "application/pdf", Buffer.from("%PDF-1.7"), "exam.pdf");

    const response = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    expect(response.headers["cache-control"]).toBe("private, no-cache");
    expect(response.headers["cache-control"]).not.toMatch(/immutable/);
    expect(response.headers["etag"]).toMatch(/^"[0-9a-f]+"$/);
  });

  it("GET /assets/:id — returns 304 with no body when If-None-Match matches", async () => {
    const bytes = Buffer.from("bytes-worth-not-resending");
    const id = await createAsset(tenantAId, "image/png", bytes);

    const first = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);
    const etag = first.headers["etag"] as string;

    const second = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .set("If-None-Match", etag)
      .expect(304);

    // This is the byte saving that makes the round-trip worth paying: the
    // revalidation carries no payload at all.
    expect(second.body).toEqual({});
    expect(second.headers["content-length"]).toBeUndefined();
  });

  it("GET /assets/:id — a stale If-None-Match still gets the full bytes", async () => {
    const bytes = Buffer.from("fresh-bytes");
    const id = await createAsset(tenantAId, "image/png", bytes);

    const response = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .set("If-None-Match", '"0000000000000000000000000000dead"')
      .expect(200);

    expect(Buffer.compare(response.body as Buffer, bytes)).toBe(0);
  });

  it("GET /assets/:id — two assets holding the same bytes share an ETag, different bytes do not", async () => {
    const same = Buffer.from("identical-content");
    const a = await createAsset(tenantAId, "image/png", same);
    const b = await createAsset(tenantAId, "image/png", same);
    const c = await createAsset(tenantAId, "image/png", Buffer.from("other-content"));

    const get = async (id: string): Promise<string> =>
      (
        await request(app.getHttpServer())
          .get(`/assets/${id}`)
          .set("Authorization", `Bearer ${tenantAToken}`)
          .expect(200)
      ).headers["etag"] as string;

    expect(await get(a)).toBe(await get(b));
    expect(await get(a)).not.toBe(await get(c));
  });

  /**
   * A 304 must not become a way to confirm that another tenant's asset id
   * exists. The visibility check runs before any validator comparison, so a
   * cross-tenant request is a 404 whether or not the ETag matches.
   */
  it("GET /assets/:id — a cross-tenant request with a VALID ETag is still 404, never 304", async () => {
    const id = await createAsset(tenantAId, "image/png", Buffer.from("tenant-a-only"));

    const mine = await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantAToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/assets/${id}`)
      .set("Authorization", `Bearer ${tenantBToken}`)
      .set("If-None-Match", mine.headers["etag"] as string)
      .expect(404);
  });
});
