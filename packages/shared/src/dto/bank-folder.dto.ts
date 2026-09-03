/**
 * Sentinel `folderId` for `GET /bank/questions?folderId=unfiled` — the tenant's
 * own questions with no folder. A sentinel rather than a second query param so
 * the web has ONE selection type (a folder id) for every node of the tree,
 * including the virtual "Sin carpeta" one.
 */
export const UNFILED_FOLDER_ID = "unfiled";

/** A root folder is level 1, so this allows five levels of nesting under a root. */
export const MAX_FOLDER_DEPTH = 6;

/** Characters allowed in a folder name, counted AFTER trimming. */
export const MAX_FOLDER_NAME_LENGTH = 80;

/**
 * Stable error codes for the folder endpoints, carried as `code` in the error
 * body (`{ statusCode, code, message }` — the shape `ai.controller.ts` already
 * uses for `ai_not_configured`). They live in `shared` because the web
 * discriminates on them: `folder_name_taken` marks the inline input red,
 * `folder_not_found` triggers a full tree reload (another tab deleted it),
 * and everything else is a plain message.
 */
export const BANK_FOLDER_ERROR_CODES = [
  "folder_name_invalid",
  "folder_name_taken",
  "folder_cycle",
  "folder_depth_exceeded",
  "folder_not_found",
  "tenant_required",
  "central_question_has_no_folder",
] as const;

export type BankFolderErrorCode = (typeof BANK_FOLDER_ERROR_CODES)[number];

/**
 * One node of `GET /bank/folders`.
 *
 * `ownCount` and `centralCount` are DIRECT counts of this folder only, never
 * rolled up over the subtree: the server computes them with two GROUP BY
 * queries, and the client sums whichever way it wants to display. `topicId` is
 * non-null only on a folder seeded from a topic; it is what makes central-bank
 * questions of that topic appear inside the folder without belonging to it.
 */
export interface BankFolderNode {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly topicId: string | null;
  readonly position: number;
  /** Tenant-owned questions whose `folderId` is this folder. */
  readonly ownCount: number;
  /** Central-bank questions whose `topicId` equals this folder's `topicId`. 0 when `topicId` is null. */
  readonly centralCount: number;
  readonly children: readonly BankFolderNode[];
}

export interface BankFoldersResponse {
  /** Roots, ordered by `position`. */
  readonly folders: readonly BankFolderNode[];
  /** Tenant-owned questions with no folder — the virtual "Sin carpeta" node's count. */
  readonly unfiledCount: number;
}

export interface CreateBankFolderDto {
  readonly name: string;
  /** Omitted or `null` creates a root folder. */
  readonly parentId?: string | null;
}

/** Every field optional: this one body renames, moves, or does both. `parentId: null` moves to the root. */
export interface UpdateBankFolderDto {
  readonly name?: string;
  readonly parentId?: string | null;
}

export interface DeleteBankFolderResponse {
  /** Folders removed, counting the one addressed plus its whole subtree. */
  readonly deletedFolders: number;
  /** Tenant-owned questions left with `folderId: null`. Drives the post-delete banner. */
  readonly unfiledQuestions: number;
}
