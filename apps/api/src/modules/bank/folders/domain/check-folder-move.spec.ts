import { MAX_FOLDER_DEPTH } from "@exams-generator/shared";
import { checkFolderMove } from "./check-folder-move";

describe("checkFolderMove", () => {
  it("allows a move to an unrelated parent that leaves the subtree within the depth cap", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "p",
        descendantIds: ["f", "child"],
        targetParentDepth: 2,
        subtreeHeight: 2,
      }),
    ).toEqual({ ok: true });
  });

  it("allows a move to the root", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: null,
        descendantIds: ["f"],
        targetParentDepth: 0,
        subtreeHeight: 1,
      }),
    ).toEqual({ ok: true });
  });

  it("rejects moving a folder into itself", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "f",
        descendantIds: ["f"],
        targetParentDepth: 1,
        subtreeHeight: 1,
      }),
    ).toEqual({ ok: false, code: "folder_cycle" });
  });

  it("rejects moving a folder into one of its own descendants", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "grandchild",
        descendantIds: ["f", "child", "grandchild"],
        targetParentDepth: 3,
        subtreeHeight: 3,
      }),
    ).toEqual({ ok: false, code: "folder_cycle" });
  });

  it("rejects a move whose deepest leaf would land past level 6", () => {
    // Parent sits at level 5, subtree is 2 levels tall -> deepest leaf at 7.
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "p",
        descendantIds: ["f", "child"],
        targetParentDepth: 5,
        subtreeHeight: 2,
      }),
    ).toEqual({ ok: false, code: "folder_depth_exceeded" });
  });

  it("accepts a move that lands EXACTLY on level 6", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "p",
        descendantIds: ["f"],
        targetParentDepth: 5,
        subtreeHeight: 1,
      }),
    ).toEqual({ ok: true });
  });

  it("checks the cycle BEFORE the depth — a self-move must never report a depth error", () => {
    expect(
      checkFolderMove({
        folderId: "f",
        targetParentId: "f",
        descendantIds: ["f"],
        targetParentDepth: 9,
        subtreeHeight: 9,
      }),
    ).toEqual({ ok: false, code: "folder_cycle" });
  });

  it("pins the cap the spec fixed", () => {
    expect(MAX_FOLDER_DEPTH).toBe(6);
  });
});
