import { describe, it, expect } from 'vitest';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { Topic } from '../../taxonomy/taxonomy.models';
import { folderServesGrade, gradesInUse, topicGradesById } from './folder-grades';

function node(id: string, topicId: string | null, children: FolderTreeNode[] = []): FolderTreeNode {
  return {
    id,
    name: id,
    topicId,
    ownCount: 0,
    centralCount: 0,
    totalCount: 0,
    editable: true,
    children,
  };
}

function topic(id: string, gradeLevels: string[]): Topic {
  return { id, name: id, courseId: 'c1', gradeLevels } as Topic;
}

const TOPICS = [
  topic('t-frac', ['primaria_5', 'primaria_6']),
  topic('t-trig', ['secundaria_4', 'pre']),
];

const GRADES = topicGradesById(TOPICS);

const TREE: readonly FolderTreeNode[] = [
  node('colegio', null, [node('mate', null, [node('trig', 't-trig')])]),
  node('escuela', null, [node('frac', 't-frac')]),
];

describe('topicGradesById', () => {
  it('indexes every topic by id', () => {
    expect(GRADES.get('t-trig')).toEqual(['secundaria_4', 'pre']);
  });
});

describe('folderServesGrade', () => {
  it('is true for the folder whose own topic is taught at that grade', () => {
    expect(folderServesGrade(TREE[1].children[0], 'primaria_5', GRADES)).toBe(true);
  });

  /**
   * A folder is a container: "Colegio" carries no topic of its own, but it is
   * exactly where a teacher looking for 4° secundaria has to click.
   */
  it('is true for an ancestor of a folder taught at that grade', () => {
    expect(folderServesGrade(TREE[0], 'secundaria_4', GRADES)).toBe(true);
  });

  it('is false when nothing in the subtree is taught at that grade', () => {
    expect(folderServesGrade(TREE[0], 'primaria_5', GRADES)).toBe(false);
  });

  /** A folder the school made up carries no topic, so no grade can claim it. */
  it('is false for a subtree with no topics at all', () => {
    expect(folderServesGrade(node('suelta', null), 'pre', GRADES)).toBe(false);
  });
});

describe('gradesInUse', () => {
  it('lists only the grades the tree actually reaches', () => {
    expect(gradesInUse(TREE, GRADES)).toEqual([
      'primaria_5',
      'primaria_6',
      'secundaria_4',
      'pre',
    ]);
  });

  /** Chips read as a school year, so they follow the catalog's order, not the tree's. */
  it('orders them by the catalog, never by where they were found', () => {
    const reversed = [...TREE].reverse();

    expect(gradesInUse(reversed, GRADES)).toEqual([
      'primaria_5',
      'primaria_6',
      'secundaria_4',
      'pre',
    ]);
  });

  it('is empty when no folder is tied to a topic', () => {
    expect(gradesInUse([node('suelta', null)], GRADES)).toEqual([]);
  });
});
