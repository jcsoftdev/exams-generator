import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BankFolderNode, DeleteBankFolderResponse } from '@exams-generator/shared';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { BankService } from '../bank.service';
import { findFolderById, toFolderTreeNodes } from './folder-tree.model';

const LOAD_ERROR = 'No se pudieron cargar las carpetas. Inténtalo de nuevo.';

/** Optimistic ids are prefixed so a `startsWith` check can tell a pending node from a real one. */
const OPTIMISTIC_PREFIX = 'optimistic:';

let optimisticCounter = 0;

/**
 * The bank's folder tree as client state.
 *
 * `providedIn: 'root'` on purpose: `bank-list` and `bank-new` both read it, and
 * a teacher who uploads a question and lands back on the bank should not pay a
 * second `GET /bank/folders` to see the folder she just picked.
 *
 * WRITES ARE OPTIMISTIC WITH ROLLBACK. Renaming a folder is a text change on a
 * node already on screen — waiting a round-trip to show it makes the app feel
 * broken on a school connection. Every mutation snapshots the current tree,
 * applies the change locally, fires the request, and on failure restores the
 * snapshot verbatim. The snapshot is the WHOLE tree, not a reverse patch:
 * cheaper to reason about, and it cannot drift.
 */
@Injectable({ providedIn: 'root' })
export class BankFoldersStore {
  private readonly bankService = inject(BankService);

  private readonly _folders = signal<readonly BankFolderNode[]>([]);
  private readonly _unfiledCount = signal(0);
  private readonly _loading = signal(false);
  private readonly _error = signal<string | null>(null);

  readonly folders = this._folders.asReadonly();
  readonly unfiledCount = this._unfiledCount.asReadonly();
  readonly loading = this._loading.asReadonly();
  readonly error = this._error.asReadonly();

  /** The render view model: cumulative counts plus the virtual "Sin carpeta" node. */
  readonly tree = computed<readonly FolderTreeNode[]>(() =>
    toFolderTreeNodes(this._folders(), this._unfiledCount()),
  );

  load(): void {
    this._loading.set(true);
    this._error.set(null);
    this.bankService.getFolders().subscribe({
      next: (response) => {
        this._folders.set(response.folders);
        this._unfiledCount.set(response.unfiledCount);
        this._loading.set(false);
      },
      error: () => {
        this._loading.set(false);
        this._error.set(LOAD_ERROR);
      },
    });
  }

  folderName(id: string): string | null {
    return findFolderById(this._folders(), id)?.name ?? null;
  }

  folderTopicId(id: string): string | null {
    return findFolderById(this._folders(), id)?.topicId ?? null;
  }

  create(parentId: string | null, name: string): Observable<BankFolderNode> {
    const snapshot = this._folders();
    const optimistic: BankFolderNode = {
      id: `${OPTIMISTIC_PREFIX}${(optimisticCounter += 1)}`,
      name,
      parentId,
      topicId: null,
      position: Number.MAX_SAFE_INTEGER,
      ownCount: 0,
      centralCount: 0,
      children: [],
    };
    this._folders.set(insertNode(snapshot, parentId, optimistic));

    return this.bankService.createFolder({ name, parentId }).pipe(
      tap((created) =>
        // Swap the placeholder for the real row so the next action addresses a
        // real id — an optimistic id would 400 on `ParseUUIDPipe`.
        this._folders.set(replaceNode(this._folders(), optimistic.id, created)),
      ),
      catchError((error: HttpErrorResponse) => this.rollback(snapshot, error)),
    );
  }

  rename(id: string, name: string): Observable<BankFolderNode> {
    const snapshot = this._folders();
    this._folders.set(patchNode(snapshot, id, (node) => ({ ...node, name })));

    return this.bankService
      .updateFolder(id, { name })
      .pipe(catchError((error: HttpErrorResponse) => this.rollback(snapshot, error)));
  }

  move(id: string, parentId: string | null): Observable<BankFolderNode> {
    const snapshot = this._folders();
    const moving = findFolderById(snapshot, id);
    if (moving) {
      this._folders.set(insertNode(removeNode(snapshot, id), parentId, { ...moving, parentId }));
    }

    return this.bankService
      .updateFolder(id, { parentId })
      .pipe(catchError((error: HttpErrorResponse) => this.rollback(snapshot, error)));
  }

  remove(id: string): Observable<DeleteBankFolderResponse> {
    const snapshot = this._folders();
    const snapshotUnfiled = this._unfiledCount();
    this._folders.set(removeNode(snapshot, id));

    return this.bankService.deleteFolder(id).pipe(
      tap((result) => this._unfiledCount.update((count) => count + result.unfiledQuestions)),
      catchError((error: HttpErrorResponse) => {
        this._unfiledCount.set(snapshotUnfiled);
        return this.rollback(snapshot, error);
      }),
    );
  }

  /**
   * Restores the snapshot and re-throws, so the CALLER decides what the teacher
   * sees: `bank-list` maps `folder_name_taken` to a red inline input and
   * `folder_not_found` to a full reload (another tab deleted it).
   */
  private rollback(
    snapshot: readonly BankFolderNode[],
    error: HttpErrorResponse,
  ): Observable<never> {
    this._folders.set(snapshot);
    return throwError(() => error);
  }
}

/** All four helpers rebuild the branch they touch and share the rest — no mutation, ever. */
function insertNode(
  nodes: readonly BankFolderNode[],
  parentId: string | null,
  node: BankFolderNode,
): BankFolderNode[] {
  if (parentId === null) {
    return [...nodes, node];
  }
  return nodes.map((current) =>
    current.id === parentId
      ? { ...current, children: [...current.children, node] }
      : { ...current, children: insertNode(current.children, parentId, node) },
  );
}

function removeNode(nodes: readonly BankFolderNode[], id: string): BankFolderNode[] {
  return nodes
    .filter((node) => node.id !== id)
    .map((node) => ({ ...node, children: removeNode(node.children, id) }));
}

function patchNode(
  nodes: readonly BankFolderNode[],
  id: string,
  patch: (node: BankFolderNode) => BankFolderNode,
): BankFolderNode[] {
  return nodes.map((node) =>
    node.id === id ? patch(node) : { ...node, children: patchNode(node.children, id, patch) },
  );
}

function replaceNode(
  nodes: readonly BankFolderNode[],
  id: string,
  replacement: BankFolderNode,
): BankFolderNode[] {
  return nodes.map((node) =>
    node.id === id
      ? { ...replacement, children: node.children }
      : { ...node, children: replaceNode(node.children, id, replacement) },
  );
}
