ALTER TABLE "courses" DROP CONSTRAINT "courses_name_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "topics_course_id_name_idx";--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "stage" text;--> statement-breakpoint
-- Backfill: every pre-stage course becomes preuniversitario. The only courses
-- kept past the cleanup below are the question-bearing ones (Comunicación,
-- Biología, Aritmética), which are all legitimately preuniversitario.
UPDATE "courses" SET "stage" = 'preuniversitario' WHERE "stage" IS NULL;--> statement-breakpoint
-- One-time cleanup of the stage-less generic CNEB courses seeded before stages
-- existed (0 questions each); the stage-aware seed recreates them per stage.
-- Guarded: a course/topic with any dependent question is never touched.
DELETE FROM "topics" t USING "courses" c
  WHERE t."course_id" = c."id"
    AND c."name" IN ('Matemática','Ciencia y Tecnología','Ciencias Sociales','Desarrollo Personal, Ciudadanía y Cívica','Inglés','Arte y Cultura','Educación Física','Educación Religiosa','Educación para el Trabajo')
    AND NOT EXISTS (SELECT 1 FROM "questions" q WHERE q."topic_id" = t."id");--> statement-breakpoint
DELETE FROM "courses" c
  WHERE c."name" IN ('Matemática','Ciencia y Tecnología','Ciencias Sociales','Desarrollo Personal, Ciudadanía y Cívica','Inglés','Arte y Cultura','Educación Física','Educación Religiosa','Educación para el Trabajo')
    AND NOT EXISTS (SELECT 1 FROM "topics" t WHERE t."course_id" = c."id");--> statement-breakpoint
ALTER TABLE "courses" ALTER COLUMN "stage" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "grade_level" text;--> statement-breakpoint
-- Kept topics belong to preuniversitario courses (grade "pre"); tag them so the
-- grade filter matches and the (course,name,grade) unique index dedupes on reseed.
UPDATE "topics" SET "grade_level" = 'pre' WHERE "grade_level" IS NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "topics" ADD CONSTRAINT "topics_grade_level_grade_levels_code_fk" FOREIGN KEY ("grade_level") REFERENCES "public"."grade_levels"("code") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "courses_stage_name_idx" ON "courses" USING btree ("stage","name");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "topics_course_id_name_grade_idx" ON "topics" USING btree ("course_id","name","grade_level");