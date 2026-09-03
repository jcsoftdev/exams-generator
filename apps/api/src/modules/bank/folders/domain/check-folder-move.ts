import { MAX_FOLDER_DEPTH } from "@exams-generator/shared";

export type FolderMoveResult =
  { readonly ok: true } | { readonly ok: false; readonly code: "folder_cycle" | "folder_depth_exceeded" };

export interface CheckFolderMoveParams {
  readonly folderId: string;
  /** `null` = move to the root. */
  readonly targetParentId: string | null;
  /** The folder itself PLUS every descendant, from the repository's recursive CTE. */
  readonly descendantIds: readonly string[];
  /** Level of the target parent (1 for a root folder). `0` when moving to the root. */
  readonly targetParentDepth: number;
  /** Levels the moved subtree occupies, counting the folder itself (a leaf is 1). */
  readonly subtreeHeight: number;
}

/**
 * The two structural rules a move has to satisfy, as one pure decision so the
 * service does the SQL and this does the thinking.
 *
 * Cycle is checked FIRST and deliberately: moving a folder into its own
 * descendant is also, usually, a depth violation, and reporting
 * `folder_depth_exceeded` for it would send the teacher off to shorten a path
 * that was never the problem.
 */
export function checkFolderMove(params: CheckFolderMoveParams): FolderMoveResult {
  const { targetParentId, descendantIds, targetParentDepth, subtreeHeight } = params;

  if (targetParentId !== null && descendantIds.includes(targetParentId)) {
    return { ok: false, code: "folder_cycle" };
  }

  if (targetParentDepth + subtreeHeight > MAX_FOLDER_DEPTH) {
    return { ok: false, code: "folder_depth_exceeded" };
  }

  return { ok: true };
}
