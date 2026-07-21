# LaTeX Math Support (via mitex) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the AI question generator write LaTeX math (`\frac`, `\circ`, `\angle`...) wrapped in `#mi()`/`#mitex()`, alongside the Typst-native math it already supports, and fix the `typst` version drift between dev and prod that this feature depends on.

**Architecture:** Prompt-only feature (no new runtime code path) — the model is told about a new escape hatch (`@preview/mitex:0.2.7`) via a new `MITEX_RULES` block mirroring the existing `CETZ_RULES` pattern. The existing validator, compile pipeline, and compile-retry loop need zero logic changes because mitex calls live outside the `$...$` segments the validator already scopes to. Prerequisite: `infra/Dockerfile.api`'s pinned `typst` version is wrong (`0.12.0`, should be `0.15.1`) — fixed first since mitex's compatibility claim depends on it.

**Tech Stack:** TypeScript, NestJS, Jest, real `typst` CLI (golden/e2e tests), `@preview/mitex:0.2.7` Typst package (network-fetched by the `typst` binary at compile time, same as `@preview/cetz:0.5.2` already is).

## Global Constraints

- Typst version target: `0.15.1` (verified locally installed, verified mitex 0.2.7 has no `compiler` floor in its manifest — no incompatibility risk).
- `mitex` import must be **inline, per-question, only when used** — never a global/always-on import in `typst-template.ts` (design spec §7, approach B rejected: would couple every exam compile to mitex availability).
- No changes to `MAX_COMPILE_ATTEMPTS` (2, `generate-questions.service.ts:27`) or `MAX_ATTEMPTS` (2, `openrouter.adapter.ts:23`).
- Spec: `docs/superpowers/specs/2026-07-20-latex-math-support-design.md` — read for full rationale before starting.

---

### Task 1: Fix typst version drift (prerequisite)

**Files:**
- Modify: `infra/Dockerfile.api:6`
- Modify: `apps/api/src/modules/exams/adapters/pdf/typst-cli.adapter.golden.spec.ts:16`

**Interfaces:** None — config/comment only, no code signatures involved.

- [ ] **Step 1: Bump the Dockerfile pin**

In `infra/Dockerfile.api`, change line 6 from:
```dockerfile
ARG TYPST_VERSION=0.12.0
```
to:
```dockerfile
ARG TYPST_VERSION=0.15.1
```

- [ ] **Step 2: Fix the stale golden-spec comment**

In `apps/api/src/modules/exams/adapters/pdf/typst-cli.adapter.golden.spec.ts`, the doc comment (around line 16) currently reads:
```typescript
 * Guarded with `describe.skip` (not a fake pass) when the `typst` binary
 * isn't installed — see infra/Dockerfile.api for the pinned version this
 * project expects (0.12.0 at time of writing).
 */
```
Change `(0.12.0 at time of writing)` to `(0.15.1 at time of writing)`.

- [ ] **Step 3: Verify no other stale references**

Run: `rg -n "0\.12\.0" infra/Dockerfile.api apps/api/src apps/api/scripts`
Expected: no output (all references now point at 0.15.1, or the line was CeTZ/mitex-unrelated).

- [ ] **Step 4: Commit**

```bash
git add infra/Dockerfile.api apps/api/src/modules/exams/adapters/pdf/typst-cli.adapter.golden.spec.ts
GIT_COMMIT_SKILL=1 git commit -m "fix(infra): bump pinned typst version to 0.15.1, matching what CeTZ/dev already assume"
```

---

### Task 2: Add `MITEX_RULES` prompt block and wire into all 3 system prompts

**Files:**
- Modify: `apps/api/src/modules/ai/adapters/openrouter/openrouter-request-builder.ts`
- Test: `apps/api/src/modules/ai/adapters/openrouter/openrouter-request-builder.spec.ts`

**Interfaces:**
- Consumes: nothing new — `MITEX_RULES` is a plain `string` constant, same shape as `CETZ_RULES` (line 126) and `ALTERNATIVES_RULES` (line 155).
- Produces: `MITEX_RULES: string`, appended into `SYSTEM_PROMPT` (line 175), `REVISE_SYSTEM_PROMPT` (line 227), `EXTRACT_SYSTEM_PROMPT` (line 289) — same join pattern already used for `CETZ_RULES`.

- [ ] **Step 1: Write the failing tests**

Add to `openrouter-request-builder.spec.ts`, right after the existing `"pins the CeTZ package version..."` test in the `buildOpenRouterRequestBody` describe block (after line 125):

```typescript
  it("tells the model it may use LaTeX math via mitex, wrapped explicitly", () => {
    const body = buildOpenRouterRequestBody("some/free-model:free", INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("@preview/mitex:0.2.7");
    expect(promptText).toContain("#mi(");
    expect(promptText).toContain("#mitex(");
  });
```

Add to the `buildOpenRouterReviseRequestBody` describe block, right after its `"pins the CeTZ package version..."` test (after line 210):

```typescript
  it("tells the model it may use LaTeX math via mitex, wrapped explicitly", () => {
    const body = buildOpenRouterReviseRequestBody("some/free-model:free", REVISE_INPUT);

    const promptText = promptTextOf(body);
    expect(promptText).toContain("@preview/mitex:0.2.7");
  });
```

Add to the `buildOpenRouterExtractRequestBody` describe block, right after its `"pins the CeTZ package version..."` test (after line 269):

```typescript
  it("tells the model it may use LaTeX math via mitex, wrapped explicitly", () => {
    const body = buildOpenRouterExtractRequestBody("some/free-model:free", EXTRACT_INPUT);

    const systemMessage = body.messages.find((m) => m.role === "system");
    expect(systemMessage!.content as string).toContain("@preview/mitex:0.2.7");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/api && npx jest src/modules/ai/adapters/openrouter/openrouter-request-builder.spec.ts -t "mitex"`
Expected: 3 FAIL, "expected substring ... not found" (constant doesn't exist yet).

- [ ] **Step 3: Add `MITEX_RULES` and wire it in**

In `openrouter-request-builder.ts`, insert right after `CETZ_RULES` (after line 135, before the `ALTERNATIVES_RULES` block at line 155):

```typescript
/**
 * Typst's native math mode CANNOT parse LaTeX commands (`\frac`, `\circ`,
 * `\angle`...) — confirmed in production ("unknown variable: circ" when a
 * model wrote `$70^{\circ}$"). `TYPST_MATH_RULES` bans that pattern, but
 * models are trained overwhelmingly on LaTeX, so instead of only banning it,
 * give an explicit escape hatch: `@preview/mitex` compiles real LaTeX when
 * called through its own functions. The import is INLINE per question (same
 * pattern as CETZ_RULES for figureCode), not global in the document
 * template — so a question that never uses LaTeX has zero dependency on
 * mitex being reachable.
 */
const MITEX_RULES = [
  "Si prefieres escribir una expresión matemática en LaTeX en vez de sintaxis Typst, está permitido, pero SOLO envuelta explícitamente — LaTeX suelto dentro de $...$ sigue prohibido y no compila:",
  'expresión inline: #mi("\\frac{1}{2}") — expresión en bloque: #mitex(`\\int_0^1 x^2 dx`).',
  'Para usar #mi()/#mitex() debes incluir, dentro de bodyTypst, ANTES del primer uso, exactamente: #import "@preview/mitex:0.2.7": mi, mitex — solo si de hecho los usas, nunca si toda la pregunta usa sintaxis Typst nativa.',
  'Ejemplo válido completo: #import "@preview/mitex:0.2.7": mi Si #mi("\\angle BAD = 70^\\circ") entonces...',
].join(" ");
```

Then update the three prompt arrays to include it, mirroring exactly how `CETZ_RULES` is already listed:

```typescript
const SYSTEM_PROMPT = [
  "Eres un generador de preguntas tipo examen de admisión para colegios/academias peruanas.",
  "Responde EXCLUSIVAMENTE con el objeto JSON solicitado por el schema, sin explicaciones ni texto adicional.",
  TYPST_MATH_RULES,
  MITEX_RULES,
  CETZ_RULES,
  ALTERNATIVES_RULES,
  DIFFICULTY_CALIBRATION_RULES,
].join(" ");
```

```typescript
const REVISE_SYSTEM_PROMPT = [
  "Eres un editor experto de preguntas tipo examen de admisión para colegios/academias peruanas.",
  "Se te dará una pregunta existente y una instrucción de edición del profesor; produce una NUEVA versión de la pregunta que cumpla la instrucción.",
  "Responde EXCLUSIVAMENTE con el objeto JSON solicitado por el schema, sin explicaciones ni texto adicional.",
  TYPST_MATH_RULES,
  MITEX_RULES,
  CETZ_RULES,
  ALTERNATIVES_RULES,
  DIFFICULTY_CALIBRATION_RULES,
].join(" ");
```

```typescript
const EXTRACT_SYSTEM_PROMPT = [
  "Eres un asistente que extrae preguntas tipo examen de admisión desde fotos de material impreso o manuscrito peruano.",
  "Lee la imagen y transcribe la pregunta que contiene: enunciado, alternativas y, si es identificable, la alternativa correcta.",
  "Responde EXCLUSIVAMENTE con el objeto JSON solicitado por el schema, sin explicaciones ni texto adicional.",
  TYPST_MATH_RULES,
  MITEX_RULES,
  CETZ_RULES,
  ALTERNATIVES_RULES,
].join(" ");
```

Also adjust the last sentence of `TYPST_MATH_RULES` (line 99) — currently:
```typescript
  "PROHIBIDO cualquier comando con barra invertida (\\frac, \\sqrt, \\times, \\left, \\right...) — Typst no los compila.",
```
Change to:
```typescript
  "PROHIBIDO cualquier comando con barra invertida (\\frac, \\sqrt, \\times, \\left, \\right...) SUELTO dentro de $...$ — Typst no lo compila así. Si necesitas esos comandos, usa LaTeX vía mitex (ver regla siguiente).",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/api && npx jest src/modules/ai/adapters/openrouter/openrouter-request-builder.spec.ts`
Expected: all PASS (including the 3 new tests and all pre-existing ones — pre-existing tests only assert substrings that remain present, unaffected by the new block).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/ai/adapters/openrouter/openrouter-request-builder.ts apps/api/src/modules/ai/adapters/openrouter/openrouter-request-builder.spec.ts
GIT_COMMIT_SKILL=1 git commit -m "feat(ai): let the question generator write LaTeX math via mitex"
```

---

### Task 3: Validator regression test — wrapped LaTeX passes

**CORRECTION (post-implementation):** this task's original premise was wrong. `findLatexCommandInMath` did NOT already exist — there was no runtime enforcement of `TYPST_MATH_RULES` at all, only the prompt instruction plus the compile-retry safety net. Task 3 ended up needing a real implementation, not just a regression test. Committed as `379a069` (`feat(ai): detect raw LaTeX in math mode while allowing mitex-wrapped expressions`), separate from the test commit `f4d87a3` below. The function's actual behavior (scoped to `$...$` only) still matches this task's intent — the deviation is "who wrote it and when," not "what it does."

**Files:**
- Test: `apps/api/src/modules/ai/adapters/openrouter/openrouter-response-validator.spec.ts`
- Modify: `apps/api/src/modules/ai/adapters/openrouter/openrouter-response-validator.ts` (NOT originally planned — see correction above)

**Interfaces:**
- Consumes: `validateGeneratedQuestionShape` (existing, `openrouter-response-validator.ts`).
- Produces: `findLatexCommandInMath(bodyTypst: string): string | undefined` (new, private to the module) — scans only `$...$` segments for a bare `\command`, so `#mi("...")`/`#mitex(...)` content (outside `$...$`) is correctly ignored.

- [ ] **Step 1: Write the test**

Add to `openrouter-response-validator.spec.ts`, after the `"accepts a lone backslash outside math mode..."` test (end of file, before the closing `});`):

```typescript
  it("accepts LaTeX wrapped in #mi(), even though it contains backslash commands", () => {
    const result = validateGeneratedQuestionShape({
      ...VALID,
      bodyTypst:
        'El área es #mi("\\frac{1}{2} \\cdot b \\cdot h") — con $b$ y $h$ en cm.',
    });

    expect(result.bodyTypst).toContain('#mi("\\frac{1}{2}');
  });
```

- [ ] **Step 2: Run test to verify it passes (no implementation change expected)**

Run: `cd apps/api && npx jest src/modules/ai/adapters/openrouter/openrouter-response-validator.spec.ts`
Expected: all PASS, including the new test, with ZERO changes to `openrouter-response-validator.ts` — this proves the design spec's §3 claim ("validator needs no logic change") is actually true, not just assumed. If it FAILS, `findLatexCommandInMath`'s `$...$` scoping is wrong and needs to be revisited before continuing.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/ai/adapters/openrouter/openrouter-response-validator.spec.ts
GIT_COMMIT_SKILL=1 git commit -m "test(ai): prove the LaTeX-in-math validator ignores mitex-wrapped content"
```

---

### Task 4: Golden compile test — mitex actually compiles against the real binary

**Files:**
- Modify: `apps/api/src/modules/exams/adapters/pdf/typst-cli.adapter.golden.spec.ts`

**Interfaces:**
- Consumes: `TypstCliAdapter.compileExam` (existing, `typst-cli.adapter.ts`), `ExamPdfDocumentInput`/`ExamPdfQuestion` (existing types, `pdf-compiler.port.ts`) — a `structured` question with `bodyTypst` containing a `#mi()` call and its own inline `#import`, same shape a real AI-generated question would have per Task 2's prompt rule.
- Produces: nothing new — this is the one test in the whole plan that proves the feature actually works end-to-end against the real `typst` binary + real `@preview/mitex:0.2.7` package fetch.

- [ ] **Step 1: Write the failing test**

Add to `typst-cli.adapter.golden.spec.ts`, after the `"compiles a mixed image + structured exam..."` test (find its closing `});` and add right after):

```typescript
  it("compiles a structured question using LaTeX math via mitex into a valid PDF", async () => {
    const adapter = new TypstCliAdapter();

    const pdf = await adapter.compileExam({
      title: "Simulacro San Marcos",
      versionLabel: "Version A",
      questions: [
        {
          id: "q-mitex",
          type: "structured",
          bodyTypst:
            '#import "@preview/mitex:0.2.7": mi Si $angle.b = 70$ grados, halla #mi("\\frac{1}{2} \\cdot 70^\\circ").',
          alternatives: ["35", "70", "140", "17.5", "N.A."],
          figureCode: null,
        },
      ],
    });

    expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
```

- [ ] **Step 2: Run test to verify it fails first (sanity check the harness), then implement**

This task has no separate "implementation" step — Task 1 (version bump) and Task 2 (prompt) already make the underlying capability work; this test only needs the `typst` binary + network access to fetch `@preview/mitex:0.2.7` (already verified manually: `typst compile` against a `#mi()` snippet succeeds locally with typst 0.15.1, package downloads in ~1s).

Run: `cd apps/api && npx jest src/modules/exams/adapters/pdf/typst-cli.adapter.golden.spec.ts -t "mitex"`
Expected: PASS on the first run (nothing left to implement — this is a verification test, not a TDD-red step). If it fails, read the `stderr` in the thrown `TypstCompilationError` message — most likely cause is a typo in the inline `#import` line above.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/exams/adapters/pdf/typst-cli.adapter.golden.spec.ts
GIT_COMMIT_SKILL=1 git commit -m "test(pdf): prove mitex-wrapped LaTeX math compiles against the real typst binary"
```

---

### Task 5: Full regression run

**Files:** None modified — verification only.

**Interfaces:** None.

- [ ] **Step 1: Run the full API test suite**

Run: `cd apps/api && npx jest`
Expected: same pass/fail count as the pre-existing baseline (2 known-failing e2e tests in `ai.e2e.spec.ts`, pre-existing and unrelated — see `docs/superpowers/specs/2026-07-20-latex-math-support-design.md` §0 context and prior session notes). No NEW failures introduced by Tasks 1-4.

- [ ] **Step 2: If any NEW failure appears, stop and diagnose**

Do not proceed past a new failure — this plan touches a shared prompt string consumed by all three generation paths (generate/revise/extract); a regression here is high-blast-radius.
