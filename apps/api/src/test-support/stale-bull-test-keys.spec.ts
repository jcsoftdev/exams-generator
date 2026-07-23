import { selectStaleBullTestKeys } from "./stale-bull-test-keys";

describe("selectStaleBullTestKeys", () => {
  it("keeps a key whose embedded pid is alive", () => {
    const isPidDead = (pid: number) => pid !== 111;

    const result = selectStaleBullTestKeys(["bull-test-w1-p111-abc:generation"], isPidDead);

    expect(result).toEqual([]);
  });

  it("selects a key whose embedded pid is dead", () => {
    const isPidDead = (pid: number) => pid === 222;

    const result = selectStaleBullTestKeys(["bull-test-w1-p222-abc:generation"], isPidDead);

    expect(result).toEqual(["bull-test-w1-p222-abc:generation"]);
  });

  it("treats a key with an unparseable shape as stale", () => {
    const isPidDead = () => false;

    const result = selectStaleBullTestKeys(["bull-test-not-a-known-shape"], isPidDead);

    expect(result).toEqual(["bull-test-not-a-known-shape"]);
  });

  it("only sweeps keys from dead pids, leaving live-run keys untouched", () => {
    const isPidDead = (pid: number) => pid === 222;

    const result = selectStaleBullTestKeys(
      ["bull-test-w1-p111-abc:generation", "bull-test-w1-p222-xyz:generation"],
      isPidDead,
    );

    expect(result).toEqual(["bull-test-w1-p222-xyz:generation"]);
  });
});
