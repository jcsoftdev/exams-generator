import { createHash } from "node:crypto";

/**
 * Content-identity hash for a `structured` question's `bodyTypst`, backing
 * `questions_tenant_id_body_hash_idx` (see `questions.schema.ts`). Trims
 * before hashing so a re-pasted statement with only incidental leading/
 * trailing whitespace still collides with the existing row instead of
 * silently duplicating it.
 */
export function hashBodyTypst(bodyTypst: string): string {
  return createHash("sha256").update(bodyTypst.trim()).digest("hex");
}
