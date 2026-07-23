-- Auto-bump updated_at on UPDATE. The columns themselves are added in 0011;
-- this trigger makes ANY update (including raw SQL / non-Drizzle writers)
-- refresh the timestamp, so `updated_at` is DB-authoritative rather than
-- relying on every caller to set it. Only `exams` and `questions` get the
-- trigger — `generation_jobs.updated_at` is already managed explicitly by
-- GenerationJobsRepository and is intentionally left as-is.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS exams_set_updated_at ON "exams";
--> statement-breakpoint
CREATE TRIGGER exams_set_updated_at
  BEFORE UPDATE ON "exams"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
DROP TRIGGER IF EXISTS questions_set_updated_at ON "questions";
--> statement-breakpoint
CREATE TRIGGER questions_set_updated_at
  BEFORE UPDATE ON "questions"
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
-- Trigram search for exams.title. `listExams` filters with `ilike '%term%'`
-- (leading wildcard), which a btree index cannot serve; a GIN trigram index
-- does. Requires the migrating role to have CREATE EXTENSION privilege
-- (true for the docker-compose superuser; on managed PG the extension must be
-- allow-listed).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exams_title_trgm_idx" ON "exams" USING gin ("title" gin_trgm_ops);
