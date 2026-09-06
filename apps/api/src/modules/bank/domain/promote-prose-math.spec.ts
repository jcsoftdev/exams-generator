import { promoteProseMath } from "./promote-prose-math";

describe("promoteProseMath", () => {
  it("leaves prose holding no formula untouched", () => {
    expect(promoteProseMath("Halla la suma de los coeficientes.")).toBe(
      "Halla la suma de los coeficientes.",
    );
  });

  it("stops the run at the Spanish verb before it", () => {
    expect(promoteProseMath("Si a + b = 5 y ab = 3, hallar a^2 + b^2.")).toBe(
      "Si $a + b = 5$ y $ab = 3$, hallar $a^2 + b^2$.",
    );
  });

  it("leaves the sentence period outside the formula", () => {
    expect(promoteProseMath("Factorizar: ax^2 - 5ax + 6a.")).toBe("Factorizar: $ax^2 - 5ax + 6a$.");
  });

  it("treats a colon as a hard boundary", () => {
    expect(promoteProseMath("Identifica la conica: x^2 + 6x - 8y + 41 = 0.")).toBe(
      "Identifica la conica: $x^2 + 6x - 8y + 41 = 0$.",
    );
  });

  it("promotes two runs separated by prose", () => {
    expect(promoteProseMath("Halla el residuo al dividir x^4 entre (x^3 - x^2 - x - 1).")).toBe(
      "Halla el residuo al dividir $x^4$ entre $(x^3 - x^2 - x - 1)$.",
    );
  });

  it("refuses to swallow a two-letter word trailing the formula", () => {
    expect(promoteProseMath("mide x^2 de largo")).toBe("mide $x^2$ de largo");
  });

  it("drops a trailing Spanish conjunction that reads as a variable", () => {
    expect(promoteProseMath("las asintotas de 9x^2 - 4y^2 = 36 y la recta")).toBe(
      "las asintotas de $9x^2 - 4y^2 = 36$ y la recta",
    );
  });

  it("keeps a trailing lone variable that is not a conjunction", () => {
    expect(promoteProseMath("solucion: 1 + sen^2 x = 7 cos^2 x")).toBe(
      "solucion: $1 + sen^2 x = 7 cos^2 x$",
    );
  });

  it("keeps absolute-value bars inside the run", () => {
    expect(promoteProseMath("de la inecuacion |x^2 - 4| >= -2x + 4.")).toBe(
      "de la inecuacion $|x^2 - 4| >= -2x + 4$.",
    );
  });

  it("keeps a middle dot operator inside the run", () => {
    expect(promoteProseMath("entre d(x) = -n + x^2 · n, se obtiene")).toBe(
      "entre $d(x) = -n + x^2 · n$, se obtiene",
    );
  });

  it("refuses to bridge two clauses across a short Spanish word", () => {
    expect(promoteProseMath("Calcular (a^3 + b^3) / (a^2 + b^2) si a + b = 3.")).toBe(
      "Calcular $(a^3 + b^3) / (a^2 + b^2)$ si $a + b = 3$.",
    );
  });

  it("still reads a two-letter product as variables", () => {
    expect(promoteProseMath("Halla P = 2my^2 + ab.")).toBe("Halla $P = 2my^2 + ab$.");
  });

  it("keeps a whitelisted function name inside the run", () => {
    expect(promoteProseMath("Resolver: (sen x + cos x)^2 = 1 + cos x, indicando la suma.")).toBe(
      "Resolver: $(sen x + cos x)^2 = 1 + cos x$, indicando la suma.",
    );
  });

  it("never lets a run cross a line break", () => {
    expect(promoteProseMath("x A = 4t + 2t\nx B = 5t^2")).toBe("$x A = 4t + 2t$\n$x B = 5t^2$");
  });

  it("leaves an already authored math span alone", () => {
    expect(promoteProseMath("Sea $x^2 + 1$ el polinomio.")).toBe("Sea $x^2 + 1$ el polinomio.");
  });

  it("declines a segment carrying LaTeX backslashes", () => {
    const latex = "Determine el signo de: $\\cot 432 \\cdot \\sec^4 360$.";
    expect(promoteProseMath(latex)).toBe(latex);
  });

  it("declines a segment carrying a stray currency sign", () => {
    expect(promoteProseMath("Un capital $ 4000 crece a x^2 soles.")).toBe(
      "Un capital $ 4000 crece a x^2 soles.",
    );
  });

  it("stops at an accented word rather than absorbing it", () => {
    expect(promoteProseMath("El área x^2 mide")).toBe("El área $x^2$ mide");
  });

  describe("anchors other than a caret", () => {
    it("promotes an equation the harvest left without any exponent", () => {
      expect(promoteProseMath("Si f(x) = 2x + 3, evalue la funcion.")).toBe(
        "Si $f(x) = 2x + 3$, evalue la funcion.",
      );
    });

    it("promotes a bare function application standing in prose", () => {
      expect(promoteProseMath("Al dividir un polinomio P(x) entre 3x+2, se obtuvo resto 5")).toBe(
        "Al dividir un polinomio $P(x)$ entre $3x+2$, se obtuvo resto 5",
      );
    });

    it("promotes a run anchored on a relation symbol", () => {
      expect(promoteProseMath("el termino independiente, con a != 0 entero")).toBe(
        "el termino independiente, con $a != 0$ entero",
      );
    });

    it("promotes each side of a sentence that states two equations", () => {
      expect(promoteProseMath("Si a + b = 5 y ab = 3, hallar a^2 + b^2.")).toBe(
        "Si $a + b = 5$ y $ab = 3$, hallar $a^2 + b^2$.",
      );
    });

    it("keeps a variable named y when an operator sits beside it", () => {
      expect(promoteProseMath("Si x + y = 5, halla x")).toBe("Si $x + y = 5$, halla x");
    });

    it("reads y as a conjunction when whole terms flank it", () => {
      expect(promoteProseMath("las asintotas de 9x - 4 = 36 y la recta")).toBe(
        "las asintotas de $9x - 4 = 36$ y la recta",
      );
    });

    it("leaves prose that merely mentions a number alone", () => {
      expect(promoteProseMath("Un bebe de 10 meses recibe 1 gota por kilogramo.")).toBe(
        "Un bebe de 10 meses recibe 1 gota por kilogramo.",
      );
    });

    it("scans across the dashes a scrape leaves in place of a minus", () => {
      expect(promoteProseMath("Al dividir (x^4 – 3x^2 − 9) entre (x – 1)")).toBe(
        "Al dividir $(x^4 – 3x^2 − 9)$ entre $(x – 1)$",
      );
    });

    it("refuses a run whose caret lost its base, which math mode rejects too", () => {
      expect(promoteProseMath("Resuelve Sen^6x+Cos^6x=0,25")).toBe("Resuelve Sen^6x+Cos^6x=0,25");
    });

    it("leaves a bibliographic citation alone, since an abbreviation is not a variable", () => {
      expect(promoteProseMath("Lima: Santillana, 2013, pp. 109-227.")).toBe(
        "Lima: Santillana, 2013, pp. 109-227.",
      );
    });

    it("leaves a physical unit alone, since a slash never anchors a run", () => {
      expect(promoteProseMath("acelera a razon de 2m/s constante")).toBe(
        "acelera a razon de 2m/s constante",
      );
    });

    it("still declines a segment carrying a stray currency sign", () => {
      expect(promoteProseMath("Un capital $ 4000 crece a 5 = x soles.")).toBe(
        "Un capital $ 4000 crece a 5 = x soles.",
      );
    });
  });
});
