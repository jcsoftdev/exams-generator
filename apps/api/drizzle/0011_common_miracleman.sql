ALTER TABLE "questions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_tenant_id_idx" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "questions_pool_idx" ON "questions" USING btree ("grade_level","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_blueprint_rows_exam_id_idx" ON "exam_blueprint_rows" USING btree ("exam_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_questions_question_id_idx" ON "exam_questions" USING btree ("question_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_versions_pdf_asset_id_idx" ON "exam_versions" USING btree ("pdf_asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_versions_answer_sheet_asset_id_idx" ON "exam_versions" USING btree ("answer_sheet_asset_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exams_tenant_created_idx" ON "exams" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exams_tenant_status_idx" ON "exams" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_jobs_status_idx" ON "generation_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_jobs_tenant_created_idx" ON "generation_jobs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "generation_jobs_root_job_id_idx" ON "generation_jobs" USING btree ("root_job_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "exam_blueprint_template_rows_template_id_idx" ON "exam_blueprint_template_rows" USING btree ("template_id");