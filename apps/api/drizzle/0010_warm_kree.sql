ALTER TABLE "exams" ADD COLUMN "exam_type" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "university_id" uuid;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "track_id" uuid;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "cycle_id" uuid;--> statement-breakpoint
ALTER TABLE "exams" ADD COLUMN "week_number" integer;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exams" ADD CONSTRAINT "exams_exam_type_exam_types_code_fk" FOREIGN KEY ("exam_type") REFERENCES "public"."exam_types"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exams" ADD CONSTRAINT "exams_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exams" ADD CONSTRAINT "exams_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "exams" ADD CONSTRAINT "exams_cycle_id_cycles_id_fk" FOREIGN KEY ("cycle_id") REFERENCES "public"."cycles"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
