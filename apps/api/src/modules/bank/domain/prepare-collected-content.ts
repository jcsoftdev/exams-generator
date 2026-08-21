import { escapeTypstText } from "./escape-typst-text";
import { hashBodyTypst } from "./hash-body-typst";
import { stripSolutionTail } from "./strip-solution-tail";

export interface RawCollectedContent {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
}

export interface PreparedCollectedContent {
  readonly bodyTypst: string;
  readonly alternatives: readonly string[];
  readonly bodyHash: string;
}

/**
 * Maps ONE web-scraped entry's raw prose onto the columns a `questions` row
 * actually stores: `body_typst` / `alternatives` escaped for Typst (see
 * `escape-typst-text.ts` for the two failure modes that forces), and
 * `body_hash` computed from the RAW statement.
 *
 * Hashing raw rather than escaped is the load-bearing decision here. That
 * hash is the collected seeder's only dedup key — `tenant_id` is NULL on
 * every central-bank row and Postgres treats NULL as distinct from NULL, so
 * `questions_tenant_id_body_hash_idx` never catches these — and it is
 * recomputed from the JSON files on EVERY boot. Hashing the escaped form
 * would repin that key to whatever the escaper emits today: the rows
 * already in the bank were hashed before escaping existed, so the next boot
 * would miss all of them and insert the entire bank a second time. The raw
 * statement is the stable identity of a scraped question; how we render it
 * is not. Stripping runs AFTER the hash for the same reason.
 *
 * Alternatives also go through `stripSolutionTail`: the scrapes routinely
 * glued the source page's answer key onto the last option, which printed the
 * answer on the student's exam (audit 2026-08-20, H2). The statement is left
 * alone — some scraped bodies embed their own solution mid-sentence, which no
 * tail cut can fix and a blind one would truncate.
 */
export function prepareCollectedContent(raw: RawCollectedContent): PreparedCollectedContent {
  return {
    bodyTypst: escapeTypstText(raw.bodyTypst),
    alternatives: raw.alternatives.map((alternative) => escapeTypstText(stripSolutionTail(alternative))),
    bodyHash: hashBodyTypst(raw.bodyTypst),
  };
}
