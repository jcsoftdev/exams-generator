ALTER TABLE "questions" ADD COLUMN "body_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "questions_tenant_id_body_hash_idx" ON "questions" USING btree ("tenant_id","body_hash");