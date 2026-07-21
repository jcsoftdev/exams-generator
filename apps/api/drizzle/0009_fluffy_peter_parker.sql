CREATE TABLE IF NOT EXISTS "cycles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"university_id" uuid NOT NULL,
	"track_id" uuid,
	"label" text NOT NULL,
	"starts_on" date NOT NULL,
	"week_length_days" integer DEFAULT 7 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cycles" ADD CONSTRAINT "cycles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cycles" ADD CONSTRAINT "cycles_university_id_universities_id_fk" FOREIGN KEY ("university_id") REFERENCES "public"."universities"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cycles" ADD CONSTRAINT "cycles_track_id_tracks_id_fk" FOREIGN KEY ("track_id") REFERENCES "public"."tracks"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cycles_active_idx" ON "cycles" USING btree (coalesce("tenant_id", '00000000-0000-0000-0000-000000000000'::uuid),"university_id",coalesce("track_id", '00000000-0000-0000-0000-000000000000'::uuid)) WHERE "cycles"."is_active" = true;