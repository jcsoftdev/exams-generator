import type { Request, Response } from "express";
import { shouldCompress } from "./compression.filter";

function fakeRes(contentType: string | undefined): Response {
  return { getHeader: (name: string) => (name.toLowerCase() === "content-type" ? contentType : undefined) } as Response;
}

const anyRequest = { headers: { "accept-encoding": "gzip" }, method: "GET" } as unknown as Request;

describe("shouldCompress", () => {
  /**
   * The reason this predicate exists at all. `compression`'s default filter
   * says yes to anything `compressible()` accepts, and `compressible()`
   * accepts `text/*` — which includes `text/event-stream`. Compressing an SSE
   * response buffers it, so the progress frames the exam-version and
   * AI-generation streams push one at a time would sit in the compressor
   * instead of reaching the browser: the stream stays open and silent, which
   * is worse than an error because nothing reports it.
   */
  it("refuses to compress an SSE stream", () => {
    expect(shouldCompress(anyRequest, fakeRes("text/event-stream"))).toBe(false);
  });

  it("refuses even when the header carries parameters", () => {
    expect(shouldCompress(anyRequest, fakeRes("text/event-stream; charset=utf-8"))).toBe(false);
  });

  it("compresses ordinary JSON — the payloads this is for", () => {
    // A page of 50 bank questions carries `bodyTypst` and an `alternatives`
    // jsonb array each; that is the response worth compressing on the
    // origin→edge hop.
    expect(shouldCompress(anyRequest, fakeRes("application/json; charset=utf-8"))).toBe(true);
  });

  it("leaves already-compressed binaries alone", () => {
    // Not a special case here — `compression`'s own filter declines these.
    // Asserted so the delegation is not silently replaced by a blanket `true`.
    expect(shouldCompress(anyRequest, fakeRes("image/png"))).toBe(false);
    expect(shouldCompress(anyRequest, fakeRes("application/pdf"))).toBe(false);
  });

  it("declines when there is no Content-Type to judge", () => {
    expect(shouldCompress(anyRequest, fakeRes(undefined))).toBe(false);
  });
});
