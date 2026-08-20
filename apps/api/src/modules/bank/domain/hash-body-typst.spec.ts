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

  describe("questions that differ only by their figure", () => {
    // A physics/geometry bank is full of statements like "¿A qué componente
    // corresponde el símbolo de la figura?" — same words, different drawing,
    // different answer. Hashing the statement alone makes them collide, and the
    // unique index then rejects every one after the first.
    const body = "¿A qué componente corresponde el símbolo de la figura?";
    const circuitA = "a".repeat(64);
    const circuitB = "b".repeat(64);

    it("separates two identical statements carrying different figures", () => {
      expect(hashBodyTypst(body, circuitA)).not.toBe(hashBodyTypst(body, circuitB));
    });

    it("still collides when the statement AND the figure are the same", () => {
      expect(hashBodyTypst(body, circuitA)).toBe(hashBodyTypst(body, circuitA));
    });

    it("keeps the figure-less hash byte-identical to what it always was", () => {
      // The 64k rows already in the central bank were hashed without a figure;
      // adding the parameter must not invalidate a single one of them.
      expect(hashBodyTypst(body, undefined)).toBe(hashBodyTypst(body));
      expect(hashBodyTypst(body, "")).toBe(hashBodyTypst(body));
    });

    it("does not let a figure fingerprint collide with a longer statement", () => {
      // Guards against naive concatenation: body+fingerprint must not be
      // reachable by writing the fingerprint into the statement itself.
      expect(hashBodyTypst(body, circuitA)).not.toBe(hashBodyTypst(`${body}${circuitA}`));
    });
  });
});
