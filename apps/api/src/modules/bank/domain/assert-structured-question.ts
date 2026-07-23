import { BadRequestException } from "@nestjs/common";

interface QuestionTypeAndBody {
  readonly type: string;
  readonly bodyTypst: string | null;
}

/**
 * Shared structured-only gate for any operation that needs a question's
 * Typst body (preview compile, AI revise, ...). Image questions have no
 * `bodyTypst`/`alternatives` to operate on — reject up front instead of
 * letting each caller re-derive (and possibly mis-derive) the same check.
 *
 * Declared as a TS assertion function (not `: void`) so callers keep the
 * same `bodyTypst: string` narrowing they'd get from an inline guard clause.
 */
export function assertStructuredQuestion<T extends QuestionTypeAndBody>(
  question: T,
  action: string,
): asserts question is T & { bodyTypst: string } {
  if (question.type !== "structured" || !question.bodyTypst) {
    throw new BadRequestException(`${action} is only available for structured questions`);
  }
}
