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

### 3.1 Por qué NO alcanza con encadenar `.subscribe()` y confiar en el orden

Los `effect()` de `sGradeLevel`/`sCourseId` (líneas 112-147 del componente actual) SIEMPRE resetean el id dependiente a `''` en cuanto el signal padre cambia, y solo DESPUÉS relanzan el fetch. Un `effect()` de Angular nunca corre de forma síncrona dentro del mismo `.set()` que lo disparó — corre después, en el siguiente flush del scheduler. Eso significa que si intentamos "ganarle" al effect encadenando nuestros propios `subscribe()` justo después de `sGradeLevel.set(...)`, el resultado depende de si el `Observable` es síncrono o asíncrono:

- Con un `Observable` síncrono (`of(...)`, como en los tests con Vitest) nuestro `subscribe()` corre YA, dentro del mismo tick — ANTES de que el effect llegue a ejecutarse. El effect corre después y resetea `sCourseId`/`sTopicId` de vuelta a `''`, pisando lo que acabamos de copiar.
- Con HTTP real (asíncrono) el orden final no está garantizado tampoco — depende de cómo Angular agenda el flush de effects (microtask/zona) vs. cuándo resuelve la promesa/observable HTTP.

En ningún caso "nuestro `.set()` es la última escritura" es una garantía real. Necesitamos un mecanismo que no dependa de timing.

### 3.2 Mecanismo correcto: un valor "preseleccionado" que el propio `effect()` consume

En vez de competir con los efectos, les pasamos el valor que deben usar AL RESETEAR, en lugar de `''`. Dos campos privados nuevos (no son signals — no necesitan reactividad propia, solo persisten un valor hasta que el effect los lee una vez):

```ts
private pendingStructuredCourseId: string | null = null;
private pendingStructuredTopicId: string | null = null;
```

Los dos `effect()` existentes se modifican para leer y consumir ese valor en vez de resetear siempre a `''`:

```ts
// ANTES (efecto de sGradeLevel → cursos del tab Estructurada):
effect(() => {
  const gradeLevel = this.sGradeLevel();
  this.sCourseId.set("");
  this.sCourses.set([]);
  if (!gradeLevel) return;
  this.taxonomyService.getCourses(gradeLevel).subscribe({
    next: (courses) => this.sCourses.set(courses),
    error: () => this.saveError.set("No se pudieron cargar los cursos. Recarga la página."),
  });
});

// DESPUÉS:
effect(() => {
  const gradeLevel = this.sGradeLevel();
  const preselectCourseId = this.pendingStructuredCourseId ?? "";
  this.pendingStructuredCourseId = null;
  this.sCourseId.set(preselectCourseId);
  this.sCourses.set([]);
  if (!gradeLevel) return;
  this.taxonomyService.getCourses(gradeLevel).subscribe({
    next: (courses) => this.sCourses.set(courses),
    error: () => this.saveError.set("No se pudieron cargar los cursos. Recarga la página."),
  });
});
```

Mismo cambio, mismo patrón, para el effect de `sCourseId` → temas:

```ts
// DESPUÉS:
effect(() => {
  const courseId = this.sCourseId();
  const preselectTopicId = this.pendingStructuredTopicId ?? "";
  this.pendingStructuredTopicId = null;
  this.sTopicId.set(preselectTopicId);
  this.sTopics.set([]);
  if (!courseId) return;
  this.taxonomyService.getTopics(courseId, this.sGradeLevel() ?? undefined).subscribe({
    next: (topics) => this.sTopics.set(topics),
    error: () => this.saveError.set("No se pudieron cargar los temas. Inténtalo de nuevo."),
  });
});
```

Por qué esto SÍ es determinístico: ya no competimos en timing con el effect — le decimos DIRECTAMENTE qué valor debe usar la próxima vez que se dispare por el cambio de `sGradeLevel`/`sCourseId`, sin importar si el effect corre en 1ms o en 100ms, ni si el fetch de cursos/temas es síncrono (test) o asíncrono (prod). El comportamiento normal (usuario cambiando el dropdown a mano) no se altera: `pendingStructuredCourseId`/`pendingStructuredTopicId` quedan en `null` salvo el instante en que `extractWithAi()` los setea, así que el `?? ''` cubre el caso normal exactamente como el reset original.

**Límite aceptado (edge case raro, documentado, no se resuelve)**: si el profe YA había elegido a mano el mismo Grado en el tab Estructurada antes de usar "Extraer con IA" en Foto, `sGradeLevel.set(gradeLevel)` es un no-op (mismo valor, Angular no notifica) y el effect no vuelve a correr — `pendingStructuredCourseId`/`pendingStructuredTopicId` quedan sin consumir, y Curso/Tema no se prellenan (el profe los reelige a mano). El enunciado/alternativas/clave de la IA sí se prellenan igual — no se pierde nada crítico. No vale la pena la complejidad extra para este caso.

### 3.3 `extractWithAi()`

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
      this.sDifficulty.set(this.pDifficulty());
      this.sBody.set(extracted.bodyTypst);
      this.sAlternatives.set(extracted.alternatives.join('\n'));
      this.sCorrectAnswer.set(extracted.correctAnswer);

      this.pendingStructuredCourseId = courseId;
      this.pendingStructuredTopicId = topicId;
      this.sGradeLevel.set(gradeLevel);

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
