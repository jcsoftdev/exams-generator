# Diseño — Editar borradores en la cola de revisión

**Fecha:** 2026-07-20
**Estado:** Aprobado
**Alcance:** Activar el botón "Editar" (hoy inerte) en `ai-review-queue.component`, permitiendo editar cualquier campo de un borrador antes de aprobar/rechazar — inline en el panel de detalle, mismo patrón que `bank-list.component` (spec previo: `2026-07-19-question-editing-ai-design.md`).

---

## 1. Propósito

La cola de revisión (`Cola de revisión · N`) es el único filtro humano antes de que una pregunta generada por IA entre al banco (design doc §5.2 — "la IA nunca publica directo"). Hoy solo se puede **Aprobar** o **Rechazar** un borrador completo — si el enunciado, una alternativa, la clave o la figura CeTZ tienen un error (todo lo que arreglamos hoy: versión de CeTZ, alternativas duplicadas, conectividad de polígonos), la única opción es rechazar TODO el borrador y regenerar desde cero, perdiendo lo que sí estaba bien.

Este cambio permite corregir el borrador in situ, reusando exactamente la infraestructura que `bank-list` ya construyó y probó ayer.

## 2. Por qué esto es trabajo casi 100% frontend

Verificado directamente en el backend antes de diseñar:
- `PATCH /bank/questions/:id` (`bank.service.ts:editDraftQuestion` vía `requireManageableQuestion`) ya acepta status `draft` **y** `approved` — nada que cambiar.
- El payload de esa ruta (`validate-update-structured-question.ts`) ya acepta `figureCode` — nada que cambiar.
- `POST /ai/questions/:id/revise` (`revise-question.service.ts`) ya devuelve `figureCode` en su respuesta (mismo `RESPONSE_JSON_SCHEMA` que generar) — nada que cambiar.

Lo único que falta es: (a) tipar esos dos campos en los modelos TypeScript del frontend, que se quedaron cortos respecto al backend, y (b) construir el formulario + wiring en `ai-review-queue.component`.

## 3. Cambios de modelo (frontend)

- `UpdateQuestionPayload` (`bank.models.ts`): agregar `readonly figureCode?: string`.
- `AiRevisedQuestion` (`ai.models.ts`): agregar `readonly figureCode?: string | null`.

## 4. Componente — `ai-review-queue.component.ts`

Mirroring exacto de `bank-list.component.ts`, simplificado porque `DraftQuestion` **siempre** es estructurado (nunca `image` — design doc §5.2, "AI-generated questions are ALWAYS structured"): sin rama de imagen/OCR.

**Inyección nueva:** `BankService` (para `updateQuestion`).

**Signals nuevos** (mismo naming que bank-list para consistencia):
`editing`, `editSaving`, `editError`, `editCourseId`, `editTopicId`, `editDifficulty`, `editGradeLevel`, `editCorrectAnswer` (string índice "0"-"4"), `editBody`, `editAlternatives` (textarea, una por línea), `editFigureCode`, `editCourses`, `editTopics` (catálogo para los selects, cargado por `editGradeLevel`/`editCourseId` igual que `onGradeLevelChange`/`onCourseChange` en `ai-generate.component`).

**Métodos:**
- `startEdit(draft: DraftQuestion)`: siembra todos los signals desde `draft`, carga cursos vía `taxonomyService.getCourses(draft.gradeLevel)` y temas vía `getTopics(draft.courseId, draft.gradeLevel)`, pone `editing.set(true)`.
- `onEditGradeLevelChange` / `onEditCourseChange`: mismo patrón cascada que `ai-generate.component` (cambiar grado resetea curso+tema; cambiar curso resetea tema).
- `saveEdit()`: arma `UpdateQuestionPayload` completo (incluye `figureCode`), llama `bankService.updateQuestion(draft.id, patch)`. Al éxito: `editing.set(false)`, recarga la cola (`load()`) y recompila el preview del draft (`compilePreview(id)` si sigue siendo el seleccionado). Al error: `editError` con mensaje, mismo patrón que `approve`/`confirmReject`.
- `cancelEdit()`: `editing.set(false)`, limpia `editError`.
- **Caja de IA** (`aiInstruction`, `revising`, `aiError`, `reviseWithAi()`): llama `aiService.reviseQuestion(draft.id, instruction)`, puebla `editBody`/`editAlternatives`/`editCorrectAnswer`/`editFigureCode` — **nunca guarda sola**, el profesor revisa y presiona Guardar explícitamente (misma garantía de "IA nunca publica directo").

## 5. Template

- Botón "Editar" existente (`data-testid="edit"`, hoy sin `(clicked)`) → `(clicked)="startEdit(d)"`.
- Nuevo bloque `@if (editing())` que reemplaza el bloque de preview (mismo lugar donde hoy vive el iframe/fallback) con el formulario:
  - Selects grado/curso/tema (`ui-select`, mismo componente que `ai-generate`), dificultad (chips, mismo patrón que `ai-generate`).
  - Textarea enunciado (`data-testid="edit-body"`).
  - Textarea alternativas + radio de clave por línea (`data-testid="edit-alternatives"`).
  - Textarea figura CeTZ, opcional (`data-testid="edit-figure-code"`).
  - Caja IA: input instrucción + botón "Reescribir con IA" (`data-testid="ai-instruction"`, `data-testid="ai-revise"`).
  - Botones `Cancelar` / `Guardar` (`data-testid="edit-cancel"`, `data-testid="edit-save"`), `Guardar` deshabilitado mientras `editSaving()` o si falta curso/tema.

## 6. Validación y seguridad

Ninguna nueva — hereda todo de la infraestructura ya construida: compile-guard Typst server-side en el PATCH (una edición que no compila se rechaza, nunca se guarda), tenant-scoping vía `@CurrentUser()`, la IA nunca escribe en DB directamente.

## 7. Testing (TDD estricto, mismo patrón que toda la sesión)

- `ai-review-queue.component.spec.ts`: `startEdit` siembra los signals correctos y carga curso/tema; `saveEdit` llama `bankService.updateQuestion` con el payload correcto (incluyendo `figureCode`) y recarga; `cancelEdit` descarta sin guardar; `reviseWithAi` puebla los signals sin llamar `saveEdit`; error de guardado muestra `editError`.
- Reusar fixtures/mocks existentes del spec (`draft()`, `setup()`), extendidos con `BankService` mock.

## 8. Fuera de alcance

- Reemplazo de imagen / OCR (no aplica — drafts de IA siempre son `structured`).
- Historial de versiones de la edición.
- Regenerar automáticamente el `figureCode` vía "revisar con IA" apuntando solo a la figura (la instrucción libre ya cubre ese caso: "corrige la figura, no dibuja un cometa").

## 9. Referencias (file:line)

- Precedente completo (ya implementado): `docs/superpowers/specs/2026-07-19-question-editing-ai-design.md`, `apps/web/src/app/features/bank/bank-list/bank-list.component.ts` (`startEdit`/`saveEdit`/`reviseWithAi`, líneas ~525-725).
- Botón inerte: `apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.html:73`.
- PATCH ya compatible con draft+figureCode: `apps/api/src/modules/bank/bank.service.ts:272` (`requireManageableQuestion`), `apps/api/src/modules/bank/domain/validate-update-structured-question.ts:8,39`.
- Revise ya devuelve figureCode: `apps/api/src/modules/ai/revise-question.service.ts:105`.
- Modelos a extender: `apps/web/src/app/features/bank/bank.models.ts:126-133` (`UpdateQuestionPayload`), `apps/web/src/app/features/ai/ai.models.ts:135-139` (`AiRevisedQuestion`).
