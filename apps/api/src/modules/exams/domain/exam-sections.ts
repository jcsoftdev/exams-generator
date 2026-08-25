import { SelectedQuestion, SelectionBlock, SelectionSection } from "./version-shuffler";

/**
 * A selected question paired with where it's supposed to print. Comes from
 * joining `exam_questions` with its `exam_blueprint_rows` (Task 7).
 */
export interface QuestionPlacement {
  readonly question: SelectedQuestion;
  readonly sortOrder: number;
  readonly blockLabel: string;
  readonly sectionCode: string | null;
  readonly sectionLabel: string | null;
}

/**
 * Groups the selected questions into the printed structure: sections in the
 * canonical order dictated by `sortOrder`, and within each one, blocks in
 * their order of first appearance.
 *
 * Pure function, no I/O — the order in which blocks get PRINTED is decided
 * later by `buildVersions`, which shuffles them per version (design doc
 * §3.4). Here only the canonical order is established.
 *
 * Two rows of the same block separated by a row of another block get MERGED
 * into a single block, at the position of the first one. Keeping a block's
 * rows contiguous is the responsibility of whoever assembles the blueprint;
 * here merging is preferred over printing the same heading twice.
 */
export function groupIntoSections(placements: readonly QuestionPlacement[]): SelectionSection[] {
  const ordered = [...placements].sort((a, b) => a.sortOrder - b.sortOrder);

  const sectionsByKey = new Map<
    string,
    { code: string | null; label: string | null; blocks: Map<string, SelectedQuestion[]> }
  >();

  for (const placement of ordered) {
    const sectionKey = placement.sectionCode ?? "";
    let section = sectionsByKey.get(sectionKey);
    if (!section) {
      section = { code: placement.sectionCode, label: placement.sectionLabel, blocks: new Map() };
      sectionsByKey.set(sectionKey, section);
    }

    let block = section.blocks.get(placement.blockLabel);
    if (!block) {
      block = [];
      section.blocks.set(placement.blockLabel, block);
    }
    block.push(placement.question);
  }

  return [...sectionsByKey.values()].map((section) => ({
    code: section.code,
    label: section.label,
    blocks: [...section.blocks.entries()].map(
      ([label, questions]): SelectionBlock => ({ label, questions }),
    ),
  }));
}
