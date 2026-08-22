import { isRoundSolidQuestion } from "./is-round-solid-question";

describe("isRoundSolidQuestion", () => {
  it("recognises a solid-of-revolution problem filed under a plane topic", () => {
    // All four are real rows found under Geometría → Triángulos / Circunferencia.
    for (const body of [
      "Rogelio calcula la variación porcentual del volumen de un cono generado por un triángulo rectángulo isósceles",
      "Un cilindro inscrito en un prisma recto cuyas bases son triángulos rectángulos. El volumen del cilindro, en m3, es:",
      "Los volúmenes de dos conos cuyas bases son iguales están en la relación de 5 a 7",
      "El desarrollo de la superficie lateral de un cono de revolución es un sector circular. Determine el volumen del cono",
    ]) {
      expect(isRoundSolidQuestion(body)).toBe(true);
    }
  });

  it("leaves a physics problem that merely mentions spheres alone", () => {
    // Real row under Segmentos y Ángulos: projectile motion, not solid geometry.
    expect(
      isRoundSolidQuestion(
        "Dos esferas saliendo de la superficie horizontal de una mesa con rapideces de 3 y 8m/s; y caen al piso. Calcula la altura de la mesa",
      ),
    ).toBe(false);
  });

  it("leaves a triangle problem that merely uses trigonometry alone", () => {
    // The 25 rows the audit read as misfiled trigonometry: triangle problems.
    expect(isRoundSolidQuestion("En un triángulo reduce: abcSenA(CtgB +CtgC)")).toBe(false);
    expect(
      isRoundSolidQuestion(
        "Si el perímetro del triángulo ABC es 24 y el circunradio mide 5. Halla: SenA + SenB + SenC",
      ),
    ).toBe(false);
  });

  it("needs the solid, not just the measure", () => {
    expect(isRoundSolidQuestion("Calcule el volumen de un prisma recto de base cuadrada")).toBe(false);
  });

  it("does not fire on a word that merely contains a solid's name", () => {
    expect(isRoundSolidQuestion("El volumen de conocimiento del alumno")).toBe(false);
  });
});
