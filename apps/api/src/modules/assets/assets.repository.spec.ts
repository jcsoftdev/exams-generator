import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db, pool } from "../../db/client";
import { runMigrations } from "../../db/migrate";
import { assets, tenants } from "../../db/schema";
import { AssetsRepository } from "./assets.repository";

/**
 * Integration test against the real docker-compose Postgres — same pattern
 * as `bank.repository.spec.ts`. Every fixture uses a random suffix so
 * repeated runs never collide, and `afterAll` deletes everything this file
 * created.
 */
describe("AssetsRepository", () => {
  const repository = new AssetsRepository();

  let tenantAId: string;
  let tenantBId: string;
  let centralAssetId: string;
  let tenantAAssetId: string;
  let tenantBAssetId: string;

  const createdAssetIds: string[] = [];
  const createdTenantIds: string[] = [];

  beforeAll(async () => {
    await runMigrations();

    const suffix = randomUUID();

    const [tenantA] = await db
      .insert(tenants)
      .values({ name: `Assets Test Tenant A ${suffix}`, slug: `assets-test-tenant-a-${suffix}` })
      .returning({ id: tenants.id });
    tenantAId = tenantA!.id;
    createdTenantIds.push(tenantAId);

    const [tenantB] = await db
      .insert(tenants)
      .values({ name: `Assets Test Tenant B ${suffix}`, slug: `assets-test-tenant-b-${suffix}` })
      .returning({ id: tenants.id });
    tenantBId = tenantB!.id;
    createdTenantIds.push(tenantBId);

    const [central] = await db
      .insert(assets)
      .values({ tenantId: null, storageKey: `test/central-${suffix}`, mime: "image/png" })
      .returning({ id: assets.id });
    centralAssetId = central!.id;
    createdAssetIds.push(centralAssetId);

    const [tenantAAsset] = await db
      .insert(assets)
      .values({ tenantId: tenantAId, storageKey: `test/tenant-a-${suffix}`, mime: "image/jpeg" })
      .returning({ id: assets.id });
    tenantAAssetId = tenantAAsset!.id;
    createdAssetIds.push(tenantAAssetId);

    const [tenantBAsset] = await db
      .insert(assets)
      .values({ tenantId: tenantBId, storageKey: `test/tenant-b-${suffix}`, mime: "image/jpeg" })
      .returning({ id: assets.id });
    tenantBAssetId = tenantBAsset!.id;
    createdAssetIds.push(tenantBAssetId);
  });

  afterAll(async () => {
    if (createdAssetIds.length > 0) {
      await db.delete(assets).where(inArray(assets.id, createdAssetIds));
    }
    if (createdTenantIds.length > 0) {
      await db.delete(tenants).where(inArray(tenants.id, createdTenantIds));
    }
    await pool.end();
  });

  it("returns a central (tenantId=null) asset for any requesting tenant", async () => {
    const forA = await repository.findAssetById(centralAssetId, tenantAId);
    const forB = await repository.findAssetById(centralAssetId, tenantBId);
    const forStaff = await repository.findAssetById(centralAssetId, null);

    expect(forA?.id).toBe(centralAssetId);
    expect(forB?.id).toBe(centralAssetId);
    expect(forStaff?.id).toBe(centralAssetId);
  });

  it("returns a tenant's own private asset when requested by that tenant", async () => {
    const row = await repository.findAssetById(tenantAAssetId, tenantAId);

    expect(row?.id).toBe(tenantAAssetId);
    expect(row?.mime).toBe("image/jpeg");
  });

  it("returns undefined for a private asset requested by a DIFFERENT tenant (never visible)", async () => {
    const row = await repository.findAssetById(tenantAAssetId, tenantBId);

    expect(row).toBeUndefined();
  });

  it("returns undefined for a private asset requested by platform staff (tenantId=null)", async () => {
    const row = await repository.findAssetById(tenantAAssetId, null);

    expect(row).toBeUndefined();
  });

  it("returns undefined for a non-existent id", async () => {
    const row = await repository.findAssetById(randomUUID(), tenantAId);

    expect(row).toBeUndefined();
  });

  it("selects the storageKey needed to fetch the object from StoragePort", async () => {
    const row = await repository.findAssetById(tenantBAssetId, tenantBId);

    expect(row?.storageKey).toContain("test/tenant-b-");
  });
});
