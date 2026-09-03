import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, tap, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { BankFolderNode, DeleteBankFolderResponse } from '@exams-generator/shared';
import { FolderTreeNode } from '../../../ui/folder-tree/folder-tree.types';
import { BankService } from '../bank.service';
import { findFolderById, toFolderTreeNodes } from './folder-tree.model';

/** `folder_cycle`, mirroring the server's own `BankFolderErrorCode` for this case (`bank-folder.dto.ts`). */
const FOLDER_CYCLE_ERROR = 'folder_cycle';

const LOAD_ERROR = 'No se pudieron cargar las carpetas. Inténtalo de nuevo.';

/** Optimistic ids are prefixed so a `startsWith` check can tell a pending node from a real one. */
const OPTIMISTIC_PREFIX = 'optimistic:';

/** Module-level, not per-instance: safe only because `BankFoldersStore` is `providedIn: 'root'` — a single instance ever increments it. */
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

  /**
   * Client-side cycle guard runs BEFORE touching state or the network: moving
   * a folder under itself or under one of its own descendants would make the
   * subtree vanish optimistically (its new "ancestor" no longer exists at the
   * root, since it's a child of the very node being relocated) until the
   * server's `folder_cycle` came back — so this rejects the same shapes the
   * server would, without ever emitting the illegal optimistic state.
   */
  move(id: string, parentId: string | null): Observable<BankFolderNode> {
    if (parentId !== null && isWithinSubtree(this._folders(), id, parentId)) {
      return throwError(() => new Error(FOLDER_CYCLE_ERROR));
    }

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
    this._folders.set(removeNode(snapshot, id));

    return this.bankService.deleteFolder(id).pipe(
      tap((result) => this._unfiledCount.update((count) => count + result.unfiledQuestions)),
      catchError((error: HttpErrorResponse) => this.rollback(snapshot, error)),
    );
  }

  /**
   * Restores the snapshot and re-throws, so the CALLER decides what the teacher
   * sees: `bank-list` maps `folder_name_taken` to a red inline input and
   * `folder_not_found` to a full reload (another tab deleted it).
   *
   * The snapshot restore alone is only correct for an ISOLATED failure: it was
   * taken when THIS write started, so if a different write (on another node)
   * was confirmed by the server while this one was in flight, restoring it
   * verbatim would silently erase that other, already-confirmed write. The
   * snapshot restore still happens first — it keeps the UI honest the instant
   * the error lands — but `load()` immediately follows to reconcile with
   * server truth, which folds any such concurrent write back in.
   */
  private rollback(
    snapshot: readonly BankFolderNode[],
    error: HttpErrorResponse,
  ): Observable<never> {
    this._folders.set(snapshot);
    this.load();
    return throwError(() => error);
  }
}

/** True when `targetId` is `rootId` itself or lives anywhere in its subtree. */
function isWithinSubtree(
  folders: readonly BankFolderNode[],
  rootId: string,
  targetId: string,
): boolean {
  if (rootId === targetId) {
    return true;
  }
  const root = findFolderById(folders, rootId);
  return root !== null && findFolderById(root.children, targetId) !== null;
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
