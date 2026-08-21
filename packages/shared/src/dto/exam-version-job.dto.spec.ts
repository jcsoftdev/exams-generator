import { EXAM_VERSION_JOB_STATUSES } from "./exam-version-job.dto";

describe("EXAM_VERSION_JOB_STATUSES", () => {
  it("pins the lifecycle the UI has labels for", () => {
    // The API side has a matching test comparing this to the DB enum; between
    // the two, a status added on one side alone cannot ship silently.
    expect([...EXAM_VERSION_JOB_STATUSES]).toEqual([
      "pending",
      "running",
      "completed",
      "failed",
      "cancelled",
    ]);
  });
});
