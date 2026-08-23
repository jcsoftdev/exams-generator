# Diseño — Maqueta oficial del examen: secciones, bloques y numeración

**Fecha:** 2026-08-23
**Estado:** Borrador — pendiente de aprobación
**Research que lo respalda:** `docs/research-official-exam-layout.md`; cache `web-research` slugs
`peru-university-admissions/uni-exam-paper-layout` y `.../uncp-exam-paper-layout`.

**Alcance:** El PDF generado pasa de una lista plana de preguntas barajadas a la maqueta que usan los
exámenes de admisión reales: pruebas, bloques con encabezado, y numeración que reinicia por prueba.
Toca schema, resolver, shuffler, puerto de PDF y plantilla Typst. Agrega un paso de datos previo
(medir el reparto real por curso y por nivel) que se entrega y se revisa antes de sembrarse.

---

## 1. Problema

Hoy el examen generado no se parece a un examen oficial. Dos causas en el código:

- `version-shuffler.ts:105` — `shuffleArray(questionIds, rng)` permuta **todas** las preguntas del
  examen a la vez. Los cursos quedan intercalados al azar.
- `typst-template.ts:21` — `input.questions.map(...)` renderiza una lista plana `1..N` en dos
  columnas, sin ningún encabezado.

Y una causa en el modelo: no existe dónde guardar la estructura. `exam_blueprint_rows` no tiene orden
ni sección, y `exam_blueprint_template_rows.exam_section` está documentado como "purely descriptive" —
nadie lo lee al renderizar.

## 2. Research — los hallazgos que definen el diseño

### 2.1 UNI: tres pruebas, bloques contiguos, numeración que reinicia

Medido sobre los solucionarios oficiales 2017-2, 2018-1, 2019-1, 2019-2, 2020-1 y 2021-1.

| Prueba | Bloques impresos | Preguntas |
| ------ | ---------------- | --------- |
| E1 · Aptitud Académica y Humanidades | Raz. Matemático 32 · Raz. Verbal 32 · Humanidades 36 | 100 |
| E2 · Matemática | Matemática 40 | 40 |
| E3 · Física y Química | Física 20 · Química 20 | 40 |
| | | **180** |

Reglas de maquetación: bloques contiguos, encabezado en mayúsculas antes de cada uno, numeración
corrida **dentro** de la prueba que reinicia en cada prueba, orden de bloques fijo, cinco alternativas
A)–E).

### 2.2 El hallazgo que corrige el modelo obvio: un bloque NO es un curso

En 2017-2, 2019-1, 2019-2 y 2020-1 la segunda prueba tiene **una sola sección impresa,
"MATEMÁTICAS"** — nunca se subdivide en Aritmética / Álgebra / Geometría / Trigonometría. Lo mismo
"HUMANIDADES", que abarca Comunicación, Lengua, Literatura, Historia, Geografía, Economía, Filosofía,
Lógica, Psicología, Inglés y Actualidad.

Derivar el bloque del `course_id` de cada pregunta produce la maqueta **equivocada**. El bloque es un
grupo nombrado de cursos y tiene que ser dato propio de la fila de blueprint.

El solucionario 2021-1 sí subdivide E2 por curso, pero es el año COVID con examen reducido (35/20/20)
y esa subdivisión es elección editorial del solucionario, no la maqueta del cuadernillo. No se usa
como referencia ni de estructura ni de conteos.

### 2.3 UNCP: dos niveles de agrupación, y sí publica el nivel

Examen único de 80 preguntas / 3 h, 64% conocimientos + 36% aptitudes, cinco áreas por carrera. El
temario agrupa en `Área Curricular → Curso`, con las aptitudes como sección propia. El Anexo 7 da
Nº de preguntas exacto **por curso y por NIVEL** (P.B./P.I./P.A.) para las cinco áreas — ese dato ya
está extraído en la plantilla UNCP del proyecto.

### 2.4 Lo que ninguna de las dos publica

- UNI no publica cómo se reparten sus 40 preguntas de "Matemática" entre Aritmética, Álgebra,
  Geometría y Trigonometría, ni las 36 de "Humanidades" entre sus cursos. El reglamento llega al
  nivel de bloque y no más.
- UNI no publica nada de dificultad.

Ambos huecos se llenan **midiendo exámenes oficiales reales** (§7), no inventando, y lo medido queda
editable por la academia.

## 3. Decisiones de diseño

1. **Dos niveles: sección (la prueba) y bloque (el grupo impreso).** No más, no menos. Un tercer
   nivel no aparece en ninguna de las dos universidades investigadas.
2. **El bloque es dato de la fila, no se infiere del curso** (§2.2). Varias filas de cursos distintos
   comparten bloque; el bloque tiene su propio rótulo.
3. **Varias filas del mismo curso con NIVEL distinto viven en el mismo bloque.** El `count` del
   bloque es la suma de sus filas cruzando curso y nivel. Dentro del bloque las preguntas se mezclan
   sin importar nivel — ningún cuadernillo real rotula la dificultad.
4. **Las secciones nunca se barajan; los bloques sí, dentro de su sección.** Decisión de producto: la
   app genera formas A/B/C para un aula, cosa que el examen real no necesita. Barajar bloques mejora
   la anti-copia. Barajarlos **entre** secciones sería incoherente (Química no puede caer en la prueba
   de Matemática), así que el barajado queda acotado a la sección padre.
5. **La versión congela su estructura** en `exam_versions.section_layout`, igual que ya congela
   `answer_key`, `alternative_orders` y `week_number`. Con bloques barajados por versión, el orden de
   bloques **es** dato de la versión, no del examen.
6. **`section_layout` guarda `count`, nunca `questionIds`.** `question_order` sigue siendo la única
   fuente del orden; el layout solo aporta los cortes. Sin dos copias del mismo dato no hay
   desincronización posible. Invariante: la suma de los `count` es igual al largo de `question_order`.
7. **`answer_key` se queda indexado por posición global `0..N-1`.** La numeración impresa reinicia por
   prueba, pero eso es asunto del render. Meter la numeración local en el dato obligaría a migrar
   todas las versiones ya generadas sin ganar nada.
8. **Todo examen agrupa, incluido el manual.** Manual = una sección sin rótulo, un bloque por curso,
   en el orden de las filas del builder. Un solo comportamiento que mantener, no dos.
9. **Los conteos oficiales de bloque son invariante; el reparto interno es editable.** El 40 de
   "Matemática" viene de la UNI y la suma de las filas tiene que respetarlo. Cómo se reparte entre los
   cuatro cursos es medido por nosotros y ajustable por la academia.

## 4. Modelo de datos

### `exam_blueprint_template_rows` — cuatro columnas nuevas

```
sort_order     integer NOT NULL DEFAULT 0   -- orden canónico oficial
block_code     text                          -- "matematica"
block_label    text                          -- "MATEMÁTICA" (el rótulo impreso)
section_label  text                          -- "SEGUNDA PRUEBA — MATEMÁTICA"
```

`exam_section` ya existe y guarda el código de sección (`"E1"`/`"E2"`/`"E3"`, o el área curricular en
UNCP); deja de ser decorativo. `source_level` sigue exactamente como está.

La plantilla UNI queda así:

```
sección "E2"  ·  "SEGUNDA PRUEBA — MATEMÁTICA"
  bloque "MATEMÁTICA"   (40 preguntas impresas juntas — dato oficial)
    fila  Aritmética     count=?   ← reparto medido, editable
    fila  Álgebra        count=?
    fila  Geometría      count=?
    fila  Trigonometría  count=?
```

Y la UNCP, con el eje de nivel:

```
sección "Área curricular: Matemática"
  bloque "MATEMÁTICA"
    fila  Aritmética  P.B.  count=2
    fila  Aritmética  P.I.  count=3
    fila  Aritmética  P.A.  count=1
    fila  Álgebra     P.B.  count=2
    ...
```

### `exam_blueprint_rows` — las mismas cuatro columnas

El resolver las copia de la plantilla. El builder manual pone `sort_order` = índice de la fila,
`block_label` = nombre del curso, y las dos de sección en `NULL`.

### `exam_versions.section_layout jsonb NOT NULL DEFAULT '[]'`

```json
[
  {
    "code": "E2",
    "label": "SEGUNDA PRUEBA — MATEMÁTICA",
    "blocks": [{ "label": "MATEMÁTICA", "count": 40 }]
  }
]
```

Sin `courseId` en los bloques: un bloque abarca varios cursos por definición (§2.2).

### Migración de datos existentes

Cada examen ya generado se convierte a una sección con `code`/`label` en `null` y un bloque por curso,
derivado de `exam_questions.blueprint_row_id → exam_blueprint_rows.course_id`. `sort_order` se
rellena con el orden de inserción actual de las filas. Ninguna versión ya impresa cambia de contenido.

## 5. Dominio

### 5.1 Resolver

`TemplateRow` gana `sortOrder`, `blockCode`, `blockLabel`, `sectionCode`, `sectionLabel` y los
propaga a `BlueprintRow`. La lógica de `course_scope`/`week_scope` no cambia.

Regla nueva: cuando un bloque declara un total oficial y la suma de sus filas no lo alcanza, el
resolver reporta la discrepancia en `ResolveBlueprintOutcome` en lugar de corregirla en silencio. El
mismo criterio que ya usa `usedCumulativeFallback`.

### 5.2 Shuffler

```ts
interface SelectionBlock   { label: string; questions: SelectedQuestion[] }
interface SelectionSection { code?: string; label?: string; blocks: SelectionBlock[] }

buildVersions(sections: SelectionSection[], versionCount, rng): Version[]
```

Por cada versión, en este orden:

1. Recorrer las secciones en su orden canónico — **nunca** se permutan.
2. Dentro de cada sección, permutar el orden de los bloques.
3. Dentro de cada bloque, permutar sus preguntas (mezclando cursos y niveles).
4. Permutar las alternativas de las preguntas `structured`, como hoy.

Salida: `questionOrder` plano (concatenación del resultado), `answerKey` calculado sobre ese plano
igual que hoy, `shuffledAlternatives` / `shuffledAlternativeImages` sin cambios, y `sectionLayout`
nuevo. El retry de distinctness sigue comparando `questionOrder.join("|")` y no se toca.

La invariante de release existente —`answerKey[i]` corresponde siempre a la pregunta en
`questionOrder[i]`— se mantiene sin cambios y sus tests siguen siendo el gate.

## 6. Render

### 6.1 Puerto

```ts
interface ExamPdfBlock   { label: string; questions: readonly ExamPdfQuestion[] }
interface ExamPdfSection { code?: string; label?: string; blocks: readonly ExamPdfBlock[] }

interface ExamPdfDocumentInput {
  readonly title: string;
  readonly versionLabel: string;
  readonly tenantLogoAbsolutePath?: string;
  readonly sections: readonly ExamPdfSection[];
}
```

`questions` a nivel raíz desaparece. Es un cambio incompatible, pero el puerto es interno y su único
implementador es `typst-cli.adapter.ts`.

`AnswerKeyDocumentInput` recibe el mismo tratamiento: sus entradas se agrupan por sección.

### 6.2 Plantilla Typst

Hoy el documento usa `#set page(columns: 2)`, y con eso ningún encabezado puede ocupar el ancho
completo de la página. Cambia a:

- El título de la sección se emite **fuera** de las columnas, a ancho completo.
- El contenido de cada sección se envuelve en `#columns(2)[...]`.
- `#pagebreak()` entre secciones.
- Los encabezados de bloque van **dentro** del flujo de columnas, en mayúsculas.
- Un contador de pregunta que reinicia en cada sección.

Los marcadores `// q:{id}` siguen precediendo cada pregunta — `typst-error-mapper.ts` depende de
ellos y no se toca.

Un examen con una sola sección sin rótulo (el caso manual) no emite título de sección ni salto de
página; sí emite los encabezados de bloque.

### 6.3 Clave de respuestas

Se agrupa por sección, con numeración local, para que el "14 → C" de la clave signifique el mismo 14
que el cuadernillo. El dato subyacente sigue siendo posición global (§3.7); la numeración local se
calcula al renderizar, a partir de `section_layout`.

## 7. Paso de datos previo — medir el reparto real

Es un entregable propio y **se revisa antes de sembrarse**. No entran números al repositorio que el
dueño del producto no haya visto.

1. Descargar los solucionarios oficiales de `admision.uni.edu.pe/descargas/`.
2. `tools/harvest/parse_uni_solucionario.py` → enunciados por sección.
3. `tools/harvest/classify_topics.py` → curso y tema por pregunta.
4. La rúbrica de dificultad que el proyecto ya usa (`conceptsUsed` + `solutionSteps`, ver
   `openrouter-request-builder.ts`) → nivel por pregunta.
5. Salida: tabla de reparto curso × nivel por bloque.

Advertencia conocida: la clasificación automática por curso necesita una pasada de revisión humana —
Aritmética y Álgebra se confunden con frecuencia. El resultado se presenta como medición nuestra sobre
exámenes reales, nunca como dato publicado por la UNI.

Para UNCP no hace falta este paso en el eje de curso ni en el de nivel: el Anexo 7 ya da ambos.

## 8. Tests

Modo TDD estricto activo — los tests van primero.

**`version-shuffler.spec.ts`** — propiedades nuevas, verificadas sobre muchas versiones generadas:

- Las preguntas de un mismo bloque quedan en posiciones contiguas de `questionOrder`.
- Ninguna pregunta cruza de sección.
- Las secciones aparecen siempre en su orden canónico.
- El orden de los bloques varía entre versiones cuando la sección tiene dos o más bloques.
- La suma de los `count` de `sectionLayout` es igual al largo de `questionOrder`.
- La invariante existente (la clave sigue al contenido) se mantiene.

**`typst-template.spec.ts`** — el título de sección se emite fuera de las columnas; los encabezados de
bloque aparecen; hay `#pagebreak()` entre secciones; la numeración reinicia por sección; un examen de
una sección sin rótulo no emite título ni salto.

**`resolve-blueprint.spec.ts`** — sección, bloque y `sort_order` se propagan de plantilla a
`BlueprintRow`; se reporta la discrepancia cuando la suma de filas no alcanza el total del bloque.

**e2e** — un examen ETA UNI produce tres secciones con sus bloques y conteos; un examen manual produce
una sección sin rótulo con un bloque por curso.

**Migración** — un examen preexistente sigue generando el mismo PDF salvo por los encabezados de
bloque nuevos.

## 9. Fuera de alcance

- Generar las tres pruebas UNI como tres PDFs separados. Se decidió un solo documento con salto de
  página.
- Reordenar bloques desde la UI del builder. El orden de los bloques es el orden de las filas.
- Cambiar el esquema de puntaje o calcular puntajes. Sigue siendo un generador de documentos.
- Sembrar plantillas de universidades más allá de UNI y UNCP.
