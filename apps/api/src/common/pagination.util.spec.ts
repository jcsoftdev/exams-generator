import { clampPagination } from "./pagination.util";

describe("clampPagination", () => {
  it("defaults to page 1, pageSize 20 when both params are undefined", () => {
    expect(clampPagination(undefined, undefined)).toEqual({ page: 1, pageSize: 20 });
  });

  it("clamps page and pageSize up to 1 when both are '0'", () => {
    expect(clampPagination("0", "0")).toEqual({ page: 1, pageSize: 1 });
  });

  it("clamps negative page to 1 and pageSize to the 100 upper bound", () => {
    expect(clampPagination("-3", "500")).toEqual({ page: 1, pageSize: 100 });
  });

  it("defaults to page 1, pageSize 20 when params are not numeric", () => {
    expect(clampPagination("abc", "xyz")).toEqual({ page: 1, pageSize: 20 });
  });

  it("passes through valid in-range values unchanged", () => {
    expect(clampPagination("2", "50")).toEqual({ page: 2, pageSize: 50 });
  });

  it("clamps pageSize='0' to 1 independently of a valid page (mirrors ExamsController.listExams usage)", () => {
    expect(clampPagination("3", "0")).toEqual({ page: 3, pageSize: 1 });
  });
});
