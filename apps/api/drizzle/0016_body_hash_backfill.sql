-- Backfills `body_hash` for every existing `type = 'structured'` question
-- (bodyHash didn't exist before 0015) so the dedupe check in
-- BankService.createStructuredQuestion / GenerateQuestionsService applies to
-- pre-existing rows too, not just ones created after this migration.
-- `pgcrypto`'s digest() must match Node's
-- `createHash("sha256").update(bodyTypst.trim()).digest("hex")` exactly —
-- same algorithm, same trim, same lowercase hex encoding.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
-- Postgres' bare trim() only strips literal spaces, not the full \s class
-- Node's String.prototype.trim() strips (tabs/newlines included) — use
-- regexp_replace so a backfilled hash can never diverge from one computed
-- at runtime for the same stored bodyTypst.
UPDATE "questions"
SET "body_hash" = encode(digest(regexp_replace("body_typst", '^\s+|\s+$', '', 'g'), 'sha256'), 'hex')
WHERE "body_typst" IS NOT NULL AND "body_hash" IS NULL;
