import { pgEnum } from "drizzle-orm/pg-core";
import { Difficulty, Role } from "@exams-generator/shared";

/**
 * Enum values are derived from `@exams-generator/shared`'s `Role` and
 * `Difficulty` — never redefined here, to keep a single source of truth.
 *
 * `GradeLevel` (from the exams domain, PR2) is deliberately NOT a Postgres
 * enum: its own JSDoc calls it a "fixed seeded catalog", so it lives in the
 * `grade_levels` table instead (see `grade-levels.schema.ts`) and is seeded
 * from the same `GRADE_LEVELS` array by `seed.ts`. A Postgres enum can't be
 * "seeded" (its values are baked into DDL via `ALTER TYPE`), which doesn't
 * match that description or task 2.6's explicit "seed GradeLevel catalog".
 */
const ROLE_VALUES = Object.values(Role) as [Role, ...Role[]];
export const roleEnum = pgEnum("role", ROLE_VALUES);

const DIFFICULTY_VALUES = Object.values(Difficulty) as [Difficulty, ...Difficulty[]];
export const difficultyEnum = pgEnum("difficulty", DIFFICULTY_VALUES);

/**
 * `image`: MVP (Fase 1) — full statement + alternatives baked into one
 * image; only the answer key is stored separately; alternatives are never
 * shuffled (impossible by format).
 * `structured`: Fase 2 — Typst markup body + JSON alternatives array,
 * alternatives ARE shuffled per version. Not populated by this PR's seed.
 */
export const QUESTION_TYPES = ["image", "structured"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const questionTypeEnum = pgEnum("question_type", QUESTION_TYPES);

/**
 * `draft`: awaiting human curation (only reachable via AI generation, Fase
 * 2 — the AI never publishes directly to the bank).
 * `approved`: visible to blueprint selection. Manual image uploads go
 * straight to `approved` (curated by definition per design doc 5.1).
 * `archived`: soft-removed from the bank — no longer visible to blueprint
 * selection, kept for historical/audit purposes (S9).
 */
export const QUESTION_STATUSES = ["draft", "approved", "archived"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export const questionStatusEnum = pgEnum("question_status", QUESTION_STATUSES);

/**
 * `draft`: blueprint being defined / selection not yet confirmed.
 * `ready`: selection confirmed (design doc 5.3 step 5) — versions can be
 * generated.
 */
export const EXAM_STATUSES = ["draft", "ready"] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];
export const examStatusEnum = pgEnum("exam_status", EXAM_STATUSES);

/**
 * A generation job's lifecycle (design doc:
 * docs/superpowers/specs/2026-07-19-ai-generation-history-design.md §3).
 * `failed` means the JOB errored out (crash, exhausted BullMQ retries) —
 * a job that ran to completion with some per-item failures is still
 * `completed`, with `createdCount < count`.
 */
export const GENERATION_JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
] as const;
export type GenerationJobStatus = (typeof GENERATION_JOB_STATUSES)[number];
export const generationJobStatusEnum = pgEnum("generation_job_status", GENERATION_JOB_STATUSES);
