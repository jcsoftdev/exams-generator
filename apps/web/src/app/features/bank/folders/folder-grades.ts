import { GRADE_LEVELS } from '@exams-generator/shared';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { Topic } from '../../taxonomy/taxonomy.models';

/**
 * Which grades a folder can answer for, and which grades a bank uses at all.
 *
 * A folder does not carry a grade. It carries a `topicId`, and the TOPIC is
 * what is taught at one or more grades (`topic_grades`, design doc
 * 2026-09-03) — so every question here is a lookup through the topic catalog
 * rather than a field on the folder. That is also why this is pure: the grid
 * fetches the catalog once and asks these functions, instead of a second
 * server round-trip per chip.
 */
export type TopicGrades = ReadonlyMap<string, readonly string[]>;

export function topicGradesById(topics: readonly Topic[]): TopicGrades {
  return new Map(topics.map((topic) => [topic.id, topic.gradeLevels]));
}

/**
 * True when the folder — or ANYTHING under it — is tied to a topic taught at
 * this grade. Ancestors count on purpose: "Colegio" carries no topic of its
 * own, and it is still exactly where a teacher looking for 4° secundaria has
 * to click. Filtering it out would hide the road to every match below it.
 */
export function folderServesGrade(
  node: FolderTreeNode,
  grade: string,
  topicGrades: TopicGrades,
): boolean {
  const own = node.topicId === null ? [] : (topicGrades.get(node.topicId) ?? []);
  if (own.includes(grade)) {
    return true;
  }
  return node.children.some((child) => folderServesGrade(child, grade, topicGrades));
}

/**
 * Every grade the tree actually reaches, in CATALOG order — a chip row reads
 * as a school year, so 6° primaria never follows 4° secundaria just because
 * that is the order the folders happen to be in.
 */
export function gradesInUse(
  nodes: readonly FolderTreeNode[],
  topicGrades: TopicGrades,
): readonly string[] {
  const found = new Set<string>();
  const walk = (current: readonly FolderTreeNode[]): void => {
    for (const node of current) {
      if (node.topicId !== null) {
        for (const grade of topicGrades.get(node.topicId) ?? []) {
          found.add(grade);
        }
      }
      walk(node.children);
    }
  };
  walk(nodes);

  return GRADE_LEVELS.filter((grade) => found.has(grade));
}
