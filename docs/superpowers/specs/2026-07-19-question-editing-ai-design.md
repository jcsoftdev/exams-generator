# Diseño — Edición de preguntas (manual + asistida por IA)

**Fecha:** 2026-07-19
**Estado:** Borrador para revisión
**Alcance:** Convertir el botón "Editar" (hoy un stub roto) en una experiencia real de edición de preguntas del banco — inline en el panel de detalle — para preguntas estructuradas y de imagen, con asistencia de IA (reescritura por instrucción y extracción por OCR).

---

## 1. Propósito

El panel de detalle del banco (`bank-list.component`) muestra un botón **"Editar"** que hoy navega a `/app/bank/new?edit=<id>`, pero `bank-new.component` **ignora** ese query param — así que abre un formulario de creación vacío. Editar no funciona.

Además, el profesor no tiene forma de:

- Corregir un error en una pregunta ya guardada (estructurada o de imagen).
- Pedirle a la IA que ajuste una pregunta ("hazla más difícil", "corrige el error", "mejora los distractores").
- Convertir una foto de un enunciado en texto editable.

Este cambio entrega las tres capacidades, todas inline en el panel, respetando la convención existente **"la IA nunca publica directo"** (la salida de IA siempre cae en el formulario para revisión humana y validación server-side antes de guardar).

## 2. Usuario y decisiones fijadas (del brainstorm)

- **Superficie:** edición **inline en el panel de detalle** (el árbol queda visible; no hay página ni modal aparte).
- **Alcance de edición:** preguntas propias en estado **draft y approved** (nunca las del banco central, que son solo lectura). Si es `approved` **y** `usedInExamCount > 0` → banner de advertencia: los PDFs ya generados no se actualizan automáticamente.
- **Tipos:** ambos — **estructurada** (enunciado + alternativas + clave) e **imagen** (reemplazar imagen + clave).
- **IA (tres modos, todos por instrucción o imagen):**
  1. Reescritura por instrucción (más difícil / más fácil / corregir error / mejorar redacción / regenerar distractores).
  2. Generar/arreglar alternativas (caso particular de la reescritura por instrucción).
  3. Extracción por OCR (imagen → campos estructurados).
- **La IA nunca guarda:** su salida popula los campos del formulario; el profesor revisa y guarda con el flujo normal.
- **Entrega:** un solo diseño y una sola implementación cubriendo las 3 fases (edición manual, IA revise, OCR), con TDD estricto.

## 3. Arquitectura de la UI (panel inline)

El panel de detalle (`bank-list.component.html`, bloque `data-testid="bank-panel"`) gana un estado `editing` (signal). El botón **"Editar"** deja de navegar (`bank-list.component.ts:409-411`) y activa `editing`.

### 3.1 Modo lectura (actual) → modo edición

En modo edición el panel muestra un formulario:

**Campos comunes** (reusan `ui-select` / patrones de `bank-new`):

- Curso · Tema (dependiente del curso) · Nivel · Grado.
- Clave (respuesta correcta).

**Según tipo:**

- `structured`: enunciado (`textarea`, `bodyTypst`) + alternativas (`textarea`, una por línea).
- `image`: thumbnail actual + input de archivo "Reemplazar imagen" (opcional — si no se sube, la imagen se conserva).

**Advertencia de uso:** si `status === 'approved' && (usedInExamCount ?? 0) > 0`, banner ámbar (`ui-banner variant="warning"` o div `bg-warn-bg`): _"Esta pregunta se usa en N exámenes. Los PDFs ya generados no se actualizan automáticamente; regéneralos si hace falta."_

**Acciones:** `[Cancelar]` (descarta, vuelve a lectura) · `[Guardar cambios]`.

`usedInExamCount` ya viene en el detalle (`getQuestion`), así que no se necesita endpoint nuevo para la advertencia.

### 3.2 Caja de IA (dentro del modo edición)

Bloque `✨ Instrucción a la IA`:

- Input de texto para la instrucción + botón `Reescribir con IA`.
- Al responder, los campos revisados **populan el formulario** (idealmente resaltando lo que cambió) para que el profesor revise antes de guardar.
- Botón/afluente separado `Leer desde imagen` (OCR): sube una foto → rellena los campos estructurados.

## 4. Backend

### 4.1 Extender `PATCH /bank/:id` (edición manual)

Hoy `EditDraftQuestionBody` (`bank.controller.ts:47`, `~199`) solo acepta `bodyTypst`, `alternatives`, `correctAnswer` y está pensado para **drafts** (lo usa la cola de revisión IA). Se extiende:

- Aceptar además taxonomía editable: `courseId`, `topicId`, `difficulty`, `gradeLevel`.
- Permitir edición en preguntas `approved` propias (no solo draft; nunca central). **Hoy `editDraftQuestion` rechaza explícitamente cualquier estado ≠ `draft` (`bank.service.ts:251-252`, `ConflictException`); ese guard se relaja para permitir `approved` propias y se mantiene el bloqueo de central (403) y el tenant-scoping.**
- Conservar el guard de recompilación Typst para estructuradas (`validateUpdateStructuredQuestionInput` + `PdfCompilerPort` — una edición que no compila se rechaza; ver `bank.service.ts`). Invalida el cache de preview igual que hoy.
- No toca la imagen (ver 4.2).

### 4.2 Nuevo `POST /bank/:id/image` (reemplazo de imagen)

Multipart (`FileInterceptor`, como `POST /bank/image`). Sube una nueva imagen, crea el asset, repunta `imageAssetId` de la pregunta (solo para preguntas `type='image'` propias). Tenant-scoped vía `@CurrentUser()`.

### 4.3 IA — extender `QuestionGeneratorPort`

`QuestionGeneratorPort` (`ai/domain/ports/question-generator.port.ts`, hoy con generación) gana dos métodos, implementados por el adapter OpenRouter (real) y fakes (`in-memory`/`lazy`) para tests:

- **`reviseQuestion(input): Promise<RevisedQuestion>`** — recibe la pregunta actual (enunciado, alternativas, clave, taxonomía) + la instrucción; devuelve la versión revisada. **No persiste.**
- **`extractFromImage(input): Promise<ExtractedQuestion>`** — recibe los bytes de la imagen; devuelve `{ bodyTypst, alternatives, correctAnswer }`. **No persiste.**

Endpoints (módulo `ai`, junto a `POST /ai/questions/generate`):

- **`POST /ai/questions/:id/revise`** body `{ instruction }` → carga la pregunta (tenant-scoped, 404 si no existe/otro tenant), llama `reviseQuestion`, **valida** la salida con el mismo compile Typst que la edición manual, y devuelve el borrador revisado (sin guardar). 422 si la IA produce algo que no compila (con mensaje claro para reintentar).
- **`POST /ai/questions/extract`** multipart imagen → `extractFromImage` → valida → devuelve campos estructurados (sin guardar). No requiere `:id` (sirve también para poblar una pregunta nueva; el front la usa desde el editor).

### 4.4 Flujo de datos (IA revise)

```
panel edición → instrucción → POST /ai/questions/:id/revise → LLM (QuestionGeneratorPort)
   → validación Typst → borrador revisado (no persistido) → campos del formulario
   → el profesor ajusta → PATCH /bank/:id → guardado
```

## 5. Frontend — servicios y componente

- **`BankService`**: `updateQuestion(id, payload)` (PATCH extendido), `replaceQuestionImage(id, file)` (POST /:id/image).
- **`AiService`** (o `BankService`, según dónde viva hoy la llamada de generación): `reviseQuestion(id, instruction)`, `extractQuestionFromImage(file)`.
- **`bank-list.component`**: estado `editing`, señales de campos editables, `startEdit()`, `cancelEdit()`, `saveEdit()`, `reviseWithAi()`, `extractFromImage()`. El modelo `BankQuestion` ya expone `bodyTypst`/`alternatives`/`type`/`usedInExamCount` (agregados en el fix previo del banco).

## 6. Validación y seguridad

- Toda edición estructurada (manual o IA) pasa por el compile Typst server-side; una pregunta que no compila se rechaza (nunca se guarda ni se muestra como válida).
- La IA nunca escribe en DB — solo devuelve borradores que el humano guarda explícitamente.
- Tenant-scoping en todos los endpoints vía `@CurrentUser()` (mismo patrón que el resto de `bank`/`ai`). Central = solo lectura. 404 (no 403) para cross-tenant, sin filtrar existencia.
- La advertencia de "usada en N exámenes" es informativa; no bloquea el guardado (decisión del brainstorm).

## 7. Testing (TDD estricto)

- **Dominio/validadores:** parseo de alternativas, validación de update (incluye taxonomía), mapeo clave-letra→índice.
- **Servicios (unit, con fakes):** revise devuelve borrador no persistido; extract parsea; PATCH extendido acepta taxonomía y approved; rechazo de compile inválido.
- **Endpoints (e2e):** `PATCH /bank/:id` sobre approved propio (200) y cross-tenant (404); `POST /bank/:id/image` reemplaza asset; `POST /ai/questions/:id/revise` (200 borrador, 422 compile inválido, 404 otro tenant); `POST /ai/questions/extract` (200 campos).
- **Web (component):** modo edición para ambos tipos; banner de uso en approved-usada; IA popula campos; OCR rellena; cancelar descarta; guardar llama PATCH. Preservar `data-testid` existentes (`bank-panel`, `panel-edit`, etc.) y agregar los nuevos (`panel-edit-form`, `ai-instruction`, `ocr-upload`, `edit-warning`).

## 8. Fuera de alcance

- Historial de versiones / undo de ediciones.
- Edición por lotes.
- Regenerar PDFs automáticamente al editar una pregunta usada (el profesor lo hace manualmente; solo se advierte).
- Cambiar el proveedor de IA (se reusa el `QuestionGeneratorPort` + adapter OpenRouter actual).

## 9. Referencias (file:line)

- Stub actual: `apps/web/src/app/features/bank/bank-list/bank-list.component.ts:409` (`edit()` navega a `/app/bank/new?edit=`).
- Panel de detalle: `apps/web/src/app/features/bank/bank-list/bank-list.component.html` (`data-testid="bank-panel"`).
- PATCH actual: `apps/api/src/modules/bank/bank.controller.ts:199` (`@Patch(":id")`, `EditDraftQuestionBody`) + `bank.service.ts` (`editDraftQuestion`, validación + cache de preview).
- Creación imagen (patrón multipart): `apps/api/src/modules/bank/bank.controller.ts:84` (`POST image`).
- Generación IA (patrón puerto/adapter): `apps/api/src/modules/ai/generate-questions.service.ts`, `ai/ai.controller.ts` (`POST /ai/questions/generate`), `QUESTION_GENERATOR_PORT` + `ai/adapters/openrouter/openrouter.adapter.ts`.
