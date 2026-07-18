/**
 * StoragePort — the domain/application layer never talks to MinIO/S3
 * directly. Every adapter (real MinIO client, in-memory fake for unit
 * tests, ...) implements this same contract so callers can swap the
 * backing store without touching business logic.
 */
export interface StoragePort {
  /** Stores `data` under `key`, overwriting any existing object at that
   * key, and returns a URL the object can be retrieved from. */
  put(key: string, data: Buffer, contentType: string): Promise<string>;

  /** Returns the exact bytes previously stored under `key`.
   * Throws `StorageObjectNotFoundError` if nothing was ever put() there
   * (or it was deleted). */
  get(key: string): Promise<Buffer>;

  /** Removes the object at `key`. Safe to call on a key that doesn't
   * exist. */
  delete(key: string): Promise<void>;
}

export class StorageObjectNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`Storage object not found: ${key}`);
    this.name = "StorageObjectNotFoundError";
  }
}
