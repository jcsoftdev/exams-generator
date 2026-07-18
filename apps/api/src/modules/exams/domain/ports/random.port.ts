/**
 * RandomPort — the domain never calls `Math.random()` directly.
 * Every function that needs randomness (shuffling, sampling) receives an
 * `Rng` so behaviour is deterministic and reproducible under test.
 */
export type Rng = () => number;

/**
 * mulberry32 — small, fast, seedable PRNG.
 * Not cryptographically secure; fine for exam shuffling/sampling.
 * Same seed -> same sequence, always. That determinism is the whole point:
 * it lets property tests replay a scenario exactly.
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;

  return function rng(): number {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle driven by an injected Rng. Pure: returns a new array,
 * never mutates the input.
 */
export function shuffleArray<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
