import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Role } from "@exams-generator/shared";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { TenantGuard } from "../auth/tenant.guard";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { UpdateTenantDto } from "./dto/update-tenant.dto";
import { TenantsService } from "./tenants.service";
import { clampPagination } from "../../common/pagination.util";

/**
 * `TenantGuard` defaults to reading the `:id` route param as the target
 * tenant, which matches every route here — no `@TenantParam()` override
 * needed. `platform_admin`-only routes (`create`, `remove`) never hit the
 * tenant-scoping branch: `TenantGuard` bypasses global roles before
 * looking at the param.
 */
// Same reasoning as bank.controller.ts's MAX_IMAGE_UPLOAD_BYTES — a tenant
// logo, never bulk data.
const MAX_IMAGE_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller("tenants")
@UseGuards(JwtAuthGuard, RolesGuard, TenantGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @Roles(Role.PlatformAdmin)
  @HttpCode(201)
  create(@Body() dto: CreateTenantDto) {
    return this.tenantsService.create(dto);
  }

  /**
   * `GET /tenants` (N3) — full tenant list for the `platform_admin` colegio
   * selector. `platform_admin`-only, same as `create`/`remove`: the param-
   * less route never reaches `TenantGuard`'s `:id` scoping branch (the guard
   * bypasses global roles first), so no `@TenantParam()` override is needed.
   */
  @Get()
  @Roles(Role.PlatformAdmin)
  findAll(@Query("page") page?: string, @Query("pageSize") pageSize?: string) {
    const clamped = clampPagination(page, pageSize);
    return this.tenantsService.findAll(clamped.page, clamped.pageSize);
  }

  @Get(":id")
  @Roles(Role.PlatformAdmin, Role.SchoolAdmin)
  findOne(@Param("id") id: string) {
    return this.tenantsService.findById(id);
  }

  @Patch(":id")
  @Roles(Role.PlatformAdmin, Role.SchoolAdmin)
  update(@Param("id") id: string, @Body() dto: UpdateTenantDto) {
    return this.tenantsService.update(id, dto);
  }

  @Delete(":id")
  @Roles(Role.PlatformAdmin)
  async remove(@Param("id") id: string): Promise<{ deleted: true }> {
    await this.tenantsService.remove(id);
    return { deleted: true };
  }

  @Post(":id/logo")
  @Roles(Role.PlatformAdmin, Role.SchoolAdmin)
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES } }))
  @HttpCode(201)
  uploadLogo(@Param("id") id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    return this.tenantsService.uploadLogo(id, {
      buffer: file.buffer,
      mimetype: file.mimetype,
      originalname: file.originalname,
    });
  }
}
