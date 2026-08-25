ALTER TABLE "exam_blueprint_rows" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_blueprint_rows" ADD COLUMN "block_code" text;--> statement-breakpoint
ALTER TABLE "exam_blueprint_rows" ADD COLUMN "block_label" text;--> statement-breakpoint
ALTER TABLE "exam_blueprint_rows" ADD COLUMN "section_code" text;--> statement-breakpoint
ALTER TABLE "exam_blueprint_rows" ADD COLUMN "section_label" text;--> statement-breakpoint
ALTER TABLE "exam_versions" ADD COLUMN "section_layout" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_blueprint_template_rows" ADD COLUMN "sort_order" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "exam_blueprint_template_rows" ADD COLUMN "block_code" text;--> statement-breakpoint
ALTER TABLE "exam_blueprint_template_rows" ADD COLUMN "block_label" text;--> statement-breakpoint
ALTER TABLE "exam_blueprint_template_rows" ADD COLUMN "block_question_count" integer;--> statement-breakpoint
ALTER TABLE "exam_blueprint_template_rows" ADD COLUMN "section_label" text;
--> statement-breakpoint
-- Backfill: pre-existing rows have no order. They get a stable one by `id`
-- within each exam/template. It's arbitrary but deterministic, and it
-- preserves grouping (rows of the same exam stay together and ordered).
UPDATE "exam_blueprint_rows" AS r
SET "sort_order" = numbered.rn
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "exam_id" ORDER BY "id") - 1) AS rn
  FROM "exam_blueprint_rows"
) AS numbered
WHERE r."id" = numbered."id";
--> statement-breakpoint
UPDATE "exam_blueprint_template_rows" AS r
SET "sort_order" = numbered.rn
FROM (
  SELECT "id", (ROW_NUMBER() OVER (PARTITION BY "template_id" ORDER BY "id") - 1) AS rn
  FROM "exam_blueprint_template_rows"
) AS numbered
WHERE r."id" = numbered."id";