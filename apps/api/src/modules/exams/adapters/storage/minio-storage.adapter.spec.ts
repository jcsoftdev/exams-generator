import { execSync } from "node:child_process";
import { MinioStorageAdapter } from "./minio-storage.adapter";
import { runStoragePortContract } from "../../domain/ports/storage.port.contract";

/**
 * Integration test — talks to a REAL MinIO instance (the one docker-compose
 * boots as the `minio` service, default endpoint localhost:9030). If it
 * isn't reachable, the whole suite is `describe.skip`-ed (visible as
 * "skipped" in jest output, never reported as passing). See
 * `infra/docker-compose.yml`.
 */
const MINIO_CONFIG = {
  endPoint: process.env.MINIO_TEST_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_TEST_PORT ?? 9030),
  useSSL: false,
  accessKey: process.env.MINIO_TEST_ACCESS_KEY ?? "minioadmin",
  secretKey: process.env.MINIO_TEST_SECRET_KEY ?? "minioadmin",
  bucket: "exams-generator-contract-test",
};

function isMinioReachableSync(): boolean {
  try {
    execSync(
      `curl -sf -m 2 -o /dev/null http://${MINIO_CONFIG.endPoint}:${MINIO_CONFIG.port}/minio/health/live`,
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

const describeIfReachable = isMinioReachableSync() ? describe : describe.skip;

describeIfReachable("MinioStorageAdapter (real MinIO)", () => {
  runStoragePortContract(
    "MinioStorageAdapter",
    () => new MinioStorageAdapter(MINIO_CONFIG),
  );
});
