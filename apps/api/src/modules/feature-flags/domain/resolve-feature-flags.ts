import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_KEYS,
  FeatureFlag,
  FeatureFlagsDto,
} from "@exams-generator/shared";

/**
 * The two stored layers, as read from `platform_feature_flags` and
 * `tenant_feature_flags`. Each map holds ONLY the keys that actually have a
 * row; absence is meaningful and differs per layer (see `resolveFeatureFlag`).
 */
export interface FeatureFlagLayers {
  readonly platform: ReadonlyMap<FeatureFlag, boolean>;
  /**
   * `null` when the user has no tenant (`platform_admin`, `content_editor`).
   * That is "there is nothing to look up", NOT "the tenant granted nothing" —
   * an empty Map is the second thing and resolves very differently.
   */
  readonly tenant: ReadonlyMap<FeatureFlag, boolean> | null;
}

/**
 * The effective value of one flag.
 *
 *   with a tenant:  platform(key) AND tenant(key)
 *   without one:    platform(key)
 *
 *   platform, no row -> true                        (kill switch: nobody cut it)
 *   tenant,   no row -> FEATURE_FLAG_DEFAULTS[key]  (nobody decided; use the product default)
 *
 * The two layers having OPPOSITE defaults is deliberate, and it is the part
 * worth reading twice. Give the platform layer the tenant layer's default and
 * every feature is dark until somebody seeds rows; give the tenant layer the
 * platform layer's default and selling tiers stops working, because a school
 * gets everything the moment it is created.
 */
export function resolveFeatureFlag(key: FeatureFlag, layers: FeatureFlagLayers): boolean {
  const platform = layers.platform.get(key) ?? true;
  if (!platform) {
    return false;
  }

  if (layers.tenant === null) {
    return true;
  }

  return layers.tenant.get(key) ?? FEATURE_FLAG_DEFAULTS[key];
}

/**
 * Every catalog key at once — what `GET /auth/me` carries.
 *
 * Built by iterating the CATALOG, never the stored rows, so the answer is
 * always total (the web can index it without a fallback) and a row left over
 * from a retired key cannot leak into it.
 */
export function resolveFeatureFlags(layers: FeatureFlagLayers): FeatureFlagsDto {
  const resolved = {} as Record<FeatureFlag, boolean>;
  for (const key of FEATURE_FLAG_KEYS) {
    resolved[key] = resolveFeatureFlag(key, layers);
  }
  return resolved;
}
