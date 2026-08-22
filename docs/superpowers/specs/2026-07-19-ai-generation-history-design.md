# AI Generation History — Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Use a fresh worktree for this work — do NOT reuse `.claude/worktrees/ai-generate-streaming-progress`, which is earmarked for a separate, already-partially-implemented plan (`docs/superpowers/plans/2026-07-19-ai-generate-streaming-progress.md`, live SSE token streaming during a single question's generation — a different, complementary feature, not this one).

## 1. Goal

Today, `POST /ai/questions/generate` batches are orchestrated entirely client-side: `AiGenerateComponent` fires N sequential HTTP requests (one per question) and tracks progress (`requested`/`completed`/`batchQuestions`) in Angular component signals only. Navigating away destroys the component and that progress is lost — worse, the in-flight RxJS subscription chain isn't cancelled, so it silently keeps completing in the background against a component instance nobody can see.

Move batch generation to a durable, server-owned job: the API runs the batch to completion regardless of what the browser does, survives navigation/refresh/tab-close/API-restart, and the user gets a History page listing past and in-flight jobs they can return to, watch live, or cancel.

## 2. Architecture

`generation_jobs` (Postgres, via Drizzle) is the source of truth for history/listing/UI state. BullMQ (new Redis-backed queue) is the durable async executor — it survives API restarts via its own persistence in Redis, independent of the `generation_jobs` row, which exists purely for tenant-scoped listing/progress display.

New infra: a `redis` service in `infra/docker-compose.yml`; `REDIS_URL` env var on the `api` service (mirrors the existing `MINIO_*` pattern).

`AiModule` additions:

- `BullModule.registerQueue({ name: 'generation' })`
- `GenerationProcessor` — the `@Processor('generation')` consumer
- `GenerationJobsService` — create/list/get/cancel, plus the pre-enqueue validation
- `GenerationJobsRepository` — Drizzle queries against `generation_jobs`

## 3. Data model

New table `generation_jobs`:

| Column                                     | Type                      | Notes                                                                   |
| ------------------------------------------ | ------------------------- | ----------------------------------------------------------------------- |
| `id`                                       | uuid, pk                  |                                                                         |
| `tenant_id`                                | uuid, fk tenants          | scoping, same pattern as `exams`/`questions`                            |
| `created_by`                               | uuid, fk users            |                                                                         |
| `course_id`, `topic_id`                    | uuid                      |                                                                         |
| `difficulty`, `grade_level`                | enum/text                 | mirrors `GenerateQuestionsDto`                                          |
| `count`                                    | int                       | requested total                                                         |
| `with_figure`                              | boolean                   |                                                                         |
| `status`                                   | enum                      | `pending \| running \| completed \| failed \| cancelled`                |
| `created_count`, `failed_count`            | int, default 0            | denormalized for list rendering                                         |
| `created_question_ids`                     | jsonb array, default `[]` | drives the "cards appear as they're ready" UI                           |
| `failed_items`                             | jsonb array, default `[]` | `{ index, error }`, same shape as today's `GenerateQuestionsFailedItem` |
| `cancel_requested`                         | boolean, default false    | cooperative cancellation flag                                           |
| `created_at`, `updated_at`, `completed_at` | timestamps                | `completed_at` null until terminal                                      |

`status='failed'` means the _job_ errored out (crash, exhausted retries) — a job that ran to completion with some per-item failures is still `completed`, with `created_count < count` (same partial-success semantics `GenerateQuestionsService` already has today).

## 4. Backend API

Under `/ai/questions/jobs`:

- `POST /` — validates synchronously (same `validateGenerateQuestionsInput` + course/topic-exists check `GenerateQuestionsService` runs today) _before_ touching the queue. Bad input still gets an immediate 400/404, never enqueues a doomed job. On success: insert row (`status='pending'`) → enqueue `{ jobId }` → respond `202` with the job.
- `GET /` — tenant-scoped, paginated, running jobs sorted first (mirrors `ExamsController.listExams` pagination pattern).
- `GET /:id` — single job; this is the poll target for the detail view.
- `POST /:id/cancel` — sets `cancel_requested=true` if the job is `pending`/`running`; idempotent no-op otherwise (already-terminal job).

The old synchronous `POST /ai/questions/generate` is removed — it has exactly one caller (`AiGenerateComponent`), which migrates fully to the job endpoint. `POST /ai/questions/:id/revise` and `POST /ai/questions/extract` are untouched (single-item, already fast, no batching concern).

## 5. Job execution

`GenerateQuestionsService`'s per-item loop (generate → compile-with-bounded-retry → persist-as-draft) is extracted into a shared method, reused by the processor instead of duplicated.

`GenerationProcessor.process(job)`:

1. Load the `generation_jobs` row by `jobId`. If already terminal (e.g. cancelled while queued), no-op.
2. Set `status='running'` on first pickup.
3. Resume the per-item loop from `index = created_count + failed_count` — **not 0**. This is what makes a BullMQ retry after a mid-batch crash safe: it never regenerates questions already persisted in a prior attempt.
4. After each item: persist progress (append to `created_question_ids`/`failed_items`, bump counts, `updated_at`). Then check `cancel_requested` — if set, break the loop, set `status='cancelled'`, return. This check happens _between_ items, not mid-AI-call (cancellation is cooperative, not preemptive).
5. On full completion: `status='completed'`, `completed_at=now()`.

BullMQ config: 3 attempts with exponential backoff for whole-job crashes (uncaught errors outside the per-item try/catch — e.g. a dropped DB connection). After exhausting attempts, `status='failed'`; there is no infinite auto-retry — the user re-submits a fresh job. Worker concurrency capped (default 2, env-tunable) so one tenant's multi-job burst doesn't starve the AI provider's rate limit.

## 6. Frontend

- `AiGenerateComponent` becomes form-only: `generate()` now calls `createGenerationJob(...)` once and navigates to `ai/jobs/:id`. The client-side recursive `generateOne()` loop is deleted entirely — the backend already loops internally, so this is a net simplification, not just a relocation.
- `ai.service.ts`: replace `generateQuestions()` with `createGenerationJob()`, `listGenerationJobs()`, `getGenerationJob(id)`, `cancelGenerationJob(id)`.
- New `GenerationJobDetailComponent` (route `ai/jobs/:id`): polls `getGenerationJob(id)` every 2s while `status` is `pending`/`running`, stops polling on any terminal status. Renders the same progress bar + question cards `AiGenerateComponent` renders today (same `listDrafts()`-diff-by-id approach, now driven by the poll instead of a per-request callback), plus a cancel button while running.
- New `GenerationHistoryComponent` (route `ai/jobs`): lists jobs newest-first, status badges, running jobs surfaced at the top, click-through to detail.
- `app.routes.ts`: add `ai/jobs` and `ai/jobs/:id` children under `app`.
- Sidebar (`shell.component`): add a "Historial" nav entry near "Generar con IA"/"Revisar".

## 7. Error handling

- Invalid input (missing ids, unknown course/topic, bad difficulty) → synchronous 400/404 at job-creation time, exactly as today. Nothing is enqueued.
- Per-item AI/compile failure → captured in `failed_items`, job still reaches `completed` (partial success) — unchanged semantics from today's `failed[]` array.
- Whole-job crash → BullMQ retries from the checkpoint (§5.3); `failed` only after exhausting attempts.
- Cancel → cooperative, keeps whatever was already created; nothing is rolled back.

## 8. Testing

Backend:

- `GenerationJobsService` unit tests: pre-enqueue validation, checkpoint-resume index math, cancel sets the flag and is idempotent on terminal jobs.
- Processor test simulating a mid-batch crash + BullMQ retry — asserts no duplicate questions are created (the checkpoint-resume invariant).
- e2e tests for all four endpoints, including tenant-scoping (tenant A cannot see or cancel tenant B's job).

Frontend:

- `ai-generate.component.spec.ts` updated: submit → creates job → navigates (no more loop/progress assertions, those move to the detail spec).
- New specs: `generation-history.component.spec.ts` (list rendering, status badges), `generation-job-detail.component.spec.ts` (poll start/stop lifecycle, card rendering as `created_question_ids` grows, cancel button).

## 9. Out of scope

- Real-time push (SSE/WebSocket) — polling only.
- Cross-tenant/admin visibility into other tenants' jobs.
- Automatic infinite retry of a `failed` job.
- Job deletion/pruning (history grows unbounded for now — pagination handles the list view).
