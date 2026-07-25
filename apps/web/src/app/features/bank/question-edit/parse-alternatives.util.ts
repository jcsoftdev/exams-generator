/** Parses a newline-separated alternatives textarea value into trimmed, non-empty lines — the canonical parsing used by every question edit form (bank-list, ai-review-queue). */
export function parseAlternativesList(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}
