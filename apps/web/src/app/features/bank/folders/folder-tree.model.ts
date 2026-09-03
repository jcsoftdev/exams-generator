import { BankFolderNode, UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';

export const UNFILED_NODE_NAME = 'Sin carpeta';

/**
 * Wire shape -> what the tree renders.
 *
 * The server sends DIRECT counts per folder (two GROUP BY queries); the number
 * a teacher wants to see on a collapsed branch is the CUMULATIVE one, so the
 * roll-up happens here, once, instead of inside the presentational component.
 *
 * The virtual "Sin carpeta" node is appended last and only when there is
 * something in it: an always-present empty bucket is a permanent piece of
 * furniture for a state most schools never reach. It is `editable: false` — it
 * is a view over `folder_id IS NULL`, not a folder, so it has no menu, no
 * rename and no delete.
 */
export function toFolderTreeNodes(
  folders: readonly BankFolderNode[],
  unfiledCount: number,
): FolderTreeNode[] {
  const convert = (node: BankFolderNode): FolderTreeNode => {
    const children = node.children.map(convert);
    return {
      id: node.id,
      name: node.name,
      topicId: node.topicId,
      ownCount: node.ownCount,
      centralCount: node.centralCount,
      totalCount:
        node.ownCount +
        node.centralCount +
        children.reduce((sum, child) => sum + child.totalCount, 0),
      editable: true,
      children,
    };
  };

  const nodes = folders.map(convert);

  if (unfiledCount > 0) {
    nodes.push({
      id: UNFILED_FOLDER_ID,
      name: UNFILED_NODE_NAME,
      topicId: null,
      ownCount: unfiledCount,
      centralCount: 0,
      totalCount: unfiledCount,
      editable: false,
      children: [],
    });
  }

  return nodes;
}

/** Accent- and case-insensitive, so "matematica" finds "Matemática". */
function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Filters the tree by folder name. A branch survives when ITS name matches (with
 * its whole subtree intact) or when any DESCENDANT matches (keeping only the
 * matching path) — otherwise a match three levels down would be filtered out
 * along with the ancestors needed to reach it.
 *
 * Scope note: this searches FOLDER NAMES, not questions. Same honest-scope
 * decision `filterQuestionTree` documented — the questions of a collapsed
 * branch are not in the browser, so matching them here would silently mean
 * "the part you already opened".
 */
export function filterFolderTree(
  nodes: readonly FolderTreeNode[],
  query: string,
): FolderTreeNode[] {
  const needle = normalize(query);
  if (!needle) {
    return [...nodes];
  }

  const result: FolderTreeNode[] = [];
  for (const node of nodes) {
    if (normalize(node.name).includes(needle)) {
      result.push(node);
      continue;
    }
    const children = filterFolderTree(node.children, query);
    if (children.length > 0) {
      result.push({ ...node, children });
    }
  }
  return result;
}

/** Depth-first lookup over the WIRE tree — used to read a folder's `topicId`/name by id. */
export function findFolderById(
  folders: readonly BankFolderNode[],
  id: string,
): BankFolderNode | null {
  for (const folder of folders) {
    if (folder.id === id) {
      return folder;
    }
    const found = findFolderById(folder.children, id);
    if (found) {
      return found;
    }
  }
  return null;
}
