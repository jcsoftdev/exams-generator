import { validateFolderName } from "./folder-name";

describe("validateFolderName", () => {
  it("trims and accepts a normal name", () => {
    expect(validateFolderName("  Trigonometría  ")).toEqual({ ok: true, name: "Trigonometría" });
  });

  it("rejects an empty or whitespace-only name", () => {
    expect(validateFolderName("")).toEqual({ ok: false, code: "folder_name_invalid" });
    expect(validateFolderName("   ")).toEqual({ ok: false, code: "folder_name_invalid" });
  });

  it("rejects anything longer than 80 characters AFTER trimming", () => {
    // 80 spaces + 80 chars + 80 spaces trims down to exactly 80 -> valid.
    const exactly80 = "a".repeat(80);
    expect(validateFolderName(`${" ".repeat(80)}${exactly80}${" ".repeat(80)}`)).toEqual({
      ok: true,
      name: exactly80,
    });
    expect(validateFolderName("a".repeat(81))).toEqual({ ok: false, code: "folder_name_invalid" });
  });

  it("rejects a non-string — the body field is client-supplied and untyped at runtime", () => {
    expect(validateFolderName(undefined)).toEqual({ ok: false, code: "folder_name_invalid" });
    expect(validateFolderName(42)).toEqual({ ok: false, code: "folder_name_invalid" });
  });
});
