import { comparePassword, hashPassword } from "./password.util";

describe("password.util", () => {
  it("hashPassword returns a hash different from the plaintext", async () => {
    const hash = await hashPassword("s3cret!");
    expect(hash).not.toBe("s3cret!");
    expect(hash.length).toBeGreaterThan(0);
  });

  it("comparePassword resolves true for the correct plaintext", async () => {
    const hash = await hashPassword("s3cret!");
    await expect(comparePassword("s3cret!", hash)).resolves.toBe(true);
  });

  it("comparePassword resolves false for the wrong plaintext", async () => {
    const hash = await hashPassword("s3cret!");
    await expect(comparePassword("wrong-password", hash)).resolves.toBe(false);
  });
});
