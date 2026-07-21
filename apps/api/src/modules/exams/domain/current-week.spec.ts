import { computeCurrentWeek } from "./current-week";

describe("computeCurrentWeek", () => {
  it("is week 0 on the exact start date", () => {
    expect(computeCurrentWeek(new Date("2026-03-05"), 7, new Date("2026-03-05"))).toBe(0);
  });

  it("stays at week 0 for the rest of the first week", () => {
    expect(computeCurrentWeek(new Date("2026-03-05"), 7, new Date("2026-03-11"))).toBe(0);
  });

  it("advances to week 1 exactly one week length after the start", () => {
    expect(computeCurrentWeek(new Date("2026-03-05"), 7, new Date("2026-03-12"))).toBe(1);
  });

  it("advances by whole weeks over a long span (uniform week-length model)", () => {
    // The model assumes a UNIFORM week length — the real CEPRE-UNI cronograma
    // has irregular weeks around holidays (e.g. its "Semana 19" spans
    // 14-16 julio, only 3 days), so this intentionally does not assert an
    // exact match to the official calendar, only that N whole weeks after
    // the start lands on week N.
    expect(computeCurrentWeek(new Date("2026-03-05"), 7, new Date("2026-07-16"))).toBe(19);
  });

  it("clamps to 0 when `today` is before the cycle even starts", () => {
    expect(computeCurrentWeek(new Date("2026-03-05"), 7, new Date("2026-02-01"))).toBe(0);
  });

  it("supports a non-default week length", () => {
    expect(computeCurrentWeek(new Date("2026-01-01"), 14, new Date("2026-01-29"))).toBe(2);
  });

  it("is unaffected by time-of-day, only the UTC calendar day (both same UTC day, different times)", () => {
    const startsOn = new Date("2026-03-05T00:00:00Z");
    const today = new Date("2026-03-12T21:45:00Z");
    expect(computeCurrentWeek(startsOn, 7, today)).toBe(1);
  });
});
