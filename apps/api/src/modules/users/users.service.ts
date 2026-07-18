import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
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

  async create(user: AuthTokenPayload, email: string, role: "teacher" | "school_admin") {
    const tenantId = requireTenant(user);
    if (await this.repository.findByEmail(email)) {
      throw new ConflictException(`Email already in use: ${email}`);
    }
    const temporaryPassword = generateTemporaryPassword();
    const { id } = await this.repository.create(tenantId, email, role, await hashPassword(temporaryPassword));
    return { id, email, role, temporaryPassword };
  }

  async setActive(user: AuthTokenPayload, targetId: string, active: boolean) {
    const tenantId = requireTenant(user);
    if (targetId === user.sub && !active) {
      throw new ConflictException("You cannot deactivate your own account");
    }
    const target = await this.repository.findByIdInTenant(targetId, tenantId);
    if (!target) throw new NotFoundException(`User not found: ${targetId}`);
    await this.repository.setActive(targetId, active);
    return { id: targetId, active };
  }

  async resetPassword(user: AuthTokenPayload, targetId: string) {
    const tenantId = requireTenant(user);
    const target = await this.repository.findByIdInTenant(targetId, tenantId);
    if (!target) throw new NotFoundException(`User not found: ${targetId}`);
    const temporaryPassword = generateTemporaryPassword();
    await this.repository.setPasswordHash(targetId, await hashPassword(temporaryPassword));
    return { id: targetId, temporaryPassword };
  }
}
