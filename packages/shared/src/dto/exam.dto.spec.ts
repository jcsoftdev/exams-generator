import { EXAM_STATUSES, QUESTION_TYPES } from "./exam.dto";

describe("EXAM_STATUSES", () => {
  it("pins the lifecycle both the API and the UI render", () => {
    // The API side has a matching test (exam-contract.spec.ts) comparing
    // this to the DB enum; between the two, a status added on one side
    // alone cannot ship silently.
    expect([...EXAM_STATUSES]).toEqual(["draft", "ready"]);
  });
});

describe("QUESTION_TYPES", () => {
  it("pins the rendering modes both the API and the UI handle", () => {
    expect([...QUESTION_TYPES]).toEqual(["image", "structured"]);
  });
});
