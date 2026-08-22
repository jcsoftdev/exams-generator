import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import {
  CREATABLE_USER_ROLES,
  CreatableUserRole,
  CreateUserResult,
  PagedTenantUsers,
  ResetPasswordResult,
  SetActiveResult,
} from "@exams-generator/shared";
import type { AnonymizeUserResult, PersonalDataExport } from "@exams-generator/shared";
import { AccountStatusService } from "../auth/account-status.service";
import { hashPassword } from "../auth/password.util";
import { AuthTokenPayload } from "../auth/token.service";
import { UsersRepository } from "./users.repository";

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
  constructor(
    private readonly repository: UsersRepository,
    private readonly accountStatus: AccountStatusService,
  ) {}

  async list(user: AuthTokenPayload, page: number, pageSize: number): Promise<PagedTenantUsers> {
    return this.repository.listByTenant(requireTenant(user), page, pageSize);
  }

  async create(user: AuthTokenPayload, email: string, name: string, role: CreatableUserRole): Promise<CreateUserResult> {
    // `body.role` is never validated by a class-validator DTO before it
    // reaches here (this codebase has none for this route) — the TS param
    // type is a compile-time contract, not a runtime guarantee, so this
    // check against the SAME `CREATABLE_USER_ROLES` shared with
    // `CreatableUserRole` still has to run against the actual value.
    if (!(CREATABLE_USER_ROLES as readonly string[]).includes(role)) {
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

  async setActive(user: AuthTokenPayload, targetId: string, active: boolean): Promise<SetActiveResult> {
    const tenantId = requireTenant(user);
    if (targetId === user.sub && !active) {
      throw new ConflictException("You cannot deactivate your own account");
    }
    const target = await this.repository.findByIdInTenant(targetId, tenantId);
    if (!target) throw new NotFoundException(`User not found: ${targetId}`);
    await this.repository.setActive(targetId, tenantId, active);
    // Without this the guard would keep serving its cached "yes" for up to a
    // minute, and an admin who just clicked "Desactivar" reads that as the
    // button having done nothing.
    this.accountStatus.invalidate(targetId);
    return { id: targetId, active };
  }

  /**
   * Ley 29733, derecho de acceso — everything stored about one person (audit
   * 2026-08-20, M10). Tenant-scoped like every other action here: a
   * school_admin answers for their own school's people, nobody else's.
   */
  async exportPersonalData(user: AuthTokenPayload, targetId: string): Promise<PersonalDataExport> {
    const tenantId = requireTenant(user);
    const target = await this.repository.findByIdInTenant(targetId, tenantId);
    if (!target) throw new NotFoundException(`User not found: ${targetId}`);

    const authored = await this.repository.countAuthored(targetId);

    return {
      user: {
        id: target.id,
        email: target.email,
        name: target.name,
        role: target.role,
        active: target.active,
        createdAt: target.createdAt.toISOString(),
      },
      authored,
      exportedAt: new Date().toISOString(),
    };
  }

  /**
   * Ley 29733, derecho de cancelación. Not a delete, and the difference is
   * deliberate: the row anchors `created_by` on questions and exams the school
   * keeps. What goes is the person — email tombstoned, name dropped, password
   * made unusable, account deactivated.
   */
  async anonymize(user: AuthTokenPayload, targetId: string): Promise<AnonymizeUserResult> {
    const tenantId = requireTenant(user);
    if (targetId === user.sub) {
      throw new ConflictException("You cannot anonymize your own account");
    }
    const target = await this.repository.findByIdInTenant(targetId, tenantId);
    if (!target) throw new NotFoundException(`User not found: ${targetId}`);

    // Keyed by id so it stays unique against `users.email`'s global index, and
    // `.invalid` because RFC 2606 reserves it: this address can never be a
    // real inbox someone later mistakes for a contact.
    const email = `anonimizado+${targetId}@anonimo.invalid`;
    await this.repository.anonymize(targetId, tenantId, email);
    // The token in their browser outlives the row change otherwise (audit H3).
    this.accountStatus.invalidate(targetId);

    return { id: targetId, email, anonymizedAt: new Date().toISOString() };
  }

  async resetPassword(user: AuthTokenPayload, targetId: string): Promise<ResetPasswordResult> {
    const tenantId = requireTenant(user);
    const target = await this.repository.findByIdInTenant(targetId, tenantId);
    if (!target) throw new NotFoundException(`User not found: ${targetId}`);
    const temporaryPassword = generateTemporaryPassword();
    await this.repository.setPasswordHash(targetId, tenantId, await hashPassword(temporaryPassword));
    return { id: targetId, temporaryPassword };
  }
}
