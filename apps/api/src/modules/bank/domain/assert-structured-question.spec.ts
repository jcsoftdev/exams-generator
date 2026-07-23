import { BadRequestException } from "@nestjs/common";
import { assertStructuredQuestion } from "./assert-structured-question";

describe("assertStructuredQuestion", () => {
  it("does not throw for a structured question with a bodyTypst", () => {
    expect(() =>
      assertStructuredQuestion({ type: "structured", bodyTypst: "¿Cuánto es $1+1$?" }, "Preview"),
    ).not.toThrow();
  });

  it("throws BadRequestException for an image question", () => {
    expect(() => assertStructuredQuestion({ type: "image", bodyTypst: null }, "Preview")).toThrow(
      BadRequestException,
    );
  });

  it("throws BadRequestException for a structured question with no bodyTypst", () => {
    expect(() => assertStructuredQuestion({ type: "structured", bodyTypst: null }, "Preview")).toThrow(
      BadRequestException,
    );
  });

  it("includes the given action label in the error message", () => {
    expect(() => assertStructuredQuestion({ type: "image", bodyTypst: null }, "Question revision")).toThrow(
      "Question revision is only available for structured questions",
    );
  });
});
