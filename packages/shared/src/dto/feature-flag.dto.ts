import { FeatureFlag } from "../enums/feature-flag.enum";

/**
 * The EFFECTIVE value of every flag for the signed-in user, carried on
 * `GET /auth/me`. Deliberately just booleans: a teacher or school admin
 * never sees the platform/tenant split that produced them.
 *
 * These ride on `/auth/me` rather than in the JWT because a token does not
 * refresh when the superadmin moves a switch — a flag change reaches the
 * web on its next full load.
 */
export type FeatureFlagsDto = Readonly<Record<FeatureFlag, boolean>>;

/** One row of `GET /feature-flags/platform` — the kill-switch layer. */
export interface PlatformFeatureFlagDto {
  readonly key: FeatureFlag;
  /** `true` when no row exists: absence on this layer means "nobody cut it". */
  readonly enabled: boolean;
  readonly updatedAt: string | null;
}

/**
 * One row of `GET /tenants/:id/feature-flags` — the three values kept
 * apart on purpose.
 *
 * Collapsing these into one boolean is what makes flags unsupportable:
 * switching `tenant` on while `platform` is off leaves `effective` false,
 * and an admin looking at a single toggle reading "on" cannot explain why
 * the school still gets a 403.
 */
export interface TenantFeatureFlagStateDto {
  readonly key: FeatureFlag;
  readonly platform: boolean;
  /** `null` means no override — the tenant follows the catalog default. */
  readonly tenant: boolean | null;
  readonly defaultEnabled: boolean;
  readonly effective: boolean;
}

/** Body of both `PUT` routes. */
export interface UpdateFeatureFlagDto {
  readonly enabled: boolean;
}
