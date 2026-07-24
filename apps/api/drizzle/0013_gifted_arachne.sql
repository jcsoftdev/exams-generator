CREATE TABLE IF NOT EXISTS "subtopics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "slug" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "subtopic_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subtopics" ADD CONSTRAINT "subtopics_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "subtopics_topic_id_slug_idx" ON "subtopics" USING btree ("topic_id","slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "subtopics_topic_id_idx" ON "subtopics" USING btree ("topic_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "questions" ADD CONSTRAINT "questions_subtopic_id_subtopics_id_fk" FOREIGN KEY ("subtopic_id") REFERENCES "public"."subtopics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topics_course_id_slug_grade_idx" ON "topics" USING btree ("course_id","slug","grade_level");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "questions_subtopic_id_idx" ON "questions" USING btree ("subtopic_id");