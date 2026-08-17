# Auditoría — Generación de exámenes (frontend + flujo end-to-end)

> Generada 2026-08-15 con `/brain-audit` + pasada de QA manual con Playwright sobre la app
> corriendo (web `localhost:4201`, API `localhost:3012`, Postgres/MinIO/Redis de
> `infra/docker-compose.yml`). Sesión real: login `admin@colegio-demo.test`, se tocaron todos
> los botones del flujo en desktop 1440×900 y móvil 390×844.
>
> **Alcance**: armar examen (`/app/exams/new`), revisión (`/app/exams/:id`), formas
> (`/app/exams/:id/versions`), lista (`/app/exams`) y el puente hacia IA/banco. No repite
> `docs/audit-todo.md` (2026-07-24, cerrada) ni `docs/audit-2026-08-14.md`.
>
> **Criterio**: usabilidad para un docente NO experto. Menos clicks es mejor UI, pero sin
> quitarle al experto ninguna palanca que hoy tenga.
>
> Prioridades: **P0** = roto, engaña o bloquea · **P1** = claramente no profesional o frágil ·
> **P2** = pulido.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

Cada hallazgo lleva **evidencia reproducida en vivo** (medición, respuesta HTTP o conteo de
DOM), no solo lectura de código. Donde solo hubo lectura de código, lo dice.

---

## Cómo se ve hoy el camino feliz (medido)

| Camino | Clicks | Tipeo | Resultado |
|---|---|---|---|
| Plantilla (UNCP → Área II) | 7 | 0 | 80 preguntas, todo satisfacible ✅ |
| Manual (Pre-admisión) | 2 + N | N celdas | grilla de 276 filas × 3 dificultades en blanco |

El camino guiado es **bueno**. El problema es que no es el default, que su resultado es
invisible, y que salirse de él castiga.

---

## P0 — Roto, engaña o bloquea

### Backend

- [x] **La lista siempre decía "0 preguntas · 0 formas"** — `GET /exams` devolvía
  `questionCount: 0` / `versionCount: 0` para todos los exámenes, incluidos los que tenían
  PDFs descargables. `GET /exams/:id` sí devolvía las 5 preguntas, y la DB confirmaba 5 y 2.

  **Causa raíz**: drizzle renderiza un objeto columna interpolado en un template `sql`
  **sin calificar**. El SQL generado era:
  ```sql
  (select count(*)::int from "exam_questions" where "exam_id" = "id")
  ```
  Como `exam_questions` tiene su propia columna `id`, ambos lados resolvían dentro de la
  subconsulta: una auto-comparación que nunca es verdadera. Nunca estuvo correlacionada.

  **HECHO** (`apps/api/src/modules/exams/exams.repository.ts:249-262`): las subconsultas
  ahora aliasan su tabla y califican la fila externa con el objeto TABLA, que sí renderiza
  un nombre usable:
  ```sql
  (select count(*)::int from "exam_questions" eq where eq.exam_id = "exams".id)
  ```
  `listExams()` no tenía **ni un solo test** — por eso se filtró. Se agregaron 3 en
  `exams.repository.spec.ts` (`listExams() — S1 list row counts`): conteos reales, el caso
  0/0 legítimo, y dos exámenes en la misma página que no se contaminan. Rojo antes, verde
  después. Suite API non-e2e: **824/824**. Verificado en la API corriendo:
  `5 preguntas | 3 formas`, `24 preguntas | 2 formas`.

### Web — pérdida de trabajo

- [x] **Salir del builder borraba todo lo armado, sin aviso** (reproducido)
  Llené 2 celdas (`Total general: 24`), toqué "Generar 2 con IA" en la celda con faltante →
  navegó al generador → botón Atrás → **Grado en "Selecciona un grado", grilla desaparecida,
  0 inputs con valor**. `ExamBuilderStore` es component-scoped a propósito y no existe ningún
  `CanDeactivate` en todo `apps/web`. Ironía: la pantalla de IA a la que te manda dice
  *"Puedes seguir navegando — el progreso queda guardado"*.

  **HECHO** (`exam-builder.component.ts`): el examen en curso se persiste en `sessionStorage`
  bajo `exam-builder-state-v1` (tipo de examen, grado, universidad/track/cursos, override de
  cantidad y el mapa de celdas pedidas) y se restaura en `ngOnInit`.
  - La decisión FE-5 (store component-scoped, resetea al navegar) **se respeta**: lo que
    sobrevive vive FUERA del componente, no dentro del store.
  - Un `effect()` guarda en vez de llamadas regadas por los ocho métodos que mutan — un
    método nuevo no puede olvidarse de guardar.
  - Las cantidades se restauran ANTES de que `buildGrid()` traiga nada: viven en un mapa
    indexado por `CellKey`, así que cada celda aparece con su valor apenas llega su fila.
  - Un tipo de examen no-manual además re-resuelve la plantilla (sus filas las arma el
    servidor, no se reconstruyen desde las cantidades).
  - Un payload corrupto se descarta en vez de romper la pantalla; el estado se borra al
    generar el examen (si no, el builder reabriría un examen que ya existe).
  - `sessionStorage`, no `local`: muere con la pestaña en vez de resucitar un examen viejo.

  5 tests nuevos. Verificado en la app repitiendo el escenario exacto: 2 celdas (total 20) →
  "Generar con IA" → Atrás → **grado, grilla y las 2 celdas intactas**. Sobrevive también a
  un F5 completo.

- [ ] **Móvil: 146 pantallas de scroll hasta el botón principal** (medido en 390×844)
  ```
  columna de tarjetas: 114,314 px   contenedor scrollable: 783 px  → 146 pantallas
  footer "Generar versiones": position: static, offsetTop 114,735 px
  ```
  En desktop la grilla vive en `max-h-[70vh]` con el footer justo debajo; en móvil las 276
  tarjetas están en el flujo de la página y el footer queda al final de todo.
  **Fix**: footer `sticky bottom-0` en móvil + cursos colapsados por defecto bajo `md`.

### Web — el examen se sella solo

- [ ] **Generar confirma el examen y lo bloquea para siempre**
  El backend auto-confirma `draft → ready` antes de encolar
  (`exam-generation.service.ts:129-141`). En pantalla: los 5 "Cambiar" `disabled`, el campo
  de reemplazo desaparecido, "Confirmado" `disabled` — **mientras el texto de arriba sigue
  diciendo "Cámbialas si quieres y confirma cuando estés conforme"**
  (`exam-review.component.html:11`). No hay endpoint para volver a borrador (revisadas todas
  las rutas de `exams.controller.ts`). Y como el builder salta directo a `/versions`
  (`exam-builder.component.ts:830`), el docente novato nunca ve esa pantalla antes del sello.
  **Decisión pendiente del dueño del producto** (dos caminos, no los mezcles):
  (a) el builder pasa por revisión antes de generar (1 click más, reversible), o
  (b) existe "volver a borrador".
  Independiente de eso: el copy de la pantalla debe cambiar cuando está `ready`.

- [x] **"Confirmar examen" terminaba en callejón sin salida** (reproducido)
  Tras confirmar, el banner decía *"Examen confirmado. Ya puedes generar las versiones y sus
  hojas de claves."* Conté en esa sección: **0 links**, y los únicos botones eran 5 "Cambiar"
  deshabilitados y "Confirmado" deshabilitado.

  **HECHO**: CTA `Ver / generar formas` en el footer de la revisión, visible solo cuando el
  examen está `ready` (`exam-review.component.html`, `versionsLink()`). De paso el intro deja
  de contradecir a la UI: con el examen bloqueado ahora dice "Este examen ya está confirmado.
  Estas son las preguntas que quedaron." en vez de "Cámbialas si quieres…" (`introText()`).
  3 tests nuevos en `exam-review.component.spec.ts`. Verificado en la app:
  `href="/app/exams/…/versions"`, y `Cámbialas si quieres` ya no aparece en un examen ready.

---

## P1 — No profesional o frágil

- [x] **La revisión mostraba UUIDs y ningún enunciado**
  Fila real antes:
  `1 | 22131249-54e3-43c5-9374-ad0be0594f91 | · | 7c389685-23d9-483a-bc2e-c3ab27fd4257 | Media | Respuesta correcta: 4 | Cambiar`.
  **La única pantalla donde podías leer las preguntas era donde ya no las podías cambiar; la
  única donde podías cambiarlas no te dejaba leerlas.**

  **HECHO**, en dos capas:
  - **API**: `getExamDetail()` ya joineaba `topics` para `courseId`; ahora joinea `courses` y
    devuelve `courseName`/`topicName` (`exams.repository.ts`, port actualizado). 1 test nuevo
    en `exams.repository.spec.ts`.
  - **Web**: la fila pinta los nombres, el enunciado se renderiza con `ui-math-text` (imagen:
    "Pregunta con imagen — se ve completa en el PDF"), y la clave se muestra como letra +
    texto. Ojo con el dato: `correctAnswer` es un ÍNDICE 0-based en `structured` y una LETRA
    en `image` (ver `version-shuffler.ts`) — `correctAnswerLabel()` traduce cada caso y, si el
    índice no cae en las alternativas, muestra el valor crudo en vez de inventar una letra.
    4 tests nuevos.

  Verificado en la app: `1 | Aritmética | · | Teoría de Conjuntos | Media | Si los conjuntos A
  y B son iguales y unitarios, calcular a + b + c … | Respuesta correcta: B) 7`. Cero uuids.

- [x] **La plantilla acertaba pero su resultado era invisible** (medido)
  UNCP → Área II carga 80 preguntas en 11 filas, ubicadas en los índices
  `15, 32, 44, 56, 68, 89, 122, 138, 246, 260, 286` **dentro de 287 filas / 23,335 px de
  scroll** (≈42 pantallas). Sin resumen ni forma de aislarlas: resultado correcto e
  imposible de verificar.

  **HECHO** (`exam-builder.component.ts` + `.html`): recibo permanente
  **"80 preguntas pedidas en 16 celdas"** apenas hay algo pedido, con un toggle
  **"Ver solo lo pedido" / "Ver todo el temario"** que filtra `groupedRows()` a las filas con
  cantidad (y descarta los encabezados de curso que quedan vacíos — un grupo vacío es ruido
  justo en la vista cuyo punto es "solo lo mío"). Apagado por default: la grilla sigue siendo
  una matriz para llenar. 3 tests nuevos.

  Medido en la app sobre el mismo caso UNCP Área II:
  **287 filas / 23,335 px (≈42 pantallas) → 11 filas / 1,251 px (2 pantallas)**.

  Queda pendiente el detalle de etiqueta: esas filas se llaman "Todos los temas" y el curso
  vive en el encabezado de arriba (con el filtro encendido cada fila tiene el suyo pegado
  encima, así que ya se lee).

- [x] **La vista previa se pisaba a sí misma (race) y disparaba un request por tecla**
  (reproducido 2 veces) — celda con stock 479, escribir "12" tecla por tecla dejaba **1 solo
  id** en la celda y **2 `POST /exams/preview`** en la red. La respuesta del "1" llegaba
  después y sobrescribía la del "12": `onRequestedChange` no tenía guard de orden, a
  diferencia de `loadTemplate` (`templateRequestId`).

  **HECHO** (`exam-builder.component.ts`): los edits ahora entran a un `Subject` y pasan por
  `groupBy(cellKey) → debounceTime(300) → switchMap`. El `groupBy` PRIMERO es lo que importa:
  el debounce colapsa las teclas de UNA celda sin tragarse el edit de otra, y el `switchMap`
  cancela el request viejo de esa misma celda, que es lo que hace estructuralmente imposible
  que una respuesta obsoleta pise a una nueva. 300 ms, el mismo valor que el buscador de
  exámenes ya usaba. 3 tests nuevos (debounce, respuesta tardía descartada, celdas
  independientes). Verificado en la app: escribir "12" ahora es **1 request** y la celda
  muestra **12 ids**.

- [x] **"Generar más formas" en realidad reemplazaba** — el botón decía *más*; el panel y el
  modal decían "se reemplazarán". El modal estaba bien; el botón mentía.
  **HECHO**: el botón ahora dice **"Regenerar formas"**, y "Generar formas" cuando todavía no
  hay ninguna (`exam-versions-panel.component.html`). Verificado en la app.

- [x] **Filtro sin resultados mostraba un mensaje falso** (reproducido) — Estado →
  "Borrador" con 0 coincidencias decía "Aún no tienes exámenes. Crea el primero para
  empezar." teniendo 6 exámenes.
  **HECHO**: `hasActiveFilters()` decide cuál de los dos empty states se renderiza; el
  filtrado dice **"No hay exámenes con estos filtros."** con un botón **"Quitar filtros"**
  que limpia estado/grado/búsqueda (cancelando el debounce pendiente) y recarga. 2 tests
  nuevos. Verificado en la app: 0 filas filtradas → mensaje correcto → "Quitar filtros" →
  6 filas de vuelta.

- [ ] **Los filtros no viven en la URL** — tras filtrar, `location.href` sigue siendo
  `/app/exams`. Se pierden al recargar, no se pueden compartir ni volver con Atrás.

- [ ] **Borrar un borrador: sin confirmación y sin deshacer** (reproducido: 7 → 6 filas al
  instante) — deliberado en `exam-list.component.ts:176-183`, pero un borrador puede tener 80
  preguntas ya armadas. Sin modal, sin toast, sin "Deshacer".

- [x] **El botón principal quedaba bloqueado y mudo** — grilla recién cargada:
  `disabled=true`, `aria-disabled=true`, `title=null`, progreso "0 de 0" y el `lock-reason`
  **ni existía en el DOM** (solo se renderizaba con celdas pedidas). Misma clase de bug que
  la auditoría anterior ya arregló para "Cargar plantilla".
  **HECHO**: `lockReason()` devuelve `string | null` y cubre los tres estados — grilla vacía
  ("Escribe cuántas preguntas quieres en al menos una celda…"), faltantes (ahora dice qué
  hacer: "baja la cantidad o agrega preguntas al banco", con singular/plural), y `null`
  cuando el botón está habilitado. El template renderiza la razón para CUALQUIER estado
  bloqueado. Test nuevo. Verificado en la app sobre la grilla recién cargada.

- [x] **Las descargas caían con nombre basura** — los links `blob:` tenían `download=""`, así
  que el archivo se guardaba como `05ad20b5-ffca-4445-b09b-2855bf99529c.pdf`, y el ZIP como
  `examen-<uuid>-versiones.zip`. (Adentro del ZIP los nombres **sí** estaban bien.)
  **HECHO**: `downloadNameFor(code, kind)` nombra cada link con el título del examen y su
  forma; el ZIP usa el título. `/`, `\` y `:` se reemplazan por `-` (separadores de ruta).
  2 tests nuevos. Verificado en la app:
  `Examen Pre-admisión — 15-8-2026 — Forma A.pdf`, `… — Claves A.pdf`.

- [x] **Los errores del servidor se tiraban a la basura** — un ID de reemplazo inválido
  devuelve **400 con mensaje** y la UI mostraba "No se pudo reemplazar la pregunta.
  Inténtalo de nuevo.": un consejo falso, porque reintentar el mismo ID falla igual.
  **HECHO**: `exam-review` ahora usa `extractErrorMessage(error, fallback)` —el mismo helper
  que el banco ya usaba, al que se le agregó el `fallback` como parámetro sin cambiar su
  comportamiento anterior— así que el mensaje del servidor llega verbatim. Test nuevo.
  Pendiente aparte: el botón "Reintentar" recarga el examen, no el reemplazo.

- [ ] **Reroll silencioso** — "Cambiar" funcionó (`ee6c8ba7` → `255d7b9a`) sin ningún feedback
  visual, y como la fila solo muestra UUIDs el docente no percibe el cambio. Sin estado de
  carga (`exam-review.component.ts:93-108`): doble click = 2 reemplazos.

- [~] **Títulos indistinguibles y "Copia de Copia de"** (reproducido) — 3 filas llamadas
  exactamente `Examen Pre-admisión — 14/8/2026`, y duplicar dos veces produce
  `Copia de Copia de Examen Pre-admisión — 15/8/2026`. La lista se busca por título.

  **HECHO a medias**: el builder ahora tiene **"Nombre del examen (opcional)"**, cuyo
  placeholder previsualiza el nombre autogenerado — quien no lo toca vive exactamente la
  experiencia de antes, y quien lo toca ya no produce duplicados. El campo se persiste con el
  resto del borrador. Verificado en la app: el examen quedó como
  `Simulacro UNCP Área II — marzo | Pre-admisión · 80 preguntas · 3 formas`.

  **Queda**: no hay endpoint para RENOMBRAR un examen ya creado, así que los títulos viejos
  (y el apilamiento "Copia de Copia de") siguen ahí. Necesita un `PATCH /exams/:id`.

- [x] **La cantidad de formas estaba hardcodeada en 2** — el docente que quería 4 tenía que
  generar 2 (compilación desperdiciada), entrar a la pantalla de formas, abrir el panel,
  elegir, y pasar por el modal de peligro: ≈4 clicks extra y PDFs tirados a la basura.
  **HECHO**: selector **"¿Cuántas formas?"** en el builder, default 2 (cero cambios para
  quien no lo toca). El catálogo `VERSION_COUNT_OPTIONS`/`DEFAULT_VERSION_COUNT` se movió a
  `exam-versions.models.ts` para que las dos pantallas que pueden generar no se separen.
  4 tests nuevos. Verificado en la app: 3 formas de una sola pasada, sin regenerar.

- [ ] **"Generado" para exámenes sin ninguna forma** — el borrador confirmado aparece como
  "Generado" con 0 formas (`exam-list.component.ts:146-148` mapea `ready → "Generado"`). Para
  el docente "generado" significa PDFs listos.

- [ ] **11 de 12 grados son callejón sin salida** — "5° secundaria" muestra "No hay preguntas
  aprobadas para este grado todavía". La DB tiene **64,218 preguntas, todas `pre`**
  (`select grade_level, status, count(*) from questions group by 1,2`). El dropdown ofrece 12
  grados donde 11 no llevan a nada.
  **Fix**: marcar/deshabilitar los grados sin banco, o mover el grado después del tipo.

---

## P2 — Pulido

- [ ] **El segmentado de dificultad no tiene estado accesible** — Fácil/Media/Difícil sin
  `role=radiogroup` ni `aria-pressed`/`aria-checked`: la selección es **solo color**
  (`bg-tint-active`). Falla para daltónicos y lectores de pantalla.
- [ ] **1,656 inputs numéricos sin nombre accesible** (medido en vivo) — `ui-input` en
  `grid-cell-content.component.ts:23-28` no recibe `label`; el contexto curso·tema·dificultad
  es puramente visual.
- [ ] **Doble render desktop+móvil** — 13,136 nodos DOM y 1,656 inputs para 828 celdas reales:
  ambos layouts están siempre en el DOM (`hidden md:block` / `md:hidden`,
  `exam-builder.component.html:153` y `:227`). En desktop el bloque móvil es `display:none`,
  así que **no** afecta tabulación ni lectores — es peso de DOM y de change detection.
  **Fix**: `@if` sobre un signal de breakpoint.
- [ ] **Vocabulario** — la etiqueta dice "Track" mientras las opciones dicen "Área I…"
  (`exam-builder.component.html:31`); "Dashboard" en inglés en un nav 100% español
  (`shell.component.ts:17`); el login dice "Exams Generator" y el título de página
  "GeneraExamen".
- [ ] **El puente a IA pierde la cantidad** — la celda dice "Generar 2 con IA"
  (`grid-cell-content.component.ts:40`) y el generador abre con CANTIDAD 5
  (`ai-generate.component.ts:69`): `count` no viaja en los query params
  (`exam-builder.component.ts:776-780`).
- [ ] **Copy roto en el candado** — "Disponible cuando completes las 1, faltan 1"
  (`exam-builder.component.ts:788-791`). No dice qué hacer (bajar la cantidad o conseguir
  preguntas).
- [ ] **"las 2 forma(s)"** — pluralización con barra en el modal de regeneración.
- [ ] **Los tipos de examen no se explican** — "Manual", "Rápido (semana actual)", "Examen
  tipo admisión", "Examen tipo admisión por semana" sin una línea de ayuda que diga en qué se
  diferencian ni qué implica cada uno.
- [ ] **El default es el peor camino para un novato** — `selectedExamTypeCode` arranca en
  `'manual'` (`exam-builder.component.ts:197`) y `manual` es `sortOrder: 0` en el catálogo
  (`apps/api/src/db/seed.ts:720`). El novato aterriza sobre una matriz de 828 celdas vacías.
  **Fix**: default guiado, manual a un click. El experto no pierde nada.
- [ ] **El campo "Cantidad total de preguntas" se muestra siempre** con su párrafo de ayuda
  largo, aunque solo aplica a plantillas tipo UNI.
- [ ] **La grilla completa se carga apenas eliges un tipo no-manual**, antes de elegir
  universidad: 276 filas de ruido bajo un formulario de 3 campos.

---

## No son hallazgos (verificados y sanos)

Se dejan escritos para que nadie los vuelva a auditar:

- **La generación de PDFs funciona**. 2 y luego 3 formas, en segundos, con progreso vivo por
  SSE y anuncio en `aria-live`. Los PDFs son reales: `application/pdf`, 28,430 y 16,099 bytes.
- **El ZIP funciona y sus nombres internos son correctos**: `Examen-A.pdf`, `Claves-A.pdf`,
  `Examen-B.pdf`… (solo el nombre del ZIP en sí usa el UUID).
- **El modal de regeneración es honesto**: nombra cuántas formas se pierden y que los PDFs
  dejan de estar disponibles.
- **La plantilla resuelve bien**: UNCP Área II → 80 preguntas, 16 celdas, 0 faltantes, botón
  habilitado.
- **El prefill del puente a IA funciona**: grado, curso y tema llegan correctos por query
  params y el orden de los `set` en `ngOnInit` está bien pensado (no se pisan entre sí).
- **El bloque móvil oculto no contamina la accesibilidad**: `display:none` real, no `hidden`
  attribute — no es tabulable ni lo leen los lectores de pantalla.
- **Los guards de respuesta obsoleta de `loadTemplate`/`onUniversityChange` están bien
  hechos** — el problema es que `onRequestedChange` no los copió.

---

## Zonas no auditadas

- Generación IA real end-to-end (gasta cuota de OpenRouter y minutos) — solo se auditó el
  puente y el prefill.
- Cola de revisión IA e Historial IA.
- Rol `teacher` (toda la sesión corrió como `school_admin`) y visibilidad cross-tenant.
- Modo oscuro.
- Estados de red caída / API caída en el flujo de generación.
- Banco de preguntas y landing (fuera de alcance de esta auditoría).

---

## Orden de ataque

1. ~~Conteos de `GET /exams`~~ ✅ — sin esto la lista era inservible.
2. ~~**Tanda barata de alto impacto**~~ ✅ — razón siempre visible en el botón bloqueado ·
   debounce + descarte de respuestas obsoletas en el preview · nombres de archivo reales ·
   "Regenerar formas" · empty state filtrado + "Quitar filtros" · mensaje 400 del servidor ·
   CTA de formas en la revisión + copy honesto cuando está bloqueado.
3. ~~**No perder el trabajo al salir + revisión legible + plantilla visible**~~ ✅ —
   persistencia del builder · nombres, enunciado y clave como letra en la revisión · recibo
   y filtro "ver solo lo pedido".
4. ~~**Nombre y cantidad de formas desde el builder**~~ ✅ — falta solo el `PATCH /exams/:id`
   para renombrar exámenes YA creados.
5. **El modelo mental** (decisión de producto primero): separar "confirmado" de "bloqueado" ·
   móvil (footer sticky + colapsar) · default guiado · grados sin banco.

### Estado de la suite (2026-08-15)

| Tanda | API non-e2e | Web | Tests nuevos |
|---|---|---|---|
| 2 (baratos + conteos) | 824/824 | 705/705 | 13 |
| 3 (persistencia + revisión legible + plantilla visible) | 829/829 | 717/717 | 13 |
| 4 (nombre + cantidad de formas) | 829/829 | **722/722** | 5 |

### El camino guiado hoy, medido punta a punta

Tipo de examen → Universidad → Área → (nombre opcional, formas opcional) → **Generar
versiones**: 7 clicks, resultado verificable en 2 pantallas de scroll, 3 formas de una sola
pasada, y la lista mostrando `Simulacro UNCP Área II — marzo · 80 preguntas · 3 formas`.

Todo verificado además en la app corriendo con Playwright, no solo en tests — cada ítem `[x]`
dice qué se comprobó en pantalla.
