import { Difficulty } from "@exams-generator/shared";
import { QuestionSelfReport } from "./openrouter-response-validator";

/**
 * Structural difficulty gate for `generate()` — turns "the prompt ASKS for a
 * difficulty" into "the response is VERIFIED against it". Motivation: a
 * "hard" cube-volume request came back as a trivial one-step formula plug-in
 * (V = 4³) because the bare label is only prompt guidance the model can
 * ignore; per-topic worked examples (the first fix, see
 * `DIFFICULTY_CALIBRATION_RULES`) anchor ONE domain but don't generalize.
 *
 * The criterion here is STRUCTURAL and domain-agnostic — how many distinct
 * concepts the solution combines and how many reasoning steps it takes — so
 * it applies uniformly to every course/topic without hand-authoring
 * per-subject examples:
 *
 *  - "easy"   → exactly 1 concept, at most 2 steps (the mirror-image failure
 *               is also caught: an "easy" request answered with multi-case
 *               analysis is rejected as OVER-rigorous).
 *  - "medium" → 2+ concepts OR 3+ steps (the step count is the structural
 *               proxy for "an indirect datum must be interpreted first" —
 *               indirection can't be counted directly, but it always adds
 *               solution steps).
 *  - "hard"   → 3+ concepts OR 4+ steps (same proxy for "several cases to
 *               evaluate" — case analysis adds steps).
 *
 * Honest-limitation note: the self-report is model-generated, so a model
 * COULD inflate `conceptsUsed` to pass the gate without enriching the
 * question. The gate is still net-positive: (1) the schema forces the model
 * to commit to a concrete structure, which anchors generation far better
 * than an abstract adjective; (2) a rejection feeds the exact mismatch back
 * through the adapter's existing previousError retry, which is the same
 * mechanism that already fixes shape/plausibility failures. It is a
 * verifiable forcing device, not a proof — and unlike difficulty-matching
 * itself, the GATE LOGIC is deterministically testable.
 *
 * Runs ONLY for `generate()` — `reviseQuestion`/`extractFromImage` never
 * call it: revision's target difficulty is soft guidance for an edit, and
 * extraction transcribes whatever difficulty the photo already has.
 *
 * Throws `TypeError` with a retry-instructive message (it lands verbatim in
 * the retry prompt via `BuildOpenRouterRequestOptions.previousError`).
 */
export function assertDifficultyMatchesSelfReport(
  selfReport: QuestionSelfReport,
  difficulty: Difficulty,
): void {
  const concepts = selfReport.conceptsUsed.length;
  const steps = selfReport.solutionSteps;
  const structure = `${concepts} concept(s) / ${steps} step(s)`;

  switch (difficulty) {
    case Difficulty.Easy:
      if (concepts > 1 || steps > 2) {
        throw new TypeError(
          `difficulty "easy" was requested but the self-reported solution structure is ${structure} — that exceeds "easy" rigor (1 concept, at most 2 steps of direct interpretation). Regenerate a genuinely simple question: ONE concept, a direct reading of the statement, clean numbers.`,
        );
      }
      return;

    case Difficulty.Medium:
      if (concepts < 2 && steps < 3) {
        throw new TypeError(
          `difficulty "medium" was requested but the self-reported solution structure is ${structure} — that is one-step plug-in rigor, not "medium". Regenerate a question that combines 2+ distinct concepts or requires interpreting an indirect/hidden datum before solving; do NOT deliver a bare formula substitution with a higher label.`,
        );
      }
      return;

    case Difficulty.Hard:
      if (concepts < 3 && steps < 4) {
        throw new TypeError(
          `difficulty "hard" was requested but the self-reported solution structure is ${structure} — that is not "hard" rigor. Regenerate a question requiring genuinely deep analysis: combine 3+ distinct concepts, evaluate several cases, or hide a condition the student must discover (indirect data); do NOT just re-label an easier exercise.`,
        );
      }
      return;
  }
}
