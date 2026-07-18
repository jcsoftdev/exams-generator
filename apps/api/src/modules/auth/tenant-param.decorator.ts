import { SetMetadata } from "@nestjs/common";

export const TENANT_PARAM_KEY = "tenantParam";

/**
 * Declares which route param carries the TARGET resource's tenant id, for
 * `TenantGuard` to compare against the caller's JWT `tenantId`. Defaults to
 * `"id"` (e.g. `GET /tenants/:id`) when not specified.
 */
export const TenantParam = (paramName = "id"): MethodDecorator & ClassDecorator =>
  SetMetadata(TENANT_PARAM_KEY, paramName);
