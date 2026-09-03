import { gradeLevelLabel, MAX_FOLDER_NAME_LENGTH } from "@exams-generator/shared";

export type FolderNameResult =
  { readonly ok: true; readonly name: string } | { readonly ok: false; readonly code: "folder_name_invalid" };

/**
 * `raw` is typed `unknown` on purpose: it comes off a JSON request body, so
 * "it is a string" is a claim to verify, not a type the compiler can enforce.
 */
export function validateFolderName(raw: unknown): FolderNameResult {
  if (typeof raw !== "string") {
    return { ok: false, code: "folder_name_invalid" };
  }
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_FOLDER_NAME_LENGTH) {
    return { ok: false, code: "folder_name_invalid" };
  }
  return { ok: true, name };
}

/**
 * The seeded folder name for a topic. MUST stay byte-identical to
 * `topicDisplayName` in the web's `bank-list.component.ts`: the suffix appears
 * only when a sibling topic of the SAME course carries the exact same name,
 * and only when the topic has a grade to disambiguate with. A topic whose name
 * is unique in its course stays bare — a suffix on every row would be noise,
 * and a suffix on a topic with no grade would read as "· undefined".
 */
export function folderNameForTopic(
  topic: { readonly name: string; readonly gradeLevel: string | null },
  siblings: readonly { readonly name: string }[],
): string {
  const sharesName = siblings.filter((sibling) => sibling.name === topic.name).length > 1;
  if (sharesName && topic.gradeLevel) {
    return `${topic.name} · ${gradeLevelLabel(topic.gradeLevel)}`;
  }
  return topic.name;
}
