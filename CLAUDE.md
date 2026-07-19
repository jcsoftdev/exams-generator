<!-- project-brain:start -->
# Project: exams-generator

This project is indexed with project-brain.

## project-brain MCP

You have access to the `project-brain` MCP server for codebase knowledge retrieval.

### Available Tools

- `search_context` — semantic/conceptual lookup; returns ranked snippets + chunk_id. PRIMARY for fuzzy/cross-file questions.
- `search_code` — exact/keyword full-text search (BM25) over indexed code — identifiers, error strings, exact phrases. No embeddings needed. Not regex.
- `expand_context` — full body of a chunk_id from search_context (read this instead of re-reading whole files).
- `find_symbol` — exact symbol definition(s) by name: path, line range, kind, signature. Use when you know the name.
- `find_callers` — every symbol that calls the named symbol (who depends on X).
- `find_callees` — every symbol the named symbol calls (what X depends on).
- `impact` — blast radius: all symbols transitively affected if the named symbol changes (reverse call graph).
- `trace_path` — shortest call path between two symbols (how does A reach B) — ordered caller→callee chain.
- `repo_map` — token-budgeted overview of the most important symbols in the codebase, ranked by PageRank over the call graph. Use for repo orientation / where to start reading.
- `list_modules` — browse the indexed structure by module.
- `get_module` — retrieve all chunks for a module.
- `add_knowledge` — persist a note/decision into the brain for future sessions.
- `delete_knowledge` — remove chunks by source (deleted/renamed files).
- `check_health` — embedding service + index status; run if results look empty or stale.
- `list_projects` — list every indexed project with chunk counts and embedding meta.
- `delete_project` — delete an entire indexed project's vector index + metadata (never touches its .project-brain/ directory).
- `manage_adr` — create or list Architecture Decision Records. Append-only: supersede by creating a new ADR with supersedes:<slug>.
- `get_architecture` — one-call project summary: detected tech stack, indexed modules, chunk count, and symbol count. Use to orient before drilling into search_context or the structural tools.
- `sync_project` — re-index changed files now (incremental). Use when results look stale. Streams progress.

### Routing (pick the right tool — do NOT default to search_context for structural questions)

- "where is X defined" / exact symbol by name → `find_symbol`
- "what calls X" / "who uses X" → `find_callers`
- "what does X call / depend on" → `find_callees`
- "what breaks if I change X" / blast radius → `impact`
- 'how does A end up calling B' → `trace_path`
- repo overview / most important symbols / where to start reading → `repo_map`
- "how does Y work" / a concept you cannot name exactly → `search_context`
- an exact string/identifier you can type verbatim → `search_code`

### Workflow

Call `search_context` first for fuzzy/conceptual questions → it returns ranked snippets with a `chunk_id`; call `expand_context(chunk_id)` for full bodies instead of re-reading whole files. For exact symbols, callers/callees, and blast radius use the structural tools above — they are faster and more precise than `search_context`.

### Project Context

- **Project ID**: exams-generator
- **Stack**: TypeScript, JavaScript — frameworks: Angular, NestJS — package manager: pnpm

## Module Documentation

Detected modules:
- apps
- docs
- infra
- packages

For each module stub in docs/modules/:
1. Read the stub file.
2. Fill in each section (Purpose, Key Files, Dependencies, Data Flow, Gotchas, Last Updated).
3. Call add_knowledge with the filled content, source: "docs/modules/<name>.md",
   tags: ["module", "<name>"].
Do this automatically when you open a project session and a stub is unfilled.

<!-- project-brain:end -->
