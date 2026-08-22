# Diseño — Soporte de LaTeX en matemáticas generadas por IA (vía mitex)

**Fecha:** 2026-07-20
**Estado:** Aprobado
**Alcance:** Permitir que el generador de preguntas IA escriba matemáticas en LaTeX (`\frac`, `\circ`, `\angle`...) además de la sintaxis Typst nativa que ya soporta, usando el paquete `@preview/mitex` para que Typst pueda compilarlo. Incluye, como prerequisito, corregir un desfase real de versión de `typst` entre dev y producción.

---

## 0. Contexto — cómo se descubrió

Revisando `apps/api/logs/typst-failures.log` (archivo huérfano, gitignored, sin escritor actual en el código — nada en `src` lo escribe hoy) apareció un fallo real de una pregunta generada: `error: unknown variable: circ`, causado por el modelo escribiendo `$"BAD" = 70^{\circ}$` (LaTeX) en vez de sintaxis Typst. El mecanismo de retry-con-error-real (`f56a875`, `generate-questions.service.ts`) y el prompt (`TYPST_MATH_RULES`) ya existen para EVITAR que esto pase — pero el usuario pidió, en vez de solo blindar contra LaTeX, soportarlo de verdad.

## 1. Prerequisito — desfase de versión de typst (bug real, verificado)

`infra/Dockerfile.api:6` fija `ARG TYPST_VERSION=0.12.0` — sin overrides en ningún workflow, compose o script de deploy (verificado con `rg` en todo el repo). Pero:

- `openrouter-request-builder.ts:104-114` pinea CeTZ `@preview/cetz:0.5.2` con el comentario "verificado contra el binario pinneado en `infra/Dockerfile.api` (`TYPST_VERSION=0.15.1`)" — cita una versión que el Dockerfile nunca tuvo.
- `apps/api/scripts/install-typst-dev.sh:15` sí fija `0.15.1`, y su comentario dice "Keep this in sync with infra/Dockerfile.api's ARG TYPST_VERSION" — nunca se sincronizó.
- `typst-cli.adapter.golden.spec.ts:16` documenta "0.12.0 at time of writing".

Efecto: en producción, cualquier pregunta con `figureCode` (diagrama CeTZ) probablemente falla el compile con "package requires typst X.Y, current is 0.12.0" — silencioso, cae en el retry existente, y si sigue fallando el item se marca `failed` sin que quede claro por qué.

**Cambio**: `infra/Dockerfile.api:6` → `ARG TYPST_VERSION=0.15.1`. Actualizar el comentario de `typst-cli.adapter.golden.spec.ts:16` ("0.12.0 at time of writing" → "0.15.1"). Sin cambios en `install-typst-dev.sh` (ya correcto).

Verificado: `@preview/mitex:0.2.7` (última versión en Typst Universe) no declara un `compiler` mínimo en su `typst.toml` — compatible con 0.15.1 sin fricción adicional.

## 2. Prompt — nuevo bloque `MITEX_RULES`

En `openrouter-request-builder.ts`, junto a `CETZ_RULES` (línea 126), un bloque paralelo:

- Sintaxis Typst nativa dentro de `$...$` sigue siendo la opción por defecto (sin cambio a los ejemplos existentes de `TYPST_MATH_RULES`).
- Si el modelo prefiere LaTeX para una expresión, debe envolverla explícitamente: `#mi("\frac{1}{2}")` inline o `#mitex(\`...\`)`para bloque — **nunca** LaTeX suelto dentro de`$...$` (eso Typst no lo compila, sea cual sea la versión).
- Debe incluir su propio `#import "@preview/mitex:0.2.7": mi, mitex` dentro de `bodyTypst`, solo si de hecho usa `#mi()`/`#mitex()` — mismo patrón que `CETZ_RULES` ya exige para `figureCode` (import inline, no global).
- `TYPST_MATH_RULES` (línea 99) se ajusta: la prohibición de backslash sigue aplicando a `$...$` suelto; se agrega una frase aclarando que LaTeX SÍ es válido envuelto en `#mi()`/`#mitex()`.
- `MITEX_RULES` se agrega a los 3 `SYSTEM_PROMPT` que ya comparten `CETZ_RULES` (generate, revise, extract — líneas 178, 231, 293).

## 3. Validador — sin cambios de lógica, solo un test nuevo

`openrouter-response-validator.ts` (`findLatexCommandInMath`, agregado hoy) escanea únicamente segmentos `$...$` crudos. LaTeX correctamente envuelto vive DENTRO de un string/raw-arg de `#mi()`/`#mitex()` — fuera de `$...$` por completo — así que nunca lo marca como error. Sigue atajando el caso real (LaTeX filtrado sin envolver, ej. `$70^{\circ}$` suelto).

**Cambio**: un test de regresión en `openrouter-response-validator.spec.ts` confirmando que `#mi("\frac{1}{2}")` (LaTeX bien envuelto) pasa la validación sin error.

## 4. Pipeline de compile — sin cambios

`typst-cli.adapter.ts` y `typst-template.ts` embeben `bodyTypst` verbatim, como ya hacen con `figureCode`/CeTZ. Si el modelo usa `#mi(...)` sin su `#import`, Typst falla con "unknown variable: mi" — mismo tipo de error de compile que el caso `\circ` original documentado en §0, así que cae en el retry ya existente (`generate-questions.service.ts:27`, `MAX_COMPILE_ATTEMPTS=2`) con el `stderr` real re-inyectado al prompt. Cero plumbing nuevo.

## 5. Testing

- `typst-cli.adapter.golden.spec.ts`: nuevo caso que compila una pregunta usando `#mi("\frac{1}{2}")` contra el binario real (0.15.1) + mitex 0.2.7 — el único test realmente load-bearing de este cambio, ya que el resto es texto de prompt (no verificable por test unitario) o lógica de validador ya cubierta.
- `openrouter-request-builder.spec.ts`: assert de que `MITEX_RULES` aparece en los 3 system prompts (mismo patrón que el test existente de línea 120 para el pin de CeTZ).
- `openrouter-response-validator.spec.ts`: caso "acepta LaTeX envuelto en `#mi()`" (§3).

## 6. Manejo de errores

Sin cambios: compile falla → retry con `stderr` real → si sigue fallando tras `MAX_COMPILE_ATTEMPTS`, el item se marca `failed` con `"Typst compile failed: ..."` visible al profesor. No se introduce una clase de error nueva.

## 7. Fuera de alcance

- Auto-detección/reescritura de LaTeX suelto sin envolver (evaluado y descartado — ambiguo cuando un `$...$` mezcla Typst y LaTeX).
- Soporte LaTeX en `figureCode`/CeTZ (mitex es para texto matemático, no aplica a diagramas).
- Cambiar `MAX_COMPILE_ATTEMPTS` (2) o `MAX_ATTEMPTS` (2, validación JSON) — presupuestos de retry existentes, no tocados.
- Import global de mitex en el template del documento (evaluado como approach B, descartado — acopla todo examen a la disponibilidad de mitex en vez de solo las preguntas que lo usan).

## 8. Referencias (file:line)

- Log que originó la investigación: `apps/api/logs/typst-failures.log` (huérfano, gitignored).
- Desfase de versión: `infra/Dockerfile.api:6`, `apps/api/scripts/install-typst-dev.sh:15`, `openrouter-request-builder.ts:104-114`, `typst-cli.adapter.golden.spec.ts:16`.
- Prompt actual: `openrouter-request-builder.ts` — `TYPST_MATH_RULES` (93-102), `CETZ_RULES` (126-135), `SYSTEM_PROMPT`/`REVISE_SYSTEM_PROMPT`/`EXTRACT_SYSTEM_PROMPT` (175-182, 227-235, 289-296).
- Validador: `openrouter-response-validator.ts` — `findLatexCommandInMath` (agregado en esta sesión, previo a este spec).
- Retry de compile: `generate-questions.service.ts:27` (`MAX_COMPILE_ATTEMPTS`), `:233-272` (`generateOneItem`).
- Retry de validación JSON: `openrouter.adapter.ts:23` (`MAX_ATTEMPTS`), `:166-190` (`runWithRetries`).
- Paquete verificado: `@preview/mitex:0.2.7` (https://typst.app/universe/package/mitex/), manifest sin `compiler` mínimo declarado (`github.com/mitex-rs/mitex/packages/mitex/typst.toml`).
