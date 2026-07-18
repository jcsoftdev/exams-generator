import { MinioStorageAdapter } from "../exams/adapters/storage/minio-storage.adapter";
import { StoragePort } from "../exams/domain/ports/storage.port";

const DEFAULT_BUCKET = "exams-generator";

/**
 * Resolves the real MinIO adapter from env, mirroring the
 * `MINIO_ENDPOINT`/`MINIO_PORT`/`MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`
 * variables `infra/docker-compose.yml` sets for the `api` service. Falls
 * back to the exact `infra/env.example` local-dev defaults (port 9030,
 * `minioadmin`/`minioadmin`) the same way `db/env.ts` falls back for
 * `DATABASE_URL`.
 */
export function resolveStorageAdapter(): StoragePort {
  return new MinioStorageAdapter({
    endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
    port: Number(process.env.MINIO_PORT ?? 9030),
    useSSL: false,
    accessKey: process.env.MINIO_ROOT_USER ?? "minioadmin",
    secretKey: process.env.MINIO_ROOT_PASSWORD ?? "minioadmin",
    bucket: process.env.MINIO_BUCKET ?? DEFAULT_BUCKET,
  });
}
