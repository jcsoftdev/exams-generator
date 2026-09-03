import { describe, it, expect } from 'vitest';
import { BankFolderNode, UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { filterFolderTree, findFolderById, toFolderTreeNodes } from './folder-tree.model';

function wire(partial: Partial<BankFolderNode> & { id: string; name: string }): BankFolderNode {
  return {
    parentId: partial.parentId ?? null,
    topicId: partial.topicId ?? null,
    position: partial.position ?? 0,
    ownCount: partial.ownCount ?? 0,
    centralCount: partial.centralCount ?? 0,
    children: partial.children ?? [],
    ...partial,
  };
}

const FOLDERS: BankFolderNode[] = [
  wire({
    id: 'colegio',
    name: 'Colegio',
    children: [
      wire({
        id: 'mate',
        name: 'Matemática',
        parentId: 'colegio',
        children: [
          wire({
            id: 'trigo',
            name: 'Trigonometría',
            parentId: 'mate',
            topicId: 't-1',
            ownCount: 2,
            centralCount: 40,
          }),
        ],
      }),
    ],
  }),
];

describe('toFolderTreeNodes', () => {
  it('rolls the counts up: a parent shows its whole subtree', () => {
    const [colegio] = toFolderTreeNodes(FOLDERS, 0);
    expect(colegio.totalCount).toBe(42);
    expect(colegio.children[0]!.totalCount).toBe(42);
    expect(colegio.children[0]!.children[0]!.totalCount).toBe(42);
  });

  it('keeps the direct counts untouched alongside the cumulative one', () => {
    const trigo = toFolderTreeNodes(FOLDERS, 0)[0]!.children[0]!.children[0]!;
    expect({ own: trigo.ownCount, central: trigo.centralCount }).toEqual({ own: 2, central: 40 });
  });

  it('appends the virtual "Sin carpeta" node LAST when there are unfiled questions', () => {
    const nodes = toFolderTreeNodes(FOLDERS, 7);
    const last = nodes[nodes.length - 1]!;

    expect(last).toMatchObject({
      id: UNFILED_FOLDER_ID,
      name: 'Sin carpeta',
      editable: false,
      totalCount: 7,
      ownCount: 7,
      centralCount: 0,
      topicId: null,
    });
  });

  it('omits the virtual node entirely when nothing is unfiled', () => {
    expect(toFolderTreeNodes(FOLDERS, 0).map((node) => node.id)).toEqual(['colegio']);
  });

  it('marks every real folder editable', () => {
    expect(toFolderTreeNodes(FOLDERS, 0)[0]!.editable).toBe(true);
  });
});

describe('filterFolderTree', () => {
  it('returns the tree unchanged for a blank query', () => {
    const nodes = toFolderTreeNodes(FOLDERS, 3);
    expect(filterFolderTree(nodes, '   ')).toEqual(nodes);
  });

  it('keeps a branch when a DESCENDANT matches, so the match stays reachable', () => {
    const result = filterFolderTree(toFolderTreeNodes(FOLDERS, 0), 'trigo');
    expect(result.map((node) => node.id)).toEqual(['colegio']);
    expect(result[0]!.children[0]!.children.map((node) => node.id)).toEqual(['trigo']);
  });

  it('keeps a whole subtree when the branch ITSELF matches', () => {
    const result = filterFolderTree(toFolderTreeNodes(FOLDERS, 0), 'matem');
    expect(result[0]!.children[0]!.children.map((node) => node.id)).toEqual(['trigo']);
  });

  it('is accent- and case-insensitive', () => {
    expect(filterFolderTree(toFolderTreeNodes(FOLDERS, 0), 'MATEMATICA')).toHaveLength(1);
  });

  it('drops everything when nothing matches', () => {
    expect(filterFolderTree(toFolderTreeNodes(FOLDERS, 0), 'zzz')).toEqual([]);
  });
});

describe('findFolderById', () => {
  it('finds a nested folder', () => {
    expect(findFolderById(FOLDERS, 'trigo')?.topicId).toBe('t-1');
  });

  it('returns null for an unknown id', () => {
    expect(findFolderById(FOLDERS, 'nope')).toBeNull();
  });
});
