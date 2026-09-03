/**
 * A node as the tree RENDERS it — not the wire shape. The API sends direct
 * counts (`ownCount`/`centralCount` of that folder only); `totalCount` is the
 * cumulative sum over the subtree, computed by whoever builds this view model
 * (`toFolderTreeNodes` in the bank feature). The primitive does no arithmetic
 * of its own: a presentational component that recomputes totals is a second
 * place for the number to be wrong.
 */
export interface FolderTreeNode {
  readonly id: string;
  readonly name: string;
  readonly topicId: string | null;
  readonly ownCount: number;
  readonly centralCount: number;
  readonly totalCount: number;
  /** `false` for the virtual "Sin carpeta" node: it is a view of unfiled questions, not a folder. */
  readonly editable: boolean;
  readonly children: readonly FolderTreeNode[];
}

/**
 * `browse` is the bank's own tree: counts, per-folder menu, inline rename,
 * delete. `pick` is the folder chooser embedded in a question form or the
 * upload page: selection only — no actions, no central counts, nothing that
 * could mutate the tree from inside a form.
 */
export type FolderTreeMode = 'browse' | 'pick';

export interface FolderRenameEvent {
  readonly id: string;
  readonly name: string;
}

export interface FolderCreateEvent {
  /** `null` creates a root folder. */
  readonly parentId: string | null;
  readonly name: string;
}
