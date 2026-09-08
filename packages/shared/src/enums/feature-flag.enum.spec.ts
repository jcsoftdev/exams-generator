import { FEATURE_FLAG_DEFAULTS, FEATURE_FLAG_KEYS, FeatureFlag, isFeatureFlag } from "./feature-flag.enum";

// Same reasoning as role.enum.spec.ts: these string values are a DB/wire
// contract (both flag tables' `key` column, `/auth/me`'s `features` object,
// the admin routes' `:key` segment). Pinning them here means a rename breaks
// the build for whoever renamed it, instead of orphaning stored rows.
describe("FeatureFlag", () => {
  it("keeps its member set stable", () => {
    expect(Object.keys(FeatureFlag)).toEqual([
      "GlobalBank",
      "AiGeneration",
      "AiExtraction",
      "ExamVersions",
      "TenantBranding",
    ]);
  });

  it.each([
    [FeatureFlag.GlobalBank, "global_bank"],
    [FeatureFlag.AiGeneration, "ai_generation"],
    [FeatureFlag.AiExtraction, "ai_extraction"],
    [FeatureFlag.ExamVersions, "exam_versions"],
    [FeatureFlag.TenantBranding, "tenant_branding"],
  ])("%s serializes to %j", (member, value) => {
    expect(member).toBe(value);
  });

  it("lists every key exactly once, in catalog order", () => {
    expect(FEATURE_FLAG_KEYS).toEqual(Object.values(FeatureFlag));
    expect(new Set(FEATURE_FLAG_KEYS).size).toBe(FEATURE_FLAG_KEYS.length);
  });
});

describe("FEATURE_FLAG_DEFAULTS", () => {
  // A key with no default would resolve to `undefined` and read as "off" for
  // every tenant that never got an override — the exact silent-strip this
  // catalog exists to prevent.
  it("declares a default for every key", () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(typeof FEATURE_FLAG_DEFAULTS[key]).toBe("boolean");
    }
  });

  // These specific values are the product decision, not an implementation
  // detail: what a school gets the moment it is created, before anyone
  // opens the admin screen.
  it("gives a new tenant the bank and its own branding, but nothing paid", () => {
    expect(FEATURE_FLAG_DEFAULTS).toEqual({
      global_bank: true,
      tenant_branding: true,
      ai_generation: false,
      ai_extraction: false,
      exam_versions: false,
    });
  });
});

describe("isFeatureFlag", () => {
  it("accepts every catalog key", () => {
    for (const key of FEATURE_FLAG_KEYS) {
      expect(isFeatureFlag(key)).toBe(true);
    }
  });

  it.each(["", "GLOBAL_BANK", "globalBank", "ai", "__proto__", "toString"])("rejects %j", (value) => {
    expect(isFeatureFlag(value)).toBe(false);
  });
});
