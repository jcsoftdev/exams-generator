import { readTranscriptionsFile } from "./restructure-image-lot";
/**
 * `--verify` and `--apply` both read `{ "transcriptions": [...] }` and both
 * used to fall back to `[]` when the key was missing. A batch written as a bare
 * array — the shape a reader reaches for first — therefore passed verification
 * with "0 compile, 0 fail" and applied nothing, while reporting success at
 * every step. Two agent runs were lost to exactly that on 2026-09-07, and each
 * one read those numbers and called the job done.
 */
describe("readTranscriptionsFile", () => {
  it("reads the batch out of the object shape the tool writes", () => {
    expect(
      readTranscriptionsFile('{"transcriptions": [{"imagePath": "a.png"}]}', "batch.json"),
    ).toEqual([{ imagePath: "a.png" }]);
  });

  it("refuses a bare array instead of silently verifying nothing", () => {
    expect(() => readTranscriptionsFile('[{"imagePath": "a.png"}]', "batch.json")).toThrow(
      /transcriptions/,
    );
  });

  it("refuses a file with no transcriptions key", () => {
    expect(() => readTranscriptionsFile('{"pending": []}', "batch.json")).toThrow(/transcriptions/);
  });

  it("refuses an empty batch, which can only be a mistake", () => {
    expect(() => readTranscriptionsFile('{"transcriptions": []}', "batch.json")).toThrow(/vacío/);
  });
});
