import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';

/**
 * The three questions the grid asks about the folder tree, kept as pure
 * functions so they can be tested without a TestBed and reused by both the
 * browser grid and the question list.
 *
 * The tree arrives already built and count-rolled by `toFolderTreeNodes`;
 * nothing here recomputes a total. A second place for a number is a second
 * place for it to be wrong.
 */

/**
 * The chain from a root node down to `folderId`, inclusive — what the
 * breadcrumb renders. Empty at the root and for an id that is not in the
 * tree, so a stale link simply lands back at the top instead of throwing.
 */
export function findFolderPath(
  tree: readonly FolderTreeNode[],
  folderId: string | null,
): readonly FolderTreeNode[] {
  if (folderId === null) return [];

  const walk = (nodes: readonly FolderTreeNode[]): FolderTreeNode[] | null => {
    for (const node of nodes) {
      if (node.id === folderId) return [node];
      const below = walk(node.children);
      // Only a HIT short-circuits: a miss has to keep scanning the remaining
      // siblings, or a target sitting after an unrelated subtree reads as
      // "not found".
      if (below) return [node, ...below];
    }
    return null;
  };

  return walk(tree) ?? [];
}

function findNode(tree: readonly FolderTreeNode[], folderId: string): FolderTreeNode | null {
  const path = findFolderPath(tree, folderId);
  return path.length > 0 ? path[path.length - 1] : null;
}

/** What the grid paints: the root nodes, or the children of `folderId`. */
export function childrenOf(
  tree: readonly FolderTreeNode[],
  folderId: string | null,
): readonly FolderTreeNode[] {
  if (folderId === null) return tree;
  return findNode(tree, folderId)?.children ?? [];
}

/**
 * A leaf exists and has no children — the point where drilling stops being
 * navigation and starts being a list of questions. The root is not a folder,
 * so it is never a leaf.
 */
export function isLeafFolder(
  tree: readonly FolderTreeNode[],
  folderId: string | null,
): boolean {
  if (folderId === null) return false;
  const node = findNode(tree, folderId);
  return node !== null && node.children.length === 0;
}
