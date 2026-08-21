import { randomUUID } from "node:crypto";
import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { Tenant, TenantListResult } from "@exams-generator/shared";
import { count, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client";
import {
  assets,
  cycles,
  examBlueprintRows,
  examBlueprintTemplateRows,
  examBlueprintTemplates,
  examQuestions,
  examVersionJobs,
  examVersions,
  exams,
  generationJobs,
  questionAlternativeImages,
  questions,
  syllabusWeekMaps,
  tenants,
  users,
} from "../../db/schema";
import { requireImageMime } from "../assets/image-mime";
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

  async create(dto: CreateTenantDto): Promise<Tenant> {
    const [tenant] = await db.insert(tenants).values({ name: dto.name, slug: dto.slug }).returning();
    return tenant;
  }

  async findAll(page: number, pageSize: number): Promise<TenantListResult> {
    const [{ value: total }] = await db.select({ value: count() }).from(tenants);
    const items = await db
      .select()
      .from(tenants)
      .limit(pageSize)
      .offset((page - 1) * pageSize);
    return { items, total };
  }

  async findById(id: string): Promise<Tenant> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, id));
    if (!tenant) {
      throw new NotFoundException(`Tenant not found: ${id}`);
    }
    return tenant;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, slug));
    return !!tenant;
  }

  async update(id: string, dto: UpdateTenantDto): Promise<Tenant> {
    await this.findById(id);
    const [tenant] = await db.update(tenants).set(dto).where(eq(tenants.id, id)).returning();
    return tenant;
  }

  /**
   * Hard-deletes a school and EVERYTHING it owns. `DELETE /tenants/:id` used to
   * run a bare `db.delete(tenants)` — every child table FKs back to `tenants`
   * with NO ACTION, so any school that had a single user/exam/question failed
   * with a 500 (audit 2026-08-18). Nothing could be decommissioned and there
   * was no path to erase a school's data.
   *
   * Ownership here is a strict composition tree, so we delete children before
   * parents inside ONE transaction, scoping each child by its tenant (directly
   * where the column exists, else via a subquery on the owning parent). Order
   * is FK-driven, not alphabetical — notably `exam_questions` before
   * `exam_blueprint_rows` (its `blueprint_row_id` FK) and the `tenants.
   * logo_asset_id → assets` self-edge is broken FIRST so `assets` can be
   * deleted before the tenant row.
   *
   * MinIO objects do not participate in the DB transaction: we snapshot the
   * tenant's `storage_key`s first and purge them only AFTER the tx commits, so
   * a rolled-back delete never orphans live rows against dead objects. A purge
   * failure is logged, not fatal — the DB is already consistent and the object
   * is unreachable anyway (its `assets` row is gone).
   */
  async remove(id: string): Promise<void> {
    await this.findById(id);

    const tenantExams = db.select({ id: exams.id }).from(exams).where(eq(exams.tenantId, id));
    const tenantTemplates = db
      .select({ id: examBlueprintTemplates.id })
      .from(examBlueprintTemplates)
      .where(eq(examBlueprintTemplates.tenantId, id));
    const tenantQuestions = db
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.tenantId, id));

    const storageKeys = (
      await db.select({ key: assets.storageKey }).from(assets).where(eq(assets.tenantId, id))
    ).map((row) => row.key);

    await db.transaction(async (tx) => {
      // Break the tenant -> its-own-logo asset edge so `assets` can go before the tenant row.
      await tx.update(tenants).set({ logoAssetId: null }).where(eq(tenants.id, id));

      // exams subtree (children first; exam_questions before blueprint_rows).
      await tx.delete(examQuestions).where(inArray(examQuestions.examId, tenantExams));
      await tx.delete(examBlueprintRows).where(inArray(examBlueprintRows.examId, tenantExams));
      await tx.delete(examVersions).where(inArray(examVersions.examId, tenantExams));
      await tx.delete(examVersionJobs).where(eq(examVersionJobs.tenantId, id));
      await tx.delete(exams).where(eq(exams.tenantId, id));

      // blueprint-templates subtree.
      await tx
        .delete(examBlueprintTemplateRows)
        .where(inArray(examBlueprintTemplateRows.templateId, tenantTemplates));
      await tx.delete(syllabusWeekMaps).where(inArray(syllabusWeekMaps.templateId, tenantTemplates));
      await tx.delete(examBlueprintTemplates).where(eq(examBlueprintTemplates.tenantId, id));

      await tx.delete(generationJobs).where(eq(generationJobs.tenantId, id));

      // questions subtree (alt-images explicitly, though its FK already cascades).
      await tx
        .delete(questionAlternativeImages)
        .where(inArray(questionAlternativeImages.questionId, tenantQuestions));
      await tx.delete(questions).where(eq(questions.tenantId, id));

      await tx.delete(cycles).where(eq(cycles.tenantId, id));

      // assets now unreferenced; users after everything that FKs created_by.
      await tx.delete(assets).where(eq(assets.tenantId, id));
      await tx.delete(users).where(eq(users.tenantId, id));

      await tx.delete(tenants).where(eq(tenants.id, id));
    });

    for (const key of storageKeys) {
      try {
        await this.storage.delete(key);
      } catch {
        // DB is already consistent; the object is unreachable regardless. Best-effort.
      }
    }
  }

  async uploadLogo(id: string, file: UploadedLogoFile): Promise<Tenant> {
    await this.findById(id);

    const mime = requireImageMime(file);
    const storageKey = `tenants/${id}/logo/${randomUUID()}-${file.originalname}`;
    await this.storage.put(storageKey, file.buffer, mime);

    const [asset] = await db
      .insert(assets)
      .values({ tenantId: id, storageKey, mime })
      .returning();

    const [tenant] = await db
      .update(tenants)
      .set({ logoAssetId: asset.id })
      .where(eq(tenants.id, id))
      .returning();

    return tenant;
  }
}
