import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { Role } from "@exams-generator/shared";
import { hashPassword } from "../auth/password.util";
import { AuthTokenPayload } from "../auth/token.service";
import { TenantUser, UsersRepository } from "./users.repository";

function requireTenant(user: AuthTokenPayload): string {
  if (!user.tenantId) throw new ForbiddenException("Only tenant admins can manage users");
  return user.tenantId;
}

/** 12 chars url-safe — se muestra una sola vez */
function generateTemporaryPassword(): string {
  return randomBytes(9).toString("base64url").slice(0, 12);
}

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}

  async list(user: AuthTokenPayload): Promise<TenantUser[]> {
    return this.repository.listByTenant(requireTenant(user));
  }

  async create(user: AuthTokenPayload, email: string, name: string, role: "teacher" | "school_admin") {
    if (role !== Role.Teacher && role !== Role.SchoolAdmin) {
      throw new BadRequestException("role must be teacher or school_admin");
    }
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new BadRequestException("name is required");
    }
    const tenantId = requireTenant(user);
    if (await this.repository.findByEmail(email)) {
      // Accounts are PLATFORM-WIDE by design: `users.email` has a global
      // unique constraint and login is email+password with no tenant
      // context. A 409 here therefore means "this person already has an
      // account somewhere on the platform" — the message must say so, or the
      // admin reads it as "email taken inside my school" and gets stuck.
      throw new ConflictException(`An account with this email already exists on the platform: ${email}`);
    }
    const temporaryPassword = generateTemporaryPassword();
    const { id } = await this.repository.create(tenantId, email, name.trim(), role, await hashPassword(temporaryPassword));
    return { id, email, name: name.trim(), role, temporaryPassword };
  }

  async setActive(user: AuthTokenPayload, targetId: string, active: boolean) {
    const tenantId = requireTenant(user);
    if (targetId === user.sub && !active) {
      throw new ConflictException("You cannot deactivate your own account");
    }
    const target = await this.repository.findByIdInTenant(targetId, tenantId);
    if (!target) throw new NotFoundException(`User not found: ${targetId}`);
    await this.repository.setActive(targetId, tenantId, active);
    return { id: targetId, active };
  }

  async resetPassword(user: AuthTokenPayload, targetId: string) {
    const tenantId = requireTenant(user);
    const target = await this.repository.findByIdInTenant(targetId, tenantId);
    if (!target) throw new NotFoundException(`User not found: ${targetId}`);
    const temporaryPassword = generateTemporaryPassword();
    await this.repository.setPasswordHash(targetId, tenantId, await hashPassword(temporaryPassword));
    return { id: targetId, temporaryPassword };
  }
}
