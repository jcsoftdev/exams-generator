import {
  StoragePort,
  StorageObjectNotFoundError,
} from "../../domain/ports/storage.port";

/**
 * In-process fake for `StoragePort`. Satisfies the exact same contract test
 * as the real MinIO adapter — useful for fast unit-level coverage of any
 * code that depends on StoragePort without needing a live MinIO instance.
 */
export class InMemoryStorageAdapter implements StoragePort {
  private readonly objects = new Map<string, Buffer>();

  async put(key: string, data: Buffer, _contentType: string): Promise<string> {
    this.objects.set(key, Buffer.from(data));
    return `memory://${key}`;
  }

  async get(key: string): Promise<Buffer> {
    const entry = this.objects.get(key);
    if (!entry) {
      throw new StorageObjectNotFoundError(key);
    }
    return entry;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
