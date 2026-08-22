import { Client } from "minio";
import { StoragePort, StorageObjectNotFoundError } from "../../domain/ports/storage.port";

export interface MinioStorageAdapterConfig {
  readonly endPoint: string;
  readonly port: number;
  readonly useSSL: boolean;
  readonly accessKey: string;
  readonly secretKey: string;
  readonly bucket: string;
}

/** Seconds a presigned GET url stays valid for. */
const PRESIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * Real StoragePort adapter backed by MinIO's S3-compatible API (the
 * `minio` docker-compose service — see infra/docker-compose.yml).
 */
export class MinioStorageAdapter implements StoragePort {
  private readonly client: Client;
  private readonly bucket: string;
  private bucketEnsured = false;

  constructor(config: MinioStorageAdapterConfig) {
    this.client = new Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
    this.bucket = config.bucket;
  }

  async put(key: string, data: Buffer, contentType: string): Promise<string> {
    await this.ensureBucket();
    await this.client.putObject(this.bucket, key, data, data.length, {
      "Content-Type": contentType,
    });
    return this.client.presignedGetObject(this.bucket, key, PRESIGNED_URL_TTL_SECONDS);
  }

  async get(key: string): Promise<Buffer> {
    await this.ensureBucket();
    try {
      const stream = await this.client.getObject(this.bucket, key);
      return await streamToBuffer(stream);
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new StorageObjectNotFoundError(key);
      }
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.ensureBucket();
    await this.client.removeObject(this.bucket, key);
  }

  /** Deliberately `listBuckets()`, not `bucketExists(this.bucket)` — this
   * bucket may not have been created yet (lazy, via `ensureBucket()`) on a
   * fresh deploy; `ping()` should only assert reachability/credentials. */
  async ping(): Promise<void> {
    await this.client.listBuckets();
  }

  private async ensureBucket(): Promise<void> {
    if (this.bucketEnsured) {
      return;
    }
    const exists = await this.client.bucketExists(this.bucket);
    if (!exists) {
      await this.client.makeBucket(this.bucket);
    }
    this.bucketEnsured = true;
  }
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: string }).code === "NoSuchKey"
  );
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
