import { folderNameForTopic, validateFolderName } from "./folder-name";

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

describe("folderNameForTopic", () => {
  /**
   * Mirrors `topicDisplayName` in apps/web/src/app/features/bank/bank-list/
   * bank-list.component.ts — the suffix appears ONLY when a sibling topic of
   * the same course carries the exact same name, and only if the topic has a
   * grade to disambiguate with.
   */
  it("leaves a unique topic name bare", () => {
    const siblings = [{ name: "Longitud de arco" }, { name: "Identidades" }];
    expect(folderNameForTopic({ name: "Longitud de arco", gradeLevel: "pre" }, siblings)).toBe(
      "Longitud de arco",
    );
  });

  it("appends ' · <grade label>' when a sibling shares the name", () => {
    const siblings = [{ name: "Trigonometría" }, { name: "Trigonometría" }];
    expect(
      folderNameForTopic({ name: "Trigonometría", gradeLevel: "secundaria_4" }, siblings),
    ).toBe("Trigonometría · 4° secundaria");
  });

  it("stays bare when the name is shared but the topic has no grade", () => {
    const siblings = [{ name: "Trigonometría" }, { name: "Trigonometría" }];
    expect(folderNameForTopic({ name: "Trigonometría", gradeLevel: null }, siblings)).toBe(
      "Trigonometría",
    );
  });
});
