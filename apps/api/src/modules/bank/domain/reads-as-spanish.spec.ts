import { readsAsSpanish } from "./reads-as-spanish";

describe("readsAsSpanish", () => {
  it("accepts a Spanish exam statement", () => {
    expect(
      readsAsSpanish(
        "Halle la medida del ángulo central de un polígono regular si desde 4 vértices consecutivos se trazan 81 diagonales.",
      ),
    ).toBe(true);
  });

  it("rejects an English statement", () => {
    expect(
      readsAsSpanish("Complete the text with prepositions of time and place. Are you busy on tuesday evening?"),
    ).toBe(false);
  });

  it("rejects a French statement", () => {
    expect(readsAsSpanish("Quelles sont les affirmations vraies ? Soit f une fonction dans R.")).toBe(false);
  });

  it("rejects an English word problem that a translation pass left behind", () => {
    // This one is in the bank: a cronometría problem translated into English by
    // whoever published it, filed under Razonamiento Matemático.
    expect(
      readsAsSpanish(
        "Jorgito's clock advances 3 minutes every hour. Starting correctly at 8 a.m., what is the correct time?",
      ),
    ).toBe(false);
  });

  it("keeps a Spanish statement that quotes an English term", () => {
    // Chemistry and computing statements borrow English nouns; one loanword is
    // not a foreign statement.
    expect(
      readsAsSpanish("Señale la alternativa que define correctamente el término software en el contexto dado."),
    ).toBe(true);
  });

  it("keeps a Spanish statement about English grammar", () => {
    expect(
      readsAsSpanish("¿Cuál es la traducción correcta de la palabra the en la siguiente oración?"),
    ).toBe(true);
  });

  it("treats an empty or symbol-only statement as Spanish, since there is nothing to judge", () => {
    // An image question has no statement; refusing it here would archive the
    // whole scanned corpus.
    expect(readsAsSpanish("")).toBe(true);
    expect(readsAsSpanish("$x^2 + 1 = 0$")).toBe(true);
  });
});
