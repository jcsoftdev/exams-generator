ALTER TABLE "generation_jobs" ADD COLUMN "retried_from_job_id" uuid;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD COLUMN "root_job_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_retried_from_job_id_generation_jobs_id_fk" FOREIGN KEY ("retried_from_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_root_job_id_generation_jobs_id_fk" FOREIGN KEY ("root_job_id") REFERENCES "public"."generation_jobs"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
