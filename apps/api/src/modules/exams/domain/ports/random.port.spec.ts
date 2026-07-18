import { createSeededRng, shuffleArray } from "./random.port";

describe("createSeededRng", () => {
  it("returns floats in [0, 1) for every draw", () => {
    const rng = createSeededRng(42);
    for (let i = 0; i < 100; i++) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("is deterministic: same seed produces the same sequence", () => {
    const rngA = createSeededRng(1234);
    const rngB = createSeededRng(1234);

    const sequenceA = Array.from({ length: 20 }, () => rngA());
    const sequenceB = Array.from({ length: 20 }, () => rngB());

    expect(sequenceA).toEqual(sequenceB);
  });

  it("different seeds produce different sequences", () => {
    const rngA = createSeededRng(1);
    const rngB = createSeededRng(2);

    const sequenceA = Array.from({ length: 10 }, () => rngA());
    const sequenceB = Array.from({ length: 10 }, () => rngB());

    expect(sequenceA).not.toEqual(sequenceB);
  });
});

describe("shuffleArray", () => {
  it("returns a permutation containing the same elements", () => {
    const rng = createSeededRng(7);
    const input = ["a", "b", "c", "d", "e"];

    const shuffled = shuffleArray(input, rng);

    expect(shuffled).toHaveLength(input.length);
    expect([...shuffled].sort()).toEqual([...input].sort());
  });

  it("does not mutate the input array", () => {
    const rng = createSeededRng(7);
    const input = ["a", "b", "c"];
    const inputCopy = [...input];

    shuffleArray(input, rng);

    expect(input).toEqual(inputCopy);
  });

  it("is deterministic under a fixed seed", () => {
    const input = ["a", "b", "c", "d", "e", "f"];

    const first = shuffleArray(input, createSeededRng(99));
    const second = shuffleArray(input, createSeededRng(99));

    expect(first).toEqual(second);
  });
});
