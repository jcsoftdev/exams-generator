import { hashBodyTypst } from "./hash-body-typst";

describe("hashBodyTypst", () => {
  it("returns the same hash for the exact same statement", () => {
    const body = "El área de un círculo es $36 pi$ cm.";

    expect(hashBodyTypst(body)).toBe(hashBodyTypst(body));
  });

  it("returns different hashes for different statements", () => {
    expect(hashBodyTypst("¿Cuánto es 2 + 2?")).not.toBe(hashBodyTypst("¿Cuánto es 2 + 3?"));
  });

  it("ignores leading/trailing whitespace differences", () => {
    expect(hashBodyTypst("  ¿Cuánto es 2 + 2?  ")).toBe(hashBodyTypst("¿Cuánto es 2 + 2?"));
  });

  it("is a 64-char lowercase hex string (sha256)", () => {
    expect(hashBodyTypst("cualquier cosa")).toMatch(/^[0-9a-f]{64}$/);
  });
});
