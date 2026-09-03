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

/**
 * A rejected write, pushed back DOWN so the message lands on the input that
 * caused it instead of somewhere else on the page.
 *
 * `id` is the node whose editor was submitted — the folder being renamed, or
 * the PARENT under which a new subfolder was being named (this tree only ever
 * creates UNDER a node, never at the root, so a parent id always exists). The
 * tree re-opens that same editor with the typed name intact, marks it
 * `aria-invalid` and shows `message` under it; it closes again on the next
 * accepted commit or on Escape.
 */
export interface FolderInlineError {
  readonly id: string;
  readonly message: string;
}
