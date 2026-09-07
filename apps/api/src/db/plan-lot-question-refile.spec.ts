import { planLotQuestionRefile } from "./plan-lot-question-refile";

/**
 * A harvested question's filing is a guess until somebody reads it: for a baked
 * image the harvest knew only the exam's section heading, so the topic under it
 * was arbitrary. Correcting one means editing its lot entry — but the seeder
 * only ever INSERTS, so the row already in the bank keeps the old topic forever
 * and the correction needs a hand-run script on the server.
 *
 * This is the decision half of the pass that closes that gap, so a re-filing
 * ships as a data change and nothing else.
 */
describe("planLotQuestionRefile", () => {
  const topicIds = new Map([
    ["Álgebra|Polinomios", "topic-polinomios"],
    ["Razonamiento Matemático|Planteo de Ecuaciones", "topic-planteo"],
  ]);

  it("moves a seeded question to the topic its lot entry now names", () => {
    const plan = planLotQuestionRefile({
      entries: [
        {
          sourceName: "UNCP, Álgebra, pregunta 66",
          courseName: "Razonamiento Matemático",
          topicName: "Planteo de Ecuaciones",
        },
      ],
      seeded: [{ id: "q-66", sourceName: "UNCP, Álgebra, pregunta 66", topicId: "topic-polinomios" }],
      topicIds,
    });

    expect(plan.moves).toEqual([{ questionId: "q-66", topicId: "topic-planteo" }]);
    expect(plan.unresolved).toEqual([]);
  });

  it("leaves a question already filed where its lot says", () => {
    const plan = planLotQuestionRefile({
      entries: [
        { sourceName: "UNCP, Álgebra, pregunta 4", courseName: "Álgebra", topicName: "Polinomios" },
      ],
      seeded: [{ id: "q-4", sourceName: "UNCP, Álgebra, pregunta 4", topicId: "topic-polinomios" }],
      topicIds,
    });

    expect(plan.moves).toEqual([]);
  });

  it("ignores a lot entry nothing in the bank matches", () => {
    const plan = planLotQuestionRefile({
      entries: [
        { sourceName: "todavía sin sembrar", courseName: "Álgebra", topicName: "Polinomios" },
      ],
      seeded: [],
      topicIds,
    });

    expect(plan.moves).toEqual([]);
    expect(plan.unresolved).toEqual([]);
  });

  /**
   * A pair the taxonomy does not have cannot be resolved to a topic id, and
   * guessing the nearest one would file the question somewhere nobody chose.
   * It is reported so a typo in a lot surfaces instead of going quiet.
   */
  it("reports a course and topic the taxonomy does not have, and moves nothing", () => {
    const plan = planLotQuestionRefile({
      entries: [
        {
          sourceName: "UNCP, Álgebra, pregunta 66",
          courseName: "Álgebra",
          topicName: "Tema Inventado",
        },
      ],
      seeded: [{ id: "q-66", sourceName: "UNCP, Álgebra, pregunta 66", topicId: "topic-polinomios" }],
      topicIds,
    });

    expect(plan.moves).toEqual([]);
    expect(plan.unresolved).toEqual(["Álgebra > Tema Inventado"]);
  });

  it("reports one unresolved pair once, however many questions name it", () => {
    const plan = planLotQuestionRefile({
      entries: [
        { sourceName: "p1", courseName: "Álgebra", topicName: "Tema Inventado" },
        { sourceName: "p2", courseName: "Álgebra", topicName: "Tema Inventado" },
      ],
      seeded: [
        { id: "q1", sourceName: "p1", topicId: "topic-polinomios" },
        { id: "q2", sourceName: "p2", topicId: "topic-polinomios" },
      ],
      topicIds,
    });

    expect(plan.unresolved).toEqual(["Álgebra > Tema Inventado"]);
  });

  it("does nothing on a bank whose lots were never corrected", () => {
    expect(planLotQuestionRefile({ entries: [], seeded: [], topicIds })).toEqual({
      moves: [],
      unresolved: [],
    });
  });
});
