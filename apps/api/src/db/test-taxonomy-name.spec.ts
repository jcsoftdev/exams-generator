import { TEST_TAXONOMY_NAME_PATTERN, isTestTaxonomyName } from "./test-taxonomy-name";

describe("isTestTaxonomyName", () => {
  it("flags a name carrying a UUID fragment — the signature of a test factory", () => {
    expect(isTestTaxonomyName("Test Course 81b7883e-6f24-4f0e-9f0a-1b2c3d4e5f60")).toBe(true);
    expect(isTestTaxonomyName("ExamsRepo Course 0a1b2c3d-4e5f")).toBe(true);
    expect(isTestTaxonomyName("E2E Topic A 9f8e7d6c-5b4a-3210-fedc-ba9876543210")).toBe(true);
  });

  it("leaves real catalog names alone", () => {
    for (const name of [
      "Matemática",
      "Razonamiento Verbal",
      "Educación para el Trabajo",
      "Inglés como Lengua Extranjera",
      "Triángulos",
    ]) {
      expect(isTestTaxonomyName(name)).toBe(false);
    }
  });

  it("does not mistake an exam-year label for a UUID fragment", () => {
    // Harvested names carry things like "2020-1"/"2023-II" — 4 digits, not 8 hex.
    expect(isTestTaxonomyName("Prueba de Admisión 2020-1")).toBe(false);
    expect(isTestTaxonomyName("Examen General 2023-II")).toBe(false);
  });

  it("exposes the same rule as a Postgres-compatible pattern", () => {
    expect(new RegExp(TEST_TAXONOMY_NAME_PATTERN).test("81b7883e-6f24")).toBe(true);
    expect(new RegExp(TEST_TAXONOMY_NAME_PATTERN).test("Matemática")).toBe(false);
  });
});
