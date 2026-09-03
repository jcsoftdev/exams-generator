CREATE TABLE IF NOT EXISTS "question_folders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"topic_id" uuid,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "folders_seeded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "folder_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question_folders" ADD CONSTRAINT "question_folders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question_folders" ADD CONSTRAINT "question_folders_parent_id_question_folders_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."question_folders"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question_folders" ADD CONSTRAINT "question_folders_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "question_folders_sibling_name_idx" ON "question_folders" USING btree ("tenant_id","parent_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "question_folders_root_name_idx" ON "question_folders" USING btree ("tenant_id","name") WHERE "question_folders"."parent_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "question_folders_tenant_topic_idx" ON "question_folders" USING btree ("tenant_id","topic_id") WHERE "question_folders"."topic_id" is not null;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "question_folders_tenant_parent_idx" ON "question_folders" USING btree ("tenant_id","parent_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "questions" ADD CONSTRAINT "questions_folder_id_question_folders_id_fk" FOREIGN KEY ("folder_id") REFERENCES "public"."question_folders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "questions_folder_id_idx" ON "questions" USING btree ("folder_id");
