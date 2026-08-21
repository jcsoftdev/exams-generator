import { QUESTION_STATUSES } from "./bank-question.dto";

describe("QUESTION_STATUSES", () => {
  it("pins the lifecycle the UI has labels for", () => {
    // The API side has a matching test comparing this to the DB enum; between
    // the two, a status added on one side alone cannot ship silently.
    expect([...QUESTION_STATUSES]).toEqual(["draft", "approved", "archived"]);
  });
});
