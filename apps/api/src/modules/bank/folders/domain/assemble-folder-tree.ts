import { BankFolderNode } from "@exams-generator/shared";

/** One `question_folders` row, as the repository selects it. */
export interface FlatFolderRow {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly topicId: string | null;
  readonly position: number;
}

/**
 * Builds the nested tree `GET /bank/folders` returns from the flat row list
 * plus the two count maps, in memory — the same shape `buildQuestionTree`
 * already uses in the web, and for the same reason: two GROUP BY queries beat
 * one recursive query per level, and the tree of a tenant is small.
 *
 * Counts are DIRECT, never accumulated: `ownCount` is the folder's own
 * questions, `centralCount` the central-bank questions whose topic this folder
 * is linked to. Rolling them up is the web's job (`toFolderTreeNodes`) — the
 * wire carries the raw numbers so a client can present them either way without
 * a second endpoint.
 *
 * A row whose `parentId` names a folder that is not in `rows` is DROPPED, not
 * promoted to a root. Within one tenant's snapshot that can only mean the
 * parent was deleted between the two reads, and silently re-rooting an orphan
 * would show the teacher a folder in a place it never lived.
 */
export function assembleFolderTree(
  rows: readonly FlatFolderRow[],
  ownCounts: ReadonlyMap<string, number>,
  centralCountsByTopic: ReadonlyMap<string, number>,
): BankFolderNode[] {
  const childrenByParent = new Map<string | null, FlatFolderRow[]>();
  const known = new Set(rows.map((row) => row.id));

  for (const row of rows) {
    if (row.parentId !== null && !known.has(row.parentId)) {
      continue;
    }
    const siblings = childrenByParent.get(row.parentId);
    if (siblings) {
      siblings.push(row);
    } else {
      childrenByParent.set(row.parentId, [row]);
    }
  }

  const build = (parentId: string | null): BankFolderNode[] =>
    (childrenByParent.get(parentId) ?? [])
      .slice()
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"))
      .map((row) => ({
        id: row.id,
        name: row.name,
        parentId: row.parentId,
        topicId: row.topicId,
        position: row.position,
        ownCount: ownCounts.get(row.id) ?? 0,
        centralCount: row.topicId ? (centralCountsByTopic.get(row.topicId) ?? 0) : 0,
        children: build(row.id),
      }));

  return build(null);
}
