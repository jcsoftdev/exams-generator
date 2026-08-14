ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "source_url" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "source_name" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "questions_source_url_idx" ON "questions" USING btree ("source_url");
