import { hashBodyTypst } from "./hash-body-typst";
import { prepareCollectedContent } from "./prepare-collected-content";

describe("prepareCollectedContent", () => {
  it("escapes the statement so scraped markup characters render verbatim", () => {
    const prepared = prepareCollectedContent({
      bodyTypst: "Expresar 532_(6) en base 10.",
      alternatives: ["200", "180"],
    });

    expect(prepared.bodyTypst).toBe("Expresar 532\\_(6) en base 10.");
  });

  it("escapes every alternative, not just the statement", () => {
    const prepared = prepareCollectedContent({
      bodyTypst: "hallar m + n",
      alternatives: ["1010011_(2)", "101001_(2)"],
    });

    expect(prepared.alternatives).toEqual(["1010011\\_(2)", "101001\\_(2)"]);
  });

  it("hashes the RAW statement so re-seeding still recognises rows stored before escaping existed", () => {
    const raw = "Expresar 532_(6) en base 10.";

    const prepared = prepareCollectedContent({ bodyTypst: raw, alternatives: ["200", "180"] });

    expect(prepared.bodyHash).toBe(hashBodyTypst(raw));
    expect(prepared.bodyHash).not.toBe(hashBodyTypst(prepared.bodyTypst));
  });

  it("leaves content with no markup characters byte-identical", () => {
    const prepared = prepareCollectedContent({
      bodyTypst: "¿Cuántos aprobaron dos exámenes?",
      alternatives: ["24", "19"],
    });

    expect(prepared.bodyTypst).toBe("¿Cuántos aprobaron dos exámenes?");
    expect(prepared.alternatives).toEqual(["24", "19"]);
  });
});
