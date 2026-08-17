# Module: docs

## Purpose

The project's own documentation and planning trail: the design spec that
started the project, per-feature plan/design pairs written before each
change, the module-doc set you are reading now, and the running audit
process (past + current) that keeps those docs honest against the code.
This module documents the OTHER documents — it is meta relative to
`apps`/`packages`/`infra`.

## Key Files

- `docs/superpowers/specs/2026-07-17-exams-generator-design.md` — the
  original product/architecture spec (multi-tenant question bank → exam →
  PDF pipeline). §7 (error handling) and §5.4/§9 (compilation model, phase
  plan) have been corrected/annotated as of 2026-08-14 to match the code
  after this doc was found stale by audit; treat items marked
  **SUPERSEDIDO** as settled, not open questions.
- `docs/superpowers/specs/*-design.md` (11 more files) — one design doc per
  shipped feature (UI redesign, AI generation history, dashboard layout
  migration, light/dark theme, question editing with AI, bank photo
  extraction, LaTeX math support, review-queue editing, exam types/
  university structure, exam-builder template autoload). Each pairs with a
  same-dated file in `docs/superpowers/plans/`.
- `docs/superpowers/plans/*.md` (12 files) — the step-by-step implementation
  plan that was executed for each corresponding design doc; these are
  historical execution records, not living specs — don't edit them to
  reflect later code changes.
- `docs/superpowers/PARALLEL-TODO.md` — the coordination doc for running
  multiple parallel work sessions/agents against this repo without
  collisions: defines "waves" (dependency order) and "lanes" (parallel
  tracks within a wave), names an "integrator" role that owns the 3
  cross-cutting shared files (`apps/api/src/app.module.ts`,
  `packages/shared/**`, `apps/api/src/db/schema/**`), and states the
  contracts-first rule (a DTO needed by UI must land in `packages/shared`
  before UI and API both consume it).
- `docs/modules/{apps,packages,docs,infra}.md` — the module-doc set itself
  (this file's siblings), one per top-level workspace folder; format is
  fixed (Purpose/Key Files/Dependencies/Data Flow/Gotchas/Last Updated) and
  is meant to be re-verified against code, not written once and trusted
  forever — the audit that produced this fill-in (`docs/audit-2026-08-14.md`)
  exists precisely because these four were empty stubs no one had filled.
- `docs/audit-todo.md` — CLOSED todo list from the 2026-07-24 audit
  (`Estado: cerrada`); kept as the historical record of what was found and
  fixed, including the reasoning behind superseded design decisions (e.g.
  the sync→BullMQ migration for exam PDF compilation is explained here, not
  in the spec — see its P0 item "Generación de PDFs síncrona...").
- `docs/audit-2026-08-14.md` — the CURRENT, in-progress audit; owned by the
  orchestrator process running this fill-in, not edited by this module doc
  or its author.
- `docs/question-collection-pipeline.md` — runbook for the (separate,
  non-code) pipeline that produces the web-sourced question-bank seed JSON
  in `apps/api/src/db/data/` — sourcing rules (published answer key
  required, no paywalled content), the image-cropping rule (crop only the
  diagram/figure, never statement/alternative text), and the two output
  formats (`structured` + complement image vs. full-page `image`).

## Dependencies

- Purely documentation — no build/runtime dependency in either direction.
  The one soft dependency is currency: every doc here describes `apps/*`,
  `packages/*`, or `infra/*` code and can silently drift from it (this is
  exactly the failure mode `docs/audit-2026-08-14.md` and this fill-in
  exist to catch).
- `docs/modules/*.md` are also consumed by tooling: this project's
  `CLAUDE.md` instructs the assistant to read each stub under
  `docs/modules/` and persist the filled content into `project-brain` via
  `add_knowledge` — so these files double as the seed for the project's
  semantic-search index, not just human reading material.

## Data Flow

Not a runtime data flow. The intended lifecycle is: a feature gets a
design doc + plan in `docs/superpowers/` BEFORE implementation → the code
ships → an audit (`docs/audit-*.md`) periodically re-reads both code and
docs together and files findings where they've diverged → findings get
fixed either in the code or, as with this pass, in the doc. Module docs
(`docs/modules/*.md`) are meant to be regenerated/re-verified whenever the
module's shape changes materially, not on a schedule.

## Gotchas

- **Plans are historical, specs are living-ish.** A `*-design.md` spec can
  and should be corrected when audit finds it stale (as done to the
  2026-07-17 spec in this same pass); the paired `*.md` plan in
  `docs/superpowers/plans/` documents what WAS done at the time and should
  generally be left alone even if the code later changes further — editing
  it to match current code would falsify the historical record of what
  that plan actually executed.
- **`docs/audit-todo.md` says "cerrada" (closed)** — its remaining unchecked
  `[ ]` items are documented as deliberately deferred decisions, not
  outstanding work; don't reopen them without reading the surrounding
  rationale first.
- A design doc being marked **SUPERSEDIDO** inline (this pass's fix to
  §5.4/§9 of the 2026-07-17 spec) is a lighter-weight resolution than
  rewriting the section — it's meant to stop a reader from re-litigating a
  settled question, while pointing at the doc that actually carries the
  reasoning (`docs/audit-todo.md`). Don't mistake "superseded" for
  "deleted": the original text is kept, struck through, for history.

## Last Updated

2026-08-14 — filled from stub as part of the same pass that corrected §7
and §5.4/§9 of `docs/superpowers/specs/2026-07-17-exams-generator-design.md`;
verified file counts and structure via directory listing of
`docs/superpowers/{specs,plans}` and read of `docs/audit-todo.md` and
`docs/superpowers/PARALLEL-TODO.md`.
