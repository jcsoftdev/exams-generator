import { MAX_FOLDER_NAME_LENGTH } from "@exams-generator/shared";

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
