import { INestApplication } from "@nestjs/common";
import request from "supertest";

export interface ExamVersionJobBody {
  readonly id: string;
  readonly status: string;
  readonly versionCount: number;
  readonly completedCount: number;
  readonly failedReason: string | null;
  readonly failedQuestionId: string | null;
}

const TERMINAL_STATUSES: readonly string[] = ["completed", "failed", "cancelled"];

/**
 * Polls `GET /exams/:examId/versions/jobs/:jobId` until the job resolves.
 *
 * `POST /exams/:examId/versions` returns 202 and hands the actual work to the
 * `exam-versions` BullMQ worker (audit P0), so every e2e that used to read
 * generated forms straight out of the POST response now has to wait for the
 * worker instead. Shared here rather than copied per spec — five suites need
 * the exact same wait.
 */
export async function waitForVersionJob(
  app: INestApplication,
  token: string,
  examId: string,
  jobId: string,
  timeoutMs = 60000,
): Promise<ExamVersionJobBody> {
  const deadline = Date.now() + timeoutMs;
  let last: ExamVersionJobBody | undefined;

  while (Date.now() < deadline) {
    const res = await request(app.getHttpServer())
      .get(`/exams/${examId}/versions/jobs/${jobId}`)
      .set("Authorization", `Bearer ${token}`);
    last = res.body as ExamVersionJobBody;
    if (TERMINAL_STATUSES.includes(last.status)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  throw new Error(
    `Exam version job ${jobId} did not reach a terminal status in time (last: ${JSON.stringify(last)})`,
  );
}

/**
 * `POST /exams/:examId/versions` + wait, asserting the job actually
 * COMPLETED. The default for specs whose subject is what generation
 * produces, not how it fails — a `failed` job surfaces its `failedReason`
 * in the thrown error instead of showing up later as a confusing empty
 * versions list.
 */
export async function generateVersionsAndWait(
  app: INestApplication,
  token: string,
  examId: string,
  versionCount?: number,
  timeoutMs?: number,
): Promise<ExamVersionJobBody> {
  const accepted = await request(app.getHttpServer())
    .post(`/exams/${examId}/versions`)
    .set("Authorization", `Bearer ${token}`)
    .send(versionCount === undefined ? {} : { versionCount })
    .expect(202);

  const enqueued = accepted.body as ExamVersionJobBody;
  const job = await waitForVersionJob(app, token, examId, enqueued.id, timeoutMs);
  if (job.status !== "completed") {
    throw new Error(
      `Exam version job ${job.id} ended as "${job.status}": ${job.failedReason ?? "no reason recorded"}`,
    );
  }
  return job;
}
