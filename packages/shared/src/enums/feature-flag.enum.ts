/**
 * The catalog of platform features that the superadmin (`platform_admin`)
 * can switch on and off. This enum is the ONLY place a flag comes into
 * existence: neither `platform_feature_flags` nor `tenant_feature_flags`
 * defines which keys exist, they only store state for keys declared here.
 *
 * The string values are a wire/DB contract — they land in both flag tables'
 * `key` column, in `GET /auth/me`'s `features` object, and in the admin
 * routes' path segment. Renaming a member without a data migration orphans
 * every stored row for that key.
 */
export enum FeatureFlag {
  /** See and use central-bank questions (`questions.tenant_id IS NULL`). */
  GlobalBank = "global_bank",
  /** Generate and revise questions with AI, both streaming and durable jobs. */
  AiGeneration = "ai_generation",
  /** Pull questions out of a photo: OCR, extraction and figure cropping. */
  AiExtraction = "ai_extraction",
  /** Generate shuffled versions of a confirmed exam. */
  ExamVersions = "exam_versions",
  /** Print the school's own logo on generated PDFs. */
  TenantBranding = "tenant_branding",
}

/**
 * Every key, in catalog order. Iterate THIS rather than `Object.values` so
 * the order the admin screen renders is the order declared above, not
 * whatever order the enum happens to be compiled into.
 */
export const FEATURE_FLAG_KEYS = [
  FeatureFlag.GlobalBank,
  FeatureFlag.AiGeneration,
  FeatureFlag.AiExtraction,
  FeatureFlag.ExamVersions,
  FeatureFlag.TenantBranding,
] as const;

/**
 * What a tenant gets when it has NO row of its own for a key.
 *
 * This default living in code, not in the database, is load-bearing.
 * `TenantsService.create` is a bare insert with no hook, the dev seed
 * creates its demo tenant the same way, and the e2e specs insert tenants
 * directly — so any design where "no row" meant "off" would silently strip
 * every new tenant, every fresh database and the whole e2e lane. A row in
 * `tenant_feature_flags` exists ONLY where somebody decided something other
 * than the value below.
 *
 * Note this is the TENANT layer's default. The platform layer's default is
 * the opposite (absent = enabled) because that layer is a kill switch:
 * absence there means "nobody cut this", not "nobody granted this".
 */
export const FEATURE_FLAG_DEFAULTS: Readonly<Record<FeatureFlag, boolean>> = {
  [FeatureFlag.GlobalBank]: true,
  [FeatureFlag.AiGeneration]: false,
  [FeatureFlag.AiExtraction]: false,
  [FeatureFlag.ExamVersions]: false,
  [FeatureFlag.TenantBranding]: true,
};

/** Type guard for the untrusted `:key` path segment on the admin routes. */
export function isFeatureFlag(value: string): value is FeatureFlag {
  return (FEATURE_FLAG_KEYS as readonly string[]).includes(value);
}
