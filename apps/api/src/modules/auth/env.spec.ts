import { resolveJwtSecret } from "./env";

describe("resolveJwtSecret", () => {
  const original = process.env.JWT_SECRET;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = original;
    }
  });

  it("returns JWT_SECRET when it is set", () => {
    process.env.JWT_SECRET = "some-real-secret";

    expect(resolveJwtSecret()).toBe("some-real-secret");
  });

  it("falls back to the documented local-dev default when JWT_SECRET is unset", () => {
    delete process.env.JWT_SECRET;

    expect(resolveJwtSecret()).toBe("change-me-in-every-environment");
  });
});
