# Plan de mejora — subida de preguntas por foto, rumbo al MVP

**Fecha:** 2026-09-02
**Base:** `2026-09-02-bank-new-upload-flow.md` (auditoría + corrida end-to-end con DeepSeek V4).
**Criterio de orden:** primero lo que hace guardar datos falsos o deja al profesor trabado; después lo que hace el flujo entendible sin explicación; al final accesibilidad mínima y deuda. Estimaciones para una persona con el repo ya en la cabeza.

## Fase 0 — cerrar lo que ya está hecho (hoy)

- [x] Commit de la rama actual (`836e5c5`): soporte DeepSeek (`AI_RESPONSE_FORMAT`, `AI_THINKING`, errores del proveedor con cuerpo, compose y `env.example`). Tests 1304/1304, typecheck limpio.
- [ ] Limpiar el `.env` local: borrar `AI_MODEL=deepseek-chat` y el `AI_VISION_MODEL` de nemotron duplicados arriba.
- [ ] Dokploy: cargar las seis variables `AI_*` (base url, key, model, vision model, response format, thinking=disabled).
- [ ] Borrar las tres preguntas de prueba de la DB local (dos "Genética y herencia" de biología y el circuito `ce72935a-…`), o dejarlas como ejemplos.

## Fase 1 — confiabilidad: nada falso, nadie trabado (2 días)

| # | Qué | Hallazgo | Esfuerzo |
|---|---|---|---|
| 1 | **Extracción sin alternativas en la foto → no inventar.** `EXTRACT_RESPONSE_JSON_SCHEMA`: `alternatives` puede venir vacío y `correctAnswer` nulo. Prompt: "si la imagen no muestra alternativas, devuelve `[]`; si no muestra la clave, `null`". Validador de extracción tolera ambos. Web: si llegan vacías, mensaje "La foto no trae alternativas, escríbelas" y clave en blanco. Nunca precargar una clave que la imagen no muestra. | H6 | 4 h |
| 2 | **IA no configurada → 503 honesto.** `AiNotConfiguredError` en el resolver, `mapAiProviderError` lo manda a 503 con `code: "ai_not_configured"`. Web: "La extracción con IA no está habilitada en este colegio" y sin botón de reintento. WARN al boot si no hay key. | H1 | 2 h |
| 3 | **Timeout cliente** en `extractQuestionFromImage` y `recropExtraction`, mismo `timeout({ each })` que los streams. Con DeepSeek la extracción tarda 25–50 s: poner 120 s y un texto de progreso ("Leyendo la foto…"). | M6 | 1 h |
| 4 | **Recrop stale**: comparar `extractionId` capturado con el actual en `onRecrop.next`; descartar si cambió. | M5 | 30 min |
| 5 | **Guard de salida**: `canDeactivate` en `bank/new` cuando hay `cropSlots`, `extracting` o `saving`. | M7 | 1.5 h |
| 6 | **Sugerencia de la IA visible** cuando no matchea la taxonomía: "La IA sugiere: Biología / Irritabilidad y taxia" debajo de Curso/Tema. | L9 | 1 h |

Salida de fase: el profesor nunca guarda opciones inventadas, nunca ve "inténtalo de nuevo" por un error de configuración, nunca se queda con el botón girando, y no pierde una revisión por un clic en el menú.

## Fase 2 — intuitividad: el flujo se explica solo (2 días)

| # | Qué | Hallazgo | Esfuerzo |
|---|---|---|---|
| 7 | **Reordenar el tab Foto.** Arriba: imagen y grado. Debajo, "Extraer con IA" como botón primario con helper "Necesita grado e imagen". Después, el resto de campos (que la IA precarga). "Guardar foto tal cual" pasa a secundario. | M4 | 3 h |
| 8 | **Confirmación de guardado.** `router.navigate(['/app/bank'], { state: { createdId } })`; `bank-list` inyecta `ActivatedRoute`, expande curso/tema y resalta la fila 3 s. Alternativa barata: toast "Pregunta guardada" con link. | M1 | 3 h |
| 9 | **Drag-and-drop real** en los dos controles de subida (`dragover` + `drop` → `setImage`), o quitar "Arrastra" del copy. | M2 | 1 h |
| 10 | **Anillo de foco** en los labels de subida (`focus-within:ring-2`). | M3 | 15 min |
| 11 | **Aviso antes de cambiar de tab**: al terminar la extracción, texto arriba del tab structured "Revisa lo que leyó la IA antes de guardar" y foco en el h2. | M13, nota UX | 1 h |
| 12 | Limpiar el alert de extracción al editar; label "Clave (a/b/c/d/e)"; hint de validación que liste solo lo que falta. | L3, L10, AX-F3 nota | 1 h |
| 13 | **Filas tipo imagen con título**: `sourceName` = nombre del archivo al crear, y "Pregunta con imagen" como fallback en `questionSnippet`. **Grado visible** en los nodos de tema duplicados del árbol. | L1, L4 | 2 h |

Salida de fase: un profesor nuevo llega a "Extraer con IA" sin leer nada, sabe qué pasó al guardar y encuentra su pregunta.

## Fase 3 — accesibilidad mínima para no bloquear a nadie (1.5 días)

| # | Qué | Hallazgo | Esfuerzo |
|---|---|---|---|
| 14 | Handles de recorte con hit-area de 44 px (`before:` invisible), punto visual igual. | H3 | 1 h |
| 15 | Teclado en el editor de recorte: contenedor focusable, flechas mueven, Shift+flechas redimensionan, Enter aplica. | H2 | 3 h |
| 16 | Región `aria-live="polite"` para "Extrayendo…", "Pregunta extraída", "Guardando…". `aria-busy` en `ui-button` cuando `loading`. | M12 | 1.5 h |
| 17 | `required` → `aria-required` en `ui-input`/`ui-select`; `aria-describedby` passthrough en `ui-button`. | M11 | 1.5 h |
| 18 | Verificar con VoiceOver si el `ui-select` anuncia el valor; si no, incluir el span del valor en `aria-labelledby`. | M14 | 30 min |

## Fase 4 — deuda, después del MVP

- Revocar object URLs en `DestroyRef` (M8). `switchMap` en los effects de taxonomía (M9).
- Partir `bank-new.component.ts` (791 líneas): `photo-tab`, `structured-tab`, `QuestionSaveChainService`, `TaxonomyMatcher` (M10).
- `forkJoin` en la cadena de guardado, `aspect-ratio` en la preview del recorte, un solo `<h1>` por página (L6, L7, L8).
- Lint: dos errores preexistentes en `ai-jobs.controller.ts` y `ai-generate-stream.e2e.spec.ts` (`no-misused-promises`).
- Seguridad de herramientas: project-brain indexó el `.env`; que respete `.gitignore` y reindexar.

## Fuera del plan, decisiones que son tuyas

- **Costo y latencia de DeepSeek Vision** (25–50 s por foto). Aceptable para MVP si el progreso se muestra (ítem 3). Si no, evaluar un modelo de visión más rápido para extracción y dejar V4 Flash para generar/revisar; el adapter ya separa `AI_VISION_MODEL`, pero comparte `AI_BASE_URL`, así que un proveedor distinto para visión requeriría un `AI_VISION_BASE_URL`.
- **Persistir la revisión de recortes** en `sessionStorage` como hace `exam-builder`: útil, no bloqueante.

## Orden sugerido de commits

1. `feat(ai): support DeepSeek V4 — json_object output, thinking switch, provider error detail` (ya hecho, sin commitear)
2. `fix(ai): let extraction return no alternatives instead of inventing them` (ítem 1)
3. `fix(ai): surface missing AI configuration as 503 with an honest message` (ítem 2)
4. `fix(web): timeout, stale recrop guard and leave guard on bank-new` (ítems 3–5)
5. `feat(web): reorder photo tab around Extraer con IA and confirm saves` (ítems 6–8)
6. `fix(web): upload control drop, focus ring, copy and image-row titles` (ítems 9–13)
7. `feat(web): keyboard and screen-reader support for crop review` (ítems 14–18)
