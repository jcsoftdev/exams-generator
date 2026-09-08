import { FEATURE_FLAG_KEYS, FeatureFlag } from "@exams-generator/shared";
import { resolveFeatureFlag, resolveFeatureFlags } from "./resolve-feature-flags";

const NO_ROWS = new Map<FeatureFlag, boolean>();

describe("resolveFeatureFlag", () => {
  describe("the platform layer, where absence means NOT CUT", () => {
    it("enables a key nobody has cut, even with no row anywhere", () => {
      expect(resolveFeatureFlag(FeatureFlag.GlobalBank, { platform: NO_ROWS, tenant: NO_ROWS })).toBe(true);
    });

    it("cuts a key for a tenant that explicitly granted it", () => {
      const platform = new Map([[FeatureFlag.AiGeneration, false]]);
      const tenant = new Map([[FeatureFlag.AiGeneration, true]]);

      expect(resolveFeatureFlag(FeatureFlag.AiGeneration, { platform, tenant })).toBe(false);
    });

    it("treats an explicit platform `true` the same as no row", () => {
      const platform = new Map([[FeatureFlag.GlobalBank, true]]);

      expect(resolveFeatureFlag(FeatureFlag.GlobalBank, { platform, tenant: NO_ROWS })).toBe(true);
    });
  });

  describe("the tenant layer, where absence means THE CATALOG DEFAULT", () => {
    it("falls back to the default for a key the tenant never overrode", () => {
      // global_bank defaults to true, ai_generation to false.
      expect(resolveFeatureFlag(FeatureFlag.GlobalBank, { platform: NO_ROWS, tenant: NO_ROWS })).toBe(true);
      expect(resolveFeatureFlag(FeatureFlag.AiGeneration, { platform: NO_ROWS, tenant: NO_ROWS })).toBe(
        false,
      );
    });

    it("lets an override switch a default-off key on", () => {
      const tenant = new Map([[FeatureFlag.AiGeneration, true]]);

      expect(resolveFeatureFlag(FeatureFlag.AiGeneration, { platform: NO_ROWS, tenant })).toBe(true);
    });

    it("lets an override switch a default-on key off", () => {
      const tenant = new Map([[FeatureFlag.GlobalBank, false]]);

      expect(resolveFeatureFlag(FeatureFlag.GlobalBank, { platform: NO_ROWS, tenant })).toBe(false);
    });
  });

  describe("a user with no tenant (platform_admin, content_editor)", () => {
    // `tenant: null` is "there is no tenant to look up", NOT "the tenant
    // granted nothing". Staff resolve against the kill switch alone —
    // otherwise a content_editor would lose ai_generation to a catalog
    // default meant for schools, and could no longer curate the global bank.
    it("follows the platform layer alone, ignoring catalog defaults", () => {
      expect(resolveFeatureFlag(FeatureFlag.AiGeneration, { platform: NO_ROWS, tenant: null })).toBe(true);
    });

    // The whole reason there is no blanket role exemption: AiController has
    // no RolesGuard, so a content_editor reaches the AI endpoints and
    // generates straight into the global bank. A kill switch that spared
    // staff would spare exactly the account that generates at scale.
    it("is still cut by the platform layer", () => {
      const platform = new Map([[FeatureFlag.AiGeneration, false]]);

      expect(resolveFeatureFlag(FeatureFlag.AiGeneration, { platform, tenant: null })).toBe(false);
    });
  });
});

describe("resolveFeatureFlags", () => {
  it("answers for every catalog key, never a partial object", () => {
    const resolved = resolveFeatureFlags({ platform: NO_ROWS, tenant: NO_ROWS });

    expect(Object.keys(resolved).sort()).toEqual([...FEATURE_FLAG_KEYS].sort());
    for (const key of FEATURE_FLAG_KEYS) {
      expect(typeof resolved[key]).toBe("boolean");
    }
  });

  it("gives a brand-new tenant exactly the catalog defaults", () => {
    expect(resolveFeatureFlags({ platform: NO_ROWS, tenant: NO_ROWS })).toEqual({
      global_bank: true,
      tenant_branding: true,
      ai_generation: false,
      ai_extraction: false,
      exam_versions: false,
    });
  });

  it("ignores stored rows for a key that has left the catalog", () => {
    // Retiring a key is a code change plus a cleanup migration; until that
    // migration runs, orphan rows must not leak into the answer.
    const platform = new Map([["retired_key" as FeatureFlag, false]]);
    const tenant = new Map([["retired_key" as FeatureFlag, true]]);

    const resolved = resolveFeatureFlags({ platform, tenant });

    expect(resolved).not.toHaveProperty("retired_key");
  });
});
