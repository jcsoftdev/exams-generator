CREATE TABLE IF NOT EXISTS "exam_blueprint_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"university_id" uuid NOT NULL,
	"track_id" uuid,
	"tenant_id" uuid,
	"cycle_label" text NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "exam_blueprint_template_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"topic_id" uuid,
	"question_count" integer,
	"weight_points" numeric,
	"exam_section" text,
	"source_level" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "syllabus_week_maps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"week_number" integer NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_blueprint_templates" ADD CONSTRAINT "exam_blueprint_templates_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_blueprint_templates" ADD CONSTRAINT "exam_blueprint_templates_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_blueprint_templates" ADD CONSTRAINT "exam_blueprint_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_blueprint_template_rows" ADD CONSTRAINT "exam_blueprint_template_rows_template_id_exam_blueprint_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."exam_blueprint_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_blueprint_template_rows" ADD CONSTRAINT "exam_blueprint_template_rows_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_blueprint_template_rows" ADD CONSTRAINT "exam_blueprint_template_rows_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "syllabus_week_maps" ADD CONSTRAINT "syllabus_week_maps_template_id_exam_blueprint_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."exam_blueprint_templates"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "syllabus_week_maps" ADD CONSTRAINT "syllabus_week_maps_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "syllabus_week_maps" ADD CONSTRAINT "syllabus_week_maps_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "public"."topics"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "exam_blueprint_templates_current_idx" ON "exam_blueprint_templates" USING btree ("university_id",coalesce("track_id", '00000000-0000-0000-0000-000000000000'::uuid),coalesce("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "exam_blueprint_templates"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "syllabus_week_maps_template_id_topic_id_idx" ON "syllabus_week_maps" USING btree ("template_id","topic_id");--> statement-breakpoint
-- Manually appended: drizzle-kit 0.24.2 does not emit CHECK constraints for
-- postgres (the `check()` builder exists in drizzle-orm ^0.33.0's schema
-- API and is defined on exam-blueprint-template-rows.schema.ts, but
-- drizzle-kit's snapshot/diff logic has no CHECK-constraint support at all
-- in this pinned version — it is silently dropped from `db:generate`
-- output, not partially generated). Added here by hand so the constraint
-- actually lands in the database; flagged for human verification.
DO $$ BEGIN
 ALTER TABLE "exam_blueprint_template_rows" ADD CONSTRAINT "exam_blueprint_template_rows_question_count_or_weight_points_check" CHECK ("question_count" IS NOT NULL OR "weight_points" IS NOT NULL);
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;