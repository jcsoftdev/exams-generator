import { parseOpenRouterSseBuffer } from "./openrouter-sse-parser";

function chunk(content: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}`;
}

describe("parseOpenRouterSseBuffer", () => {
  it("extracts a delta event from one complete frame", () => {
    const { events, remainder } = parseOpenRouterSseBuffer(`${chunk("Hola")}\n\n`);

    expect(events).toEqual([{ type: "delta", text: "Hola" }]);
    expect(remainder).toBe("");
  });

  it("keeps an incomplete trailing frame in remainder instead of dropping it", () => {
    const { events, remainder } = parseOpenRouterSseBuffer(`${chunk("Hola")}\n\n${chunk("Mun").slice(0, 10)}`);

    expect(events).toEqual([{ type: "delta", text: "Hola" }]);
    expect(remainder).toBe(chunk("Mun").slice(0, 10));
  });

  it("ignores OpenRouter's `: OPENROUTER PROCESSING` keep-alive comment lines", () => {
    const { events } = parseOpenRouterSseBuffer(`: OPENROUTER PROCESSING\n\n${chunk("Hola")}\n\n`);

    expect(events).toEqual([{ type: "delta", text: "Hola" }]);
  });

  it("emits a done event for the [DONE] sentinel and stops before it", () => {
    const { events } = parseOpenRouterSseBuffer(`${chunk("Hola")}\n\ndata: [DONE]\n\n`);

    expect(events).toEqual([
      { type: "delta", text: "Hola" },
      { type: "done" },
    ]);
  });

  it("emits an error event when a chunk's finish_reason is 'error'", () => {
    const errorFrame = `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "error" }] })}\n\n`;

    const { events } = parseOpenRouterSseBuffer(errorFrame);

    expect(events).toEqual([
      { type: "error", message: "OpenRouter stream reported finish_reason=error" },
    ]);
  });

  it("skips a malformed data line instead of throwing", () => {
    const { events } = parseOpenRouterSseBuffer("data: not json\n\n");

    expect(events).toEqual([]);
  });

  it("returns no events for an empty buffer", () => {
    expect(parseOpenRouterSseBuffer("")).toEqual({ events: [], remainder: "" });
  });
});
