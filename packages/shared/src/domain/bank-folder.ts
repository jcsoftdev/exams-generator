/** The nested tree `GET /bank/folders` returns, shared with the API implementation. */
export interface BankFolderNode {
  readonly id: string;
  readonly name: string;
  readonly parentId: string | null;
  readonly topicId: string | null;
  readonly position: number;
  readonly ownCount: number;
  readonly centralCount: number;
  readonly children: BankFolderNode[];
}
