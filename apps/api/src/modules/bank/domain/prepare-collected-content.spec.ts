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

  it("hands a promoted formula through the escaper with its dollars intact", () => {
    // The whole chain in one assertion: a scraped caret becomes a Typst
    // formula, and the escaper that runs after recognises it as one instead of
    // escaping the new dollars into printed currency signs.
    const prepared = prepareCollectedContent({
      bodyTypst: "Factorizar: ax^2 - 5ax + 6a.",
      alternatives: ["(x - 2)^2"],
    });

    expect(prepared.bodyTypst).toBe("Factorizar: $a x^2 - 5a x + 6a$.");
    expect(prepared.alternatives).toEqual(["$(x - 2)^2$"]);
  });

  it("tightens an exponent the scrape stranded away from its base", () => {
    const prepared = prepareCollectedContent({
      bodyTypst: "acelera a razon de 2m/s ² constante",
      alternatives: ["4 u ²"],
    });

    expect(prepared.bodyTypst).toBe("acelera a razon de 2m/s² constante");
    expect(prepared.alternatives).toEqual(["4 u²"]);
  });

  it("leaves content with no markup characters byte-identical", () => {
    const prepared = prepareCollectedContent({
      bodyTypst: "¿Cuántos aprobaron dos exámenes?",
      alternatives: ["24", "19"],
    });

    expect(prepared.bodyTypst).toBe("¿Cuántos aprobaron dos exámenes?");
    expect(prepared.alternatives).toEqual(["24", "19"]);
  });

  it("turns a polynomial written with Unicode exponents into a real formula", () => {
    const prepared = prepareCollectedContent({
      bodyTypst: "Un motorista adquirio D(x) = 6x⁵+ 13x⁴+ 9x² litros de petroleo.",
      alternatives: ["H(x) = 3x² + 5x + 7"],
    });

    expect(prepared.bodyTypst).toBe("Un motorista adquirio $D(x) = 6x^5+ 13x^4+ 9x^2$ litros de petroleo.");
    expect(prepared.alternatives).toEqual(["$H(x) = 3x^2 + 5x + 7$"]);
  });

  it("promotes an equation the scrape left with no exponent at all", () => {
    const prepared = prepareCollectedContent({
      bodyTypst: "Al dividir un polinomio P(x) entre 3x+2, se obtuvo como resto 5.",
      alternatives: [],
    });

    expect(prepared.bodyTypst).toBe("Al dividir un polinomio $P(x)$ entre $3x+2$, se obtuvo como resto 5.");
  });
});
