import { Role } from '@exams-generator/shared';

/**
 * LOCAL auth model shapes for apps/web.
 *
 * NOTE for TRACK A reconciliation: these mirror the fixed backend contract
 * (POST /auth/login -> { accessToken }, JWT payload -> { sub, role, tenantId }).
 * Once @exams-generator/shared exports canonical auth DTOs, replace these
 * local types with the shared ones and remove this file.
 */

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  accessToken: string;
}

export interface DecodedAccessToken {
  sub: string;
  role: Role;
  tenantId: string | null;
}
