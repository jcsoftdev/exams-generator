import { assembleFolderTree, FlatFolderRow } from "./assemble-folder-tree";

const ROWS: FlatFolderRow[] = [
  { id: "pre", name: "Preuniversitario", parentId: null, topicId: null, position: 1 },
  { id: "col", name: "Colegio", parentId: null, topicId: null, position: 0 },
  { id: "mat", name: "Matemática", parentId: "col", topicId: null, position: 0 },
  { id: "tri4", name: "Trigonometría · 4° secundaria", parentId: "mat", topicId: "t-4", position: 0 },
  { id: "tri5", name: "Trigonometría · 5° secundaria", parentId: "mat", topicId: "t-5", position: 1 },
];

describe("assembleFolderTree", () => {
  it("nests children under their parent and sorts every level by position", () => {
    const tree = assembleFolderTree(ROWS, new Map(), new Map());

    expect(tree.map((node) => node.name)).toEqual(["Colegio", "Preuniversitario"]);
    expect(tree[0]!.children.map((node) => node.name)).toEqual(["Matemática"]);
    expect(tree[0]!.children[0]!.children.map((node) => node.id)).toEqual(["tri4", "tri5"]);
  });

  it("attaches own counts by folder id and central counts by topic id", () => {
    const tree = assembleFolderTree(
      ROWS,
      new Map([["tri4", 7]]),
      new Map([
        ["t-4", 30],
        ["t-5", 12],
      ]),
    );
    const [tri4, tri5] = tree[0]!.children[0]!.children;

    expect({ own: tri4!.ownCount, central: tri4!.centralCount }).toEqual({ own: 7, central: 30 });
    expect({ own: tri5!.ownCount, central: tri5!.centralCount }).toEqual({ own: 0, central: 12 });
  });

  it("gives a folder with no topicId a centralCount of 0 — a central question lives in exactly one topic folder", () => {
    const tree = assembleFolderTree(ROWS, new Map(), new Map([["t-4", 30]]));
    expect(tree[0]!.children[0]!.centralCount).toBe(0);
  });

  it("counts are DIRECT, never rolled up — the web sums the subtree itself", () => {
    const tree = assembleFolderTree(ROWS, new Map([["tri4", 7]]), new Map());
    expect(tree[0]!.ownCount).toBe(0);
    expect(tree[0]!.children[0]!.ownCount).toBe(0);
  });

  it("drops a row whose parent is missing instead of losing it into a phantom root", () => {
    const orphan: FlatFolderRow = {
      id: "ghost",
      name: "Huérfana",
      parentId: "does-not-exist",
      topicId: null,
      position: 0,
    };
    const tree = assembleFolderTree([...ROWS, orphan], new Map(), new Map());
    expect(tree.map((node) => node.id)).toEqual(["col", "pre"]);
  });

  it("returns an empty array for an empty tenant", () => {
    expect(assembleFolderTree([], new Map(), new Map())).toEqual([]);
  });
});
