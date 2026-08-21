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

  it("strips the answer key a scrape glued onto an alternative", () => {
    const prepared = prepareCollectedContent({
      bodyTypst: "¿Quién gobernó el Perú en 1956?",
      alternatives: ["Agustín Gamarra", 'Manuel Prado y Ugarteche. Rpta.: "A" Ver respuesta correcta'],
    });

    expect(prepared.alternatives).toEqual(["Agustín Gamarra", "Manuel Prado y Ugarteche."]);
  });

  it("keeps the hash keyed off the raw statement even when an alternative was stripped", () => {
    // The hash is the collected seeder's only dedup key; cleaning an option
    // must never repin it, or the next boot re-inserts the whole bank.
    const raw = "¿Quién gobernó el Perú en 1956?";

    const prepared = prepareCollectedContent({
      bodyTypst: raw,
      alternatives: ['Manuel Prado y Ugarteche. Rpta.: "A"'],
    });

    expect(prepared.bodyHash).toBe(hashBodyTypst(raw));
  });

  it("cuts the previous exercise's block off a scraped statement", () => {
    const prepared = prepareCollectedContent({
      bodyTypst: "FÚTBOL\n\nTexto:\nA) palabra\nB) frase\nSOLUCIÓN: Se denomina texto… Rpta. C",
      alternatives: ["arquero", "futbolista"],
    });

    expect(prepared.bodyTypst).toBe("FÚTBOL");
  });

  it("keeps hashing the RAW statement even when the stored one was cleaned", () => {
    // Same reason as the escaping: the hash is the dedup key, and repinning it
    // would re-insert the whole bank on the next boot.
    const raw = "FÚTBOL\n\nTexto:\nA) palabra\nSOLUCIÓN: … Rpta. C";

    const prepared = prepareCollectedContent({ bodyTypst: raw, alternatives: ["arquero"] });

    expect(prepared.bodyHash).toBe(hashBodyTypst(raw));
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
