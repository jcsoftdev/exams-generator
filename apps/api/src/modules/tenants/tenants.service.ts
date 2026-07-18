import { randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { db } from "../../db/client";
import { assets, tenants } from "../../db/schema";
import { STORAGE_PORT } from "../bank/bank.constants";
import { StoragePort } from "../exams/domain/ports/storage.port";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { UpdateTenantDto } from "./dto/update-tenant.dto";

export interface UploadedLogoFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/**
 * Direct Drizzle access (no repository layer), matching `db/seed.ts` /
 * `auth.service.ts` — this codebase has no DI abstraction over Drizzle yet.
 * Injects the SAME `STORAGE_PORT` token the bank module already binds
 * (via `resolveStorageAdapter` in `tenants.module.ts`) rather than
 * introducing a second storage DI token.
 */
@Injectable()
export class TenantsService {
  constructor(@Inject(STORAGE_PORT) private readonly storage: StoragePort) {}

  async create(dto: CreateTenantDto) {
    const [tenant] = await db.insert(tenants).values({ name: dto.name, slug: dto.slug }).returning();
    return tenant;
  }

  async findAll() {
    return db.select().from(tenants);
  }

  async findById(id: string) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) {
      throw new NotFoundException(`Tenant not found: ${id}`);
    }
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    await this.findById(id);
    const [tenant] = await db.update(tenants).set(dto).where(eq(tenants.id, id)).returning();
    return tenant;
  }

  async remove(id: string): Promise<void> {
    await this.findById(id);
    await db.delete(tenants).where(eq(tenants.id, id));
  }

  async uploadLogo(id: string, file: UploadedLogoFile) {
    await this.findById(id);

    const storageKey = `tenants/${id}/logo/${randomUUID()}-${file.originalname}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);

    const [asset] = await db
      .insert(assets)
      .values({ tenantId: id, storageKey, mime: file.mimetype })
      .returning();

    const [tenant] = await db
      .update(tenants)
      .set({ logoAssetId: asset.id })
      .where(eq(tenants.id, id))
      .returning();

    return tenant;
  }
}
