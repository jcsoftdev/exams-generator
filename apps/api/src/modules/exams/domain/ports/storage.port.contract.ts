import { StoragePort, StorageObjectNotFoundError } from "./storage.port";

/**
 * Shared contract test suite — ANY `StoragePort` adapter (in-memory fake,
 * real MinIO client, ...) must satisfy every case here. Run it once per
 * adapter implementation instead of duplicating the same assertions.
 */
export interface StoragePortContractOptions {
  /** Override key generation, e.g. to add adapter-specific prefixes. */
  readonly createKey?: (suffix: string) => string;
}

export function runStoragePortContract(
  label: string,
  createAdapter: () => StoragePort,
  options: StoragePortContractOptions = {},
): void {
  const createKey =
    options.createKey ??
    ((suffix: string) => `contract-test/${suffix}-${Date.now()}-${Math.random().toString(36).slice(2)}`);

  describe(`StoragePort contract: ${label}`, () => {
    it("put() stores a buffer and returns a non-empty URL", async () => {
      const adapter = createAdapter();
      const key = createKey("put-returns-url");
      const payload = Buffer.from("hello-world");

      const url = await adapter.put(key, payload, "text/plain");

      expect(typeof url).toBe("string");
      expect(url.length).toBeGreaterThan(0);
    });

    it("get() returns exactly the bytes that were put()", async () => {
      const adapter = createAdapter();
      const key = createKey("roundtrip");
      const payload = Buffer.from("roundtrip-payload-12345");

      await adapter.put(key, payload, "application/octet-stream");
      const retrieved = await adapter.get(key);

      expect(retrieved.equals(payload)).toBe(true);
    });

    it("get() on a key that was never put() throws StorageObjectNotFoundError", async () => {
      const adapter = createAdapter();
      const key = createKey("missing");

      await expect(adapter.get(key)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    });

    it("delete() removes the object so a subsequent get() throws not-found", async () => {
      const adapter = createAdapter();
      const key = createKey("delete-me");
      await adapter.put(key, Buffer.from("temp"), "text/plain");

      await adapter.delete(key);

      await expect(adapter.get(key)).rejects.toBeInstanceOf(StorageObjectNotFoundError);
    });

    it("put() on an existing key overwrites its content", async () => {
      const adapter = createAdapter();
      const key = createKey("overwrite");
      await adapter.put(key, Buffer.from("first"), "text/plain");

      await adapter.put(key, Buffer.from("second"), "text/plain");
      const retrieved = await adapter.get(key);

      expect(retrieved.toString()).toBe("second");
    });
  });
}
