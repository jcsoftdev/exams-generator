import { describe, it, expect } from 'vitest';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { childrenOf, findFolderPath, isLeafFolder } from './folder-path';

function node(id: string, name: string, children: FolderTreeNode[] = []): FolderTreeNode {
  return {
    id,
    name,
    topicId: null,
    ownCount: 0,
    centralCount: 0,
    totalCount: 0,
    editable: true,
    children,
  };
}

const TREE: readonly FolderTreeNode[] = [
  node('colegio', 'Colegio', [
    node('mate', 'Matemática', [node('cuad', 'Ecuaciones cuadráticas')]),
    node('comu', 'Comunicación'),
  ]),
  node('preuni', 'Preuniversitario'),
];

describe('findFolderPath', () => {
  it('walks the chain from the root down to the asked folder, inclusive', () => {
    expect(findFolderPath(TREE, 'cuad').map((n) => n.name)).toEqual([
      'Colegio',
      'Matemática',
      'Ecuaciones cuadráticas',
    ]);
  });

  it('returns a single node for a root folder', () => {
    expect(findFolderPath(TREE, 'preuni').map((n) => n.id)).toEqual(['preuni']);
  });

  it('returns an empty path at the root and for an id that is not in the tree', () => {
    expect(findFolderPath(TREE, null)).toEqual([]);
    expect(findFolderPath(TREE, 'no-existe')).toEqual([]);
  });

  /**
   * A sibling appearing before the branch that holds the target used to be
   * where a naive search stopped early and reported "not found".
   */
  it('keeps searching past a sibling subtree that does not contain the target', () => {
    expect(findFolderPath(TREE, 'comu').map((n) => n.id)).toEqual(['colegio', 'comu']);
  });
});

describe('childrenOf', () => {
  it('lists the root nodes at the root', () => {
    expect(childrenOf(TREE, null).map((n) => n.id)).toEqual(['colegio', 'preuni']);
  });

  it('lists the children of a folder below the root', () => {
    expect(childrenOf(TREE, 'colegio').map((n) => n.id)).toEqual(['mate', 'comu']);
  });

  it('is empty for a leaf and for an unknown id', () => {
    expect(childrenOf(TREE, 'cuad')).toEqual([]);
    expect(childrenOf(TREE, 'no-existe')).toEqual([]);
  });
});

describe('isLeafFolder', () => {
  it('is true only when the folder exists and has no children', () => {
    expect(isLeafFolder(TREE, 'cuad')).toBe(true);
    expect(isLeafFolder(TREE, 'comu')).toBe(true);
  });

  it('is false for a folder that still has subfolders', () => {
    expect(isLeafFolder(TREE, 'mate')).toBe(false);
  });

  /** The root is not a folder, so it can never be a leaf to open. */
  it('is false at the root and for an unknown id', () => {
    expect(isLeafFolder(TREE, null)).toBe(false);
    expect(isLeafFolder(TREE, 'no-existe')).toBe(false);
  });
});
