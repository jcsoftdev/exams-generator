CREATE TABLE IF NOT EXISTS "exam_version_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"exam_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_by_role" "role" NOT NULL,
	"version_count" integer NOT NULL,
	"status" "generation_job_status" DEFAULT 'pending' NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"failed_reason" text,
	"failed_question_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_version_jobs" ADD CONSTRAINT "exam_version_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_version_jobs" ADD CONSTRAINT "exam_version_jobs_exam_id_exams_id_fk" FOREIGN KEY ("exam_id") REFERENCES "public"."exams"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exam_version_jobs" ADD CONSTRAINT "exam_version_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_version_jobs_exam_created_idx" ON "exam_version_jobs" USING btree ("exam_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_version_jobs_tenant_created_idx" ON "exam_version_jobs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_version_jobs_status_idx" ON "exam_version_jobs" USING btree ("status");