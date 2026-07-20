# Diseño — Extraer pregunta por foto con IA en "Nueva pregunta"

**Fecha:** 2026-07-20

## 1. Propósito

`bank-new.component.ts` (pantalla "Nueva pregunta", ruta `/app/bank/new`) tiene hoy un tab "Foto de la pregunta" que sube la imagen cruda (`POST /bank/questions/image`, tipo `image` — se imprime tal cual en el examen). El OCR/vision-extraction que ya existe (`AiService.extractQuestionFromImage` → `POST /ai/questions/extract`) solo está disponible al **editar** una pregunta ya guardada (`bank-list.component.ts`), no al crearla. Esto obliga a un flujo de dos pasos (guardar como imagen cruda, luego editar y correr OCR) para lo que debería ser un atajo directo en creación.

## 2. Alcance

- Se agrega un botón "Extraer con IA" al tab "Foto" existente.
- El guardado crudo tipo `image` (botón actual) **no cambia** — sigue siendo la opción por defecto/manual. La IA es un atajo opcional, no un reemplazo (figuras/diagramas complejos que la IA no reproduce bien siguen necesitando el tipo `image`).
- Fuera de alcance: cambios de backend (el endpoint `POST /ai/questions/extract` y `AiService.extractQuestionFromImage` ya existen y no se tocan), cambios al tab "Estructurada" más allá de recibir los valores precargados.

## 3. Componente — `bank-new.component.ts`

Nuevos signals (mismo patrón que `bank-list.component.ts`'s Task 10 OCR box):
- `extracting = signal(false)`
- `extractError = signal<string | null>(null)`

Nuevo método:

```ts
protected extractWithAi(): void {
  const image = this.pImage();
  const gradeLevel = this.pGradeLevel();
  const courseId = this.pCourseId();
  const topicId = this.pTopicId();
  if (!image || this.extracting() || !this.photoTaxonomyValid()) return;
  this.extracting.set(true);
  this.extractError.set(null);

  this.aiService.extractQuestionFromImage(image).subscribe({
    next: (extracted) => {
      this.sBody.set(extracted.bodyTypst);
      this.sAlternatives.set(extracted.alternatives.join('\n'));
      this.sCorrectAnswer.set(extracted.correctAnswer);
      this.sDifficulty.set(this.pDifficulty());

      // `sGradeLevel`/`sCourseId` each drive an existing `effect()` (lines
      // 112-147) that RESETS the dependent id/list as soon as the signal
      // changes, then async-refetches via `taxonomyService`. Setting
      // `sCourseId`/`sTopicId` directly right after `sGradeLevel` would race
      // that reset and get clobbered. Instead, mirror exactly what a user
      // does by hand: change grade → wait for courses to load → pick course →
      // wait for topics to load → pick topic. Our own explicit fetch below
      // always resolves AFTER the effect's synchronous reset, so our
      // `.set()` calls are the last write and win.
      this.sGradeLevel.set(gradeLevel);
      this.taxonomyService.getCourses(gradeLevel!).subscribe((courses) => {
        this.sCourses.set(courses);
        this.sCourseId.set(courseId);
        this.taxonomyService.getTopics(courseId, gradeLevel ?? undefined).subscribe((topics) => {
          this.sTopics.set(topics);
          this.sTopicId.set(topicId);
        });
      });

      this.extracting.set(false);
      this.setTab('structured');
    },
    error: () => {
      this.extracting.set(false);
      this.extractError.set('No se pudo leer la pregunta desde la imagen. Inténtalo de nuevo.');
    },
  });
}
```

`photoTaxonomyValid()` es un nuevo helper privado: `!!this.pCourseId() && !!this.pTopicId() && !!this.pDifficulty() && !!this.pGradeLevel() && !!this.pImage()` — igual que `photoValid()` pero SIN `pCorrectAnswer()` (ese campo lo rellena la IA, no tiene sentido exigirlo antes de extraer).

`setTab('structured')` se llama de inmediato (no espera el fetch de cursos/temas) — el profe ve el tab Estructurada con enunciado/alternativas/clave ya listos, y el dropdown de Curso/Tema termina de poblarse un instante después, exactamente como si lo hubiera seleccionado a mano.

## 4. Template — `bank-new.component.html` (tab Foto)

- Botón nuevo "Extraer con IA" — icon `sparkles` (convención ya establecida: mismo icono que "Editar con IA"/`reviseWithAi` en `bank-list.component.html:259-272`), junto al botón de guardado actual.
  - `[loading]="extracting()"` `[disabled]="!photoTaxonomyValid() || extracting()"` — mismo prop `ui-button` que `reviseWithAi`/`submitPhoto` ya usan, no un spinner manual.
- Mensaje de error: `@if (extractError()) { <p role="alert">{{ extractError() }}</p> }` — mismo estilo que `saveError()` ya usado en el componente.
- `data-testid="extract-with-ai"` en el botón, para el test.

## 5. Validación y seguridad

Ninguna nueva — hereda toda la infraestructura ya construida: `POST /ai/questions/extract` ya requiere `JwtAuthGuard`, el vision model nunca escribe en DB directamente (el profe revisa en el tab Estructurada y hace submit manual vía `submitStructured()`, sin cambios).

## 6. Testing

Espejo de `bank-list.component.spec.ts`'s tests de `extractFromImage`:
- Click en "Extraer con IA" con imagen + taxonomía Foto completa → llama `aiService.extractQuestionFromImage` con el file correcto.
- Éxito → copia courseId/topicId/difficulty/gradeLevel de Foto a Estructurada, puebla body/alternatives/correctAnswer, cambia a tab `structured`.
- Error → `extractError` seteado, se queda en tab `photo`, `extracting()` vuelve a `false`.
- Botón deshabilitado si falta imagen o algún campo de taxonomía en Foto.

## 7. Fuera de alcance

- Cambios al backend/`AiController`/`ExtractQuestionService` — ya existen y no cambian.
- Cambios al tipo `image` o su endpoint de guardado — sigue igual.
- Cambios a `ai-review-queue.component.ts` (drafts de generación batch) — no relacionado, esos siempre son `structured` por diseño (design doc §5.2).

## 8. Referencias (file:line)

- Precedente completo (ya implementado): `apps/web/src/app/features/bank/bank-list/bank-list.component.ts` (`extractFromImage`, `onOcrFileSelected`, líneas ~629-666).
- Endpoint ya existente: `apps/api/src/modules/ai/ai.controller.ts` (`POST /ai/questions/extract`, líneas 95-129 aprox., incluye `revise`+`extract`).
- Cliente HTTP ya existente: `apps/web/src/app/features/ai/ai.service.ts` (`extractQuestionFromImage`).
- Componente a modificar: `apps/web/src/app/features/bank/bank-new/bank-new.component.ts` / `.html`.
