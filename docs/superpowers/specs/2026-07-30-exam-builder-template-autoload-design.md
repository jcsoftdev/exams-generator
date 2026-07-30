# Diseño — Auto-carga de plantilla en el generador de exámenes

**Fecha:** 2026-07-30
**Estado:** Aprobado
**Alcance:** `ExamBuilderComponent` (`apps/web/src/app/features/exams/exam-builder/exam-builder.component.ts`) — disparar `loadTemplate()` automáticamente al completar universidad/track/cursos, sin depender de un click manual en "Cargar plantilla".

---

## 1. Propósito

Hoy, para un tipo de examen no-manual (ETA, Fastest, etc.), el usuario elige universidad y track, y recién después tiene que presionar "Cargar plantilla" para que se resuelvan las cantidades de preguntas por curso/dificultad (`POST /exams/blueprint/resolve`). Ese paso manual es redundante: en cuanto la selección alcanza un estado resolvable, ya se sabe qué plantilla cargar.

Este cambio hace que la carga sea automática en los puntos donde la selección se completa, mientras el botón sigue disponible para recargar manualmente (ej. tras editar "Cantidad total de preguntas" o reintentar después de un error).

## 2. Disparadores de auto-carga

`loadTemplate()` (sin cambios en su cuerpo) se invoca automáticamente en tres puntos:

1. **Universidad sin tracks** — dentro de `onUniversityChange`, en el callback `next` de `getUniversityTracks`, inmediatamente después de `this.tracks.set(list)`: si `list.length === 0`, se llama `this.loadTemplate()`. Cubre universidades tipo UNI (sin selector de track visible).
2. **Track seleccionado** — dentro de `onTrackChange`, si el nuevo `trackId` es truthy, se llama `this.loadTemplate()` justo después de `this.selectedTrackId.set(trackId)`. Si el usuario limpia el track (`trackId === null`), NO se dispara nada.
3. **Checkbox de curso (`courseScope: 'selected'`)** — dentro de `toggleCourseSelection`, tras actualizar `selectedCourseIds`, se llama `this.loadTemplate()` si `canLoadTemplate()` es verdadero (universidad ya elegida). Cada toggle (marcar o desmarcar) re-dispara la carga con el set de cursos actual — sin debounce, mismo patrón inmediato que un click de botón. Con el set vacío, el comportamiento es el mismo que hoy al clickear el botón sin cursos marcados.

El botón "Cargar plantilla" no se elimina — sigue siendo la vía de recarga manual y su `disabled`/`loading` state no cambia.

## 3. Manejo de errores

Sin cambios: `loadTemplate()` reusa su manejo de 404 ("no hay plantilla configurada...") y 400 ("requiere cantidad total de preguntas...") tal cual. Un auto-load que resulta en 400 (ej. UNI sin `totalQuestionsOverride`) simplemente muestra el mismo mensaje inline que hoy — el usuario completa el campo y puede recargar con el botón.

## 4. Reentrancia

`bulkLoadFromBlueprint` mezcla/sobreescribe por clave (curso·tema·dificultad) vía `store.bulkLoadFromBlueprint`, pero es **aditivo**: nunca borra filas que ya no vienen en la respuesta. Consecuencia aceptada: desmarcar un checkbox de curso dispara un auto-load acotado a los cursos restantes, pero las filas del curso recién desmarcado quedan en el grid con su cantidad ya pedida — el usuario debe borrarlas a mano si ya no las quiere. Es el mismo comportamiento aditivo que ya tenía el flujo manual ("Cargar plantilla"), ahora simplemente alcanzable sin un click explícito.

Antes de este cambio, el único punto de entrada a `loadTemplate()` era el botón "Cargar plantilla", y `ui-button` ignora clicks mientras `loading` es `true` — dos llamadas a `resolveBlueprint` en vuelo simultáneamente eran estructuralmente imposibles. Los 3 triggers automáticos saltan esa serialización implícita, así que respuestas fuera de orden sí son alcanzables (ej. marcar dos checkboxes en menos de un segundo). `loadTemplate()` usa un contador `templateRequestId` monotónico: cada llamada captura su propio id, y una respuesta (`next` o `error`) solo se aplica si su id sigue siendo el más reciente — una respuesta más vieja que llega tarde se descarta en silencio en vez de sobreescribir una selección más nueva.

## 5. Testing

Nuevos casos en el describe `'tipo de examen — cargar plantilla'` (`exam-builder.component.spec.ts`):
- Auto-load sin click al elegir universidad sin tracks (`getUniversityTracks: () => of([])`).
- Auto-load sin click al elegir un track (`getUniversityTracks: () => of(TRACKS)` + seleccionar track).
- Auto-load sin click al marcar un checkbox de curso (exam type `courseScope: 'selected'`, ej. "Fastest").

Se verificó que ningún test existente afirma ausencia de llamada previa al click (`not.toHaveBeenCalled` / `toHaveBeenCalledTimes` no se usan sobre `resolveBlueprint` en el archivo) — los tests actuales siguen pasando tal cual.
