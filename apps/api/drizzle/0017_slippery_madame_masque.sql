CREATE TABLE IF NOT EXISTS "question_alternative_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"alternative_index" integer NOT NULL,
	"asset_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question_alternative_images" ADD CONSTRAINT "question_alternative_images_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "question_alternative_images" ADD CONSTRAINT "question_alternative_images_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "question_alternative_images_question_id_idx" ON "question_alternative_images" USING btree ("question_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "question_alternative_images_question_id_alternative_index_idx" ON "question_alternative_images" USING btree ("question_id","alternative_index");