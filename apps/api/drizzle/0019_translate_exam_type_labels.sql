-- Translates the exam-type catalog's DISPLAY-ONLY labels to Spanish.
-- "Fastest"/"ETA"/"ETA por semana" were raw English/jerga-interna
-- leftovers from the initial seed (apps/api/src/db/seed.ts EXAM_TYPES),
-- never localized for this Peruvian-schools product. `code` is untouched
-- here on purpose — it's the contract every domain rule keys off
-- (resolveBlueprint, blueprint-selector.ts), not copy. "ETA" ("Examen
-- Tipo Admisión") is academia jerga interna, spelled out below so a
-- teacher outside that world still understands the option (see design
-- doc 2026-07-21-exam-types-university-structure-design.md).
UPDATE "exam_types" SET "label" = 'Rápido (semana actual)' WHERE "code" = 'fastest';
--> statement-breakpoint
UPDATE "exam_types" SET "label" = 'Examen tipo admisión' WHERE "code" = 'eta';
--> statement-breakpoint
UPDATE "exam_types" SET "label" = 'Examen tipo admisión por semana' WHERE "code" = 'eta_by_week';
