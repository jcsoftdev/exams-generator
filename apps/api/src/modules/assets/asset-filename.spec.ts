import { pdfDownloadFilename } from "./asset-filename";

describe("pdfDownloadFilename", () => {
  it("uses the storage key's basename when it already names a pdf", () => {
    expect(pdfDownloadFilename("exams/e1/versions/A/exam.pdf", "asset-1")).toBe("exam.pdf");
  });

  it("falls back to the asset id when the key has no basename at all", () => {
    expect(pdfDownloadFilename("exams/e1/versions/A/", "asset-1")).toBe("asset-1.pdf");
  });

  it("falls back when the basename is not a pdf — the extension must match what we serve", () => {
    expect(pdfDownloadFilename("uploads/scan", "asset-1")).toBe("asset-1.pdf");
    expect(pdfDownloadFilename("uploads/scan.png", "asset-1")).toBe("asset-1.pdf");
  });

  /**
   * The value lands inside a quoted `Content-Disposition` string, so a
   * double quote would close it early and a CR/LF would split the response
   * into a forged second header. `storage_key` is server-built for the exam
   * PDFs this serves today, but it is a `text` column with no constraint —
   * the header builder must not depend on that staying true.
   */
  it("never emits a quote, a backslash or a newline", () => {
    expect(pdfDownloadFilename('ev"il.pdf', "asset-1")).toBe("asset-1.pdf");
    expect(pdfDownloadFilename("ev\r\nX-Injected: 1.pdf", "asset-1")).toBe("asset-1.pdf");
    expect(pdfDownloadFilename("back\\slash.pdf", "asset-1")).toBe("asset-1.pdf");
  });

  it("keeps a spaced ASCII name", () => {
    expect(pdfDownloadFilename("exams/e1/Examen Forma A.pdf", "asset-1")).toBe("Examen Forma A.pdf");
  });

  /**
   * Not a limitation worth hiding: HTTP header values are ISO-8859-1, so a
   * UTF-8 name needs RFC 6266's `filename*` form. Falling back beats emitting
   * a name browsers decode three different ways. No key this route serves is
   * non-ASCII today.
   */
  it("falls back on a non-ASCII name instead of gambling on the header encoding", () => {
    expect(pdfDownloadFilename("exams/e1/Examen Área II.pdf", "asset-1")).toBe("asset-1.pdf");
  });

  it("falls back on an empty or whitespace-only key", () => {
    expect(pdfDownloadFilename("", "asset-1")).toBe("asset-1.pdf");
    expect(pdfDownloadFilename("   ", "asset-1")).toBe("asset-1.pdf");
  });
});
