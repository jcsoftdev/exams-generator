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

| Camino                     | Clicks | Tipeo    | Resultado                                      |
| -------------------------- | ------ | -------- | ---------------------------------------------- |
| Plantilla (UNCP → Área II) | 7      | 0        | 80 preguntas, todo satisfacible ✅             |
| Manual (Pre-admisión)      | 2 + N  | N celdas | grilla de 276 filas × 3 dificultades en blanco |

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
      _"Puedes seguir navegando — el progreso queda guardado"_.

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

- [x] **Móvil: 146 pantallas de scroll hasta el botón principal** (medido en 390×844)

  ```
  columna de tarjetas: 114,314 px   contenedor scrollable: 783 px  → 146 pantallas
  footer "Generar versiones": position: static, offsetTop 114,735 px
  ```

  En desktop la grilla vive en `max-h-[70vh]` con el footer justo debajo; en móvil las 276
  tarjetas estaban en el flujo de la página y el footer al final de todo.

  **HECHO**, dos cambios que se complementan:
  - **Footer `sticky bottom-0`** (con fondo, borde y `z-20` para que las filas no se
    transparenten debajo). Sin JS y en los dos layouts: en desktop no molesta —la grilla ya
    tiene su propio scroller— y de paso el progreso queda siempre a la vista.
  - **Cursos colapsados por defecto SOLO en pantalla angosta** (`isNarrowScreen`, vía
    `matchMedia('(max-width: 767px)')` con listener para rotación/resize). La consulta es
    `max-width` a propósito: un entorno sin `matchMedia` —o el stub de jsdom, que responde
    `matches: false`— lee "no angosto", o sea el comportamiento desktop de siempre. En
    desktop se siguen expandiendo todos: ahí las filas no cuestan nada de alcanzar.

  3 tests nuevos. Medido en la app a 390×844:
  **114,314 px (146 pantallas) → 950 px (1 pantalla)**, 21 encabezados de curso, 0 tarjetas
  abiertas, footer `sticky` y visible. Abrir un curso muestra sus 15 tarjetas y el footer
  **sigue visible incluso con el scroller al fondo**. Desktop verificado sin cambios: 276
  filas expandidas, footer visible.

### Web — el examen se sella solo

- [x] **Generar confirmaba el examen y lo bloqueaba para siempre**
      El backend auto-confirma `draft → ready` antes de encolar
      (`exam-generation.service.ts:129-141`), y el builder saltaba directo a `/versions`. Un click
      creaba Y sellaba un examen que el docente nunca había leído: al volver a la revisión los 5
      "Cambiar" estaban `disabled`, el campo de reemplazo desaparecido, y no existe endpoint para
      reabrirlo — **mientras el texto de arriba seguía diciendo "Cámbialas si quieres"**.

  **DECISIÓN (2026-08-17): opción (a)** — el builder pasa por revisión antes de generar.

  **HECHO**:
  - **Builder**: su acción principal se llama ahora **"Revisar examen"** y hace exactamente
    eso: `POST /exams` (queda `draft`) y navega a `/app/exams/:id?formas=N`. Ya **no** llama
    a `generateVersions` — nada se sella antes de poder leerse. La cantidad de formas elegida
    viaja en el query param, así que el paso extra no le cuesta al docente ninguna decisión
    extra.
  - **Revisión**: es la pantalla que genera. Acción principal **"Generar N formas"** (con su
    propio selector de cantidad, por si cambias de idea justo antes de compilar). Confirmar y
    generar es UNA decisión y un click: `POST versions` ya auto-confirma el borrador en el
    backend — ese auto-confirm era peligroso llamado desde el builder (sellaba a ciegas) y es
    correcto llamado desde acá (sella lo que el docente acaba de leer). "Confirmar examen"
    se queda al lado como **"Solo confirmar"** (ghost) para congelar la selección sin
    compilar todavía — es un estado que la API modela.
  - El copy del intro ya no promete lo que la pantalla no permite, en ninguno de los dos
    estados.

  9 tests nuevos (3 del nuevo contrato del builder, 6 de la generación desde revisión,
  incluyendo `?formas` basura → default en vez de `NaN`). Verificado punta a punta en la app:
  builder ("Revisar examen", 4 formas) → examen **Borrador** con enunciados legibles y
  "Cambiar" **habilitado** → se cambió una pregunta de verdad → "Generar 4 formas" →
  **"Generación completada: 4 de 4 formas"**.

  Nota: sigue sin existir "volver a borrador" para un examen ya generado. Con este flujo
  importa mucho menos (nadie sella sin ver), pero si algún día se quiere editar un examen ya
  compilado, necesita endpoint propio.

- [x] **"Confirmar examen" terminaba en callejón sin salida** (reproducido)
      Tras confirmar, el banner decía _"Examen confirmado. Ya puedes generar las versiones y sus
      hojas de claves."_ Conté en esa sección: **0 links**, y los únicos botones eran 5 "Cambiar"
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

- [x] **"Generar más formas" en realidad reemplazaba** — el botón decía _más_; el panel y el
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

- [x] **Los filtros no vivían en la URL** — tras filtrar, `location.href` seguía siendo
      `/app/exams`: se perdían al recargar y un link nunca los llevaba.
      **HECHO**: se siembran DESDE la URL y se escriben de vuelta en cada cambio, con
      `replaceUrl` (filtrar no debe apilar historial: Atrás tiene que salir de la pantalla, no
      deshacer seis teclas) y omitiendo las claves vacías para no dejar `?status=&search=`.
      2 tests. Verificado: `/app/exams?status=ready&search=Simulacro` restaura filtro, texto y
      resultados.

- [x] **Borrar un borrador: sin confirmación y sin deshacer** (reproducido: 7 → 6 filas al
      instante). El "un borrador no tiene nada que perder" del código original no se sostiene: un
      borrador puede llevar 80 preguntas armadas y el disparador es un ítem de un menú chiquito.
      **HECHO**: todos los borrados confirman, y el modal dice qué se lleva por delante
      ("Tiene 80 preguntas y 3 formas ya generadas"). 1 test reescrito.

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

- [x] **Reroll silencioso** — "Cambiar" funcionaba sin ningún feedback visual.
      **HECHO**: banner de éxito con la posición ("Cambiamos la pregunta 1."), capturada ANTES de
      recargar —después de la recarga esa posición ya tiene otra pregunta— y limpiada al empezar
      cualquier acción, para que nunca describa un cambio viejo. 2 tests.
      **HECHO también el doble click**: `replacing` bloquea la fila mientras el reemplazo está en
      vuelo (dos clicks mandaban DOS `POST .../replace` y la segunda respuesta pisaba a la
      primera). Se libera en los DOS desenlaces — una fila trabada tras un error sería peor que el
      error. 3 tests.

- [x] **Títulos indistinguibles y "Copia de Copia de"** (reproducido) — 3 filas llamadas
      exactamente `Examen Pre-admisión — 14/8/2026`, y duplicar dos veces produce
      `Copia de Copia de Examen Pre-admisión — 15/8/2026`. La lista se busca por título.

  **HECHO a medias**: el builder ahora tiene **"Nombre del examen (opcional)"**, cuyo
  placeholder previsualiza el nombre autogenerado — quien no lo toca vive exactamente la
  experiencia de antes, y quien lo toca ya no produce duplicados. El campo se persiste con el
  resto del borrador. Verificado en la app: el examen quedó como
  `Simulacro UNCP Área II — marzo | Pre-admisión · 80 preguntas · 3 formas`.

  **HECHO también la otra mitad**: `PATCH /exams/:examId` (nuevo) + "Renombrar" en el menú de
  cada fila, con el nombre actual precargado (renombrar casi siempre es editar lo que hay, no
  escribir de cero) y guardado deshabilitado si el nombre queda vacío. Tenant-scoped en el
  `WHERE`, así que un id ajeno no matchea ninguna fila en vez de filtrar si existe. 3 tests de
  repositorio + 2 de UI. Verificado en la app: "Copia de Examen Pre-admisión — 15/8/2026" →
  "Simulacro de repaso — 5° secundaria".

- [x] **La cantidad de formas estaba hardcodeada en 2** — el docente que quería 4 tenía que
      generar 2 (compilación desperdiciada), entrar a la pantalla de formas, abrir el panel,
      elegir, y pasar por el modal de peligro: ≈4 clicks extra y PDFs tirados a la basura.
      **HECHO**: selector **"¿Cuántas formas?"** en el builder, default 2 (cero cambios para
      quien no lo toca). El catálogo `VERSION_COUNT_OPTIONS`/`DEFAULT_VERSION_COUNT` se movió a
      `exam-versions.models.ts` para que las dos pantallas que pueden generar no se separen.
      4 tests nuevos. Verificado en la app: 3 formas de una sola pasada, sin regenerar.

- [x] **"Generado" para exámenes sin ninguna forma** — el estado del examen y la existencia de
      PDFs son dos hechos distintos, y la etiqueta los confundía.
      **HECHO**: `ready` + 0 formas → **"Listo"**; `ready` + N formas → **"Generado"**. 1 test.
      Verificado en la app: la fila con `5 preguntas · 0 formas` dice "Listo".

- [x] **11 de 12 grados eran callejón sin salida** — "5° secundaria" mostraba "No hay preguntas
      aprobadas para este grado todavía", y el docente lo descubría DESPUÉS de elegir. La DB tiene
      **64,218 preguntas, todas `pre`**.

  **HECHO**, endpoint nuevo + etiquetas honestas:
  - **API** `GET /exams/stock/grades` → conteo de aprobadas por grado, tenant-scoped con la
    MISMA regla de visibilidad que el pool (`questionVisibility`, no duplicada). Una sola
    consulta agrupada, no 12 — un fan-out por grado tumbaría el ThrottlerGuard. El servicio
    completa el catálogo con ceros para que el cliente no tenga que adivinar si una clave
    ausente es "cero" o "no sé". 3 tests de repositorio (deltas, no absolutos: el agregado
    abarca todo el banco visible y la Postgres local trae cruft de otras suites).
  - **Web**: las opciones de "Grado" se anotan solas. Si el conteo falla, las etiquetas quedan
    **exactamente** como antes — una request que nunca respondió no puede convertirse en "sin
    preguntas". 3 tests.

  Verificado en la app:

  ```
  1° primaria · sin preguntas        …  (los 11)
  Pre-admisión · 64166 preguntas
  ```

---

## P2 — Pulido

- [x] **El segmentado de dificultad no tenía estado accesible** — Fácil/Media/Difícil sin
      `role`/`aria-checked`: la selección era **solo color** (`bg-tint-active`), invisible para un
      lector de pantalla y ambigua para un daltónico.
      **HECHO**: `role="radiogroup"` + `aria-labelledby` apuntando al rótulo "Nivel", `role="radio"`
      con `aria-checked` por opción, y un punto `•` como segunda señal que no depende del color.
      2 tests. Verificado en la app: `NIVEL` → `Fácil(false) · Media(false) · • Difícil(true)`.

- [x] **1,656 inputs numéricos sin nombre accesible** (medido en vivo) — el contexto
      curso·tema·dificultad de cada celda era puramente visual.
      **HECHO**: `ui-input` y `ui-button` ganaron un `ariaLabel` (invisible, ignorado cuando ya hay
      `label` visible para que nada quede doble-nombrado), y la celda arma
      `"Curso · Tema · Dificultad"`. También nombra los 3 botones puente, que repiten texto
      idéntico ("Elegir del banco") en cada celda corta y solo se distinguían por posición.
      4 tests. Verificado en la app: **828 inputs, 0 sin nombre**, p. ej.
      `"Preguntas de Aritmética · Teoría de Conjuntos · Fácil"`.
- [x] **Doble render desktop+móvil** — 13,136 nodos DOM y 1,656 inputs para 828 celdas reales:
      ambos layouts vivían siempre en el DOM. El oculto es `display:none`, así que **no** afectaba
      tabulación ni lectores — era peso de parse y de change detection.
      **HECHO**: `@if (!isNarrowScreen())` monta un solo layout, reusando el signal que ya seguía
      el viewport para colapsar cursos en móvil (así que redimensionar sigue cambiando de layout).
      2 tests reescritos. Medido en la app: **13,136 → 5,857 nodos (-55%)**, **1,656 → 828 inputs**
      (exactamente una copia).
- [x] **Vocabulario** — la etiqueta decía "Track" mientras las opciones decían "Área I…";
      "Dashboard" en inglés en un nav 100% español; el login decía "Exams Generator" y el título de
      página "GeneraExamen".
      **HECHO**: la etiqueta del campo se **deriva** — "Área" cuando la universidad usa áreas de
      admisión (UNCP), "Ciclo" cuando usa ciclos de preparación (UNI), porque un "Área" hardcodeado
      habría sido igual de incorrecto la mitad de las veces. "Dashboard" → **"Panel"** (el título de
      la ruta ya lo decía). "Exams Generator" → **"GeneraExamen"** en las 4 apariciones (login,
      sidebar, topbar fallback, `document.title`). 3 tests + 2 actualizados.
- [x] **El puente a IA perdía la cantidad** — la celda decía "Generar 2 con IA" y el generador
      abría con CANTIDAD 5.
      **HECHO**: el faltante exacto viaja como `count` en los query params y el generador lo
      adopta, con guarda de rango (`0`, basura o `> 10` conservan su default). 3 tests.
- [x] **Copy roto en el candado** — "Disponible cuando completes las 1, faltan 1". No decía qué
      hacer. **HECHO** junto con el ítem del botón mudo: ahora singular/plural correctos y la
      salida explícita ("baja la cantidad o agrega preguntas al banco").
- [x] **"las 2 forma(s)"** — **HECHO**: "la forma actual" / "las N formas actuales".
- [x] **Los tipos de examen no se explicaban** — cuatro labels sin una línea que diga en qué se
      diferencian. **HECHO** junto con la elección explícita: una frase por tipo bajo el select.
- [x] **El default era el peor camino para un novato** — `selectedExamTypeCode` arrancaba en
      `'manual'` (que además es `sortOrder: 0` en el catálogo), así que el novato aterrizaba sobre
      una matriz de 828 celdas vacías sin que nada le dijera que existe un camino guiado.

  **HECHO — pero NO como decía el fix original de este audit.** No se cambió el default a un
  tipo guiado: las plantillas solo existen para universidades preuniversitarias, así que
  preseleccionar "Examen tipo admisión" sería activamente incorrecto para un colegio de
  primaria, y dispararía `getUniversities` en cada carga. En su lugar la elección es
  **explícita y explicada**:
  - Sin preselección: el trigger dice **"¿Cómo quieres armarlo?"**.
  - Sin elegir, un hint invita al camino guiado ("Si preparas un simulacro de admisión…") en
    vez de dejar la pantalla muda.
  - Elegido, una línea explica qué hará ese tipo — los cuatro labels no daban forma de
    distinguirlos.
  - `null` se comporta igual que `'manual'` para todo lo de abajo (`isManual`), así que el
    invariante EB-T sigue en pie: la grilla es idéntica.

  4 tests nuevos. Verificado en la app: placeholder correcto, hint presente, y al elegir
  Manual → "Lo armas tú: eliges curso por curso…" con Grado visible y cero afordancias de
  plantilla.

- [ ] **El campo "Cantidad total de preguntas" se muestra siempre** con su párrafo de ayuda
      largo, aunque solo aplica a plantillas tipo UNI.
- [x] **La grilla completa se cargaba apenas elegías un tipo no-manual**, antes de elegir
      universidad: 276 filas de ruido bajo un formulario de 3 campos.
      **HECHO**: `showsGrid()` — en manual basta el grado (la grilla ES la herramienta); en un tipo
      guiado espera a que la plantilla traiga filas, con un hint que dice qué falta ("Elige la
      universidad y el área…", el sustantivo derivado igual que la etiqueta del campo). El
      pre-warm del catálogo (la fetch) se queda: lo que esperaba era el render. 3 tests.
      Verificado en la app: al elegir el tipo la página queda en **152 nodos**; tras elegir
      universidad + área aparece la grilla con "80 preguntas pedidas en 16 celdas".

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
- ~~Cola de revisión IA e Historial IA~~ — auditadas el 2026-08-18, ver [`docs/audit-2026-08-18-zonas-no-auditadas.md`](./audit-2026-08-18-zonas-no-auditadas.md).
- ~~Rol `teacher`~~ — auditado el 2026-08-18, ver [`docs/audit-teacher-role-2026-08-18.md`](./audit-teacher-role-2026-08-18.md) (queda pendiente ahí la pasada visual). Visibilidad cross-tenant auditada el 2026-08-18: sin fugas, 54 tests de regresión — mismo doc.
- ~~Modo oscuro~~ — auditado y arreglado el 2026-08-18, ver [`docs/audit-2026-08-18-zonas-no-auditadas.md`](./audit-2026-08-18-zonas-no-auditadas.md) (falta el viewport móvil).
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
5. ~~**El modelo mental + móvil**~~ ✅ — el builder pasa por revisión (opción (a), decidida
   2026-08-17) · footer sticky y cursos colapsados en móvil.
6. ~~**Arranque de la pantalla**~~ ✅ — elección de tipo explícita y explicada · grados
   anotados con su stock real.
7. ~~**Accesibilidad + vocabulario**~~ ✅ — segmentado con estado real, 828 inputs nombrados,
   "Área"/"Ciclo", "Panel", "GeneraExamen".
8. ~~**Peso de DOM + errores honestos + pulido**~~ ✅ — un layout a la vez, "Reintentar" solo
   donde reintentar arregla algo, cantidad al puente IA, plurales, grilla a tiempo.
9. ~~**Cierre**~~ ✅ — filtros en la URL · confirmación al borrar · feedback del reroll ·
   `PATCH /exams/:id` + renombrar desde la lista · "Listo" vs "Generado".

### Estado final

**31 de 31 hallazgos cerrados.** Queda una sola cosa abierta, y es una decisión, no deuda:

- **El campo "Cantidad total de preguntas" sigue siempre visible** con su párrafo largo aunque
  solo aplique a plantillas tipo UNI. Esconderlo tras un disclosure es un cambio de diseño, no
  un arreglo, y el 400 del backend ya guía cuando hace falta.

### Verificación final (2026-08-17)

| Suite                                         | Resultado                 |
| --------------------------------------------- | ------------------------- |
| API non-e2e                                   | 852/852 (86 archivos)     |
| API **e2e** (Postgres + Redis + Typst reales) | **196/196** (24 archivos) |
| Web                                           | 767/767 (70 archivos)     |

La suite e2e se corrió al final a propósito: esta auditoría cambió contratos del backend
(`courseName`/`topicName` en el detalle, dos endpoints nuevos) y los specs e2e son los únicos
que ejercitan la API real de punta a punta.

### Estado de la suite (2026-08-15)

| Tanda                                                   | API non-e2e | Web         | Tests nuevos |
| ------------------------------------------------------- | ----------- | ----------- | ------------ |
| 2 (baratos + conteos)                                   | 824/824     | 705/705     | 13           |
| 3 (persistencia + revisión legible + plantilla visible) | 829/829     | 717/717     | 13           |
| 4 (nombre + cantidad de formas)                         | 829/829     | 722/722     | 5            |
| 5 (builder → revisión → generar)                        | 829/829     | 730/730     | 9            |
| 6 (móvil alcanzable)                                    | 829/829     | 733/733     | 3            |
| 7 (arranque: tipo explicado + stock por grado)          | 849/849     | 740/740     | 10           |
| 8 (accesibilidad + vocabulario)                         | 849/849     | 749/749     | 9            |
| 9 (peso de DOM + errores honestos + pulido)             | 849/849     | 757/757     | 8            |
| 10 (cierre: URL, borrado, feedback, rename, estado)     | **852/852** | **764/764** | 13           |

### El camino guiado hoy, medido punta a punta

Tipo de examen → Universidad → Área → (nombre opcional, formas opcional) → **Revisar examen**
→ leer/cambiar preguntas → **Generar N formas**: 8 clicks, resultado verificable en 2
pantallas de scroll (eran 42), N formas de una sola pasada, nada se sella sin haberse leído, y
la lista mostrando `Simulacro UNCP Área II — marzo · 80 preguntas · 3 formas`.

Todo verificado además en la app corriendo con Playwright, no solo en tests — cada ítem `[x]`
dice qué se comprobó en pantalla.

---

## Segunda pasada — plantillas y autocompletado (2026-08-18)

Re-auditoría con Playwright pedida explícitamente: verificar que **las plantillas estén
bien**, que el **autocompletado sea automático e inteligente**, y que **generar sea de simples
clicks**. Cada plantilla se contrastó contra `exam_blueprint_templates` en la DB, no contra lo
que la UI dice de sí misma.

### Lo que estaba bien

- **Resolución de plantilla, exacta.** UNCP Área II: las 16 filas de la DB caen en 11 filas de
  UI (una por curso, 3 celdas) y suman 80 preguntas. El mapeo de NIVEL es correcto y
  consistente: `P.B.→Fácil`, `P.I.→Media`, `P.A.→Difícil`. Aritmética `P.I.=2 / P.A.=6` sale
  como `M:2 D:6`; RM `6/6/7`; Comunicación `M:5`.
- **Autocarga real en 3 de los 4 flujos**: 6 clicks (tipo → universidad → área) dejan 80
  preguntas puestas, sin tocar ningún botón.
- **El aviso "inteligente" funciona.** Hoy es semana 15 del ciclo UNCP y el temario cargado
  llega hasta la 13; la app lo detecta y lo dice con la semana exacta ("cubre hasta la semana
  13… modo acumulativo"). Coincide con `max(week_number)` de la DB.
- **Stock suficiente**: 16 de 16 celdas satisfacibles, botón habilitado, cero faltantes.

### 🔴 P0 — Las plantillas se sumaban entre sí (arreglado, `ef9dff6`)

Cargar UNCP Área II (80) y luego cambiar a UNI dando su total requerido de 100 dejaba
**153 preguntas en 26 celdas**: las dos plantillas superpuestas. `setRequested` sobreescribe
por celda, así que solo colapsaban las compartidas — de ahí 153 y no 180. Aritmética quedaba
`M:8 D:6`: el 8 de UNI, el 6 de UNCP. El examen no correspondía a ninguna universidad, el
botón de generar seguía habilitado, y nada lo advertía.

Peor aún, un 404 (elegir un ciclo sin plantilla) dejaba las 80 preguntas de la universidad
anterior listas para generar, debajo del mensaje de error.

**Regla del fix**: el pedido pertenece a la selección actual de plantilla. Se limpia al cambiar
tipo/universidad/ciclo **y** cuando el resolve falla.

### 🟠 P1 — El autocompletado se cortaba justo donde más se necesita (arreglado, `ef9dff6`)

UNI no publica preguntas por curso, así que la API responde 400 pidiendo el total. El docente
lo escribía… y no pasaba nada: el campo solo guardaba el valor. Tenía que descubrir "Cargar
plantilla", un botón que en los otros tres flujos nunca hace falta. Ahora re-resuelve solo
(debounce 600 ms, porque el número se escribe dígito a dígito).

### 🟡 P2 — Ruido del formulario (arreglado, `e2286f6`)

- El botón decía "Cargar plantilla" para siempre pese a que todo autocarga. Ahora dice en qué
  estado está: `Cargar plantilla` → `Volver a cargar` → `Reintentar`.
- El selector de cursos de "Rápido" eran 42 checkboxes sin buscador, sin agrupar y sin "todos".
  Ahora tiene filtro (en memoria, insensible a tildes: "quimica" encuentra "Química"),
  `Todos`/`Ninguno`, contador "N de M elegidos" y alto máximo.

### 🟡 Higiene de datos — basura de tests en el catálogo del docente

19 de 60 cursos eran artefactos de suites e2e (`E2E Alt Images Course d13007ff-…`), visibles en
el selector. **No es un bug del script**: `db:purge-test-taxonomy` los barre bien, pero solo
corre al final de `pnpm test`, y correr `jest` directo (lo normal al iterar) lo saltea.
Corrido a mano: 17 barridos, catálogo 60 → 43, cursos reales del stage 42 → 25.
Los 2 restantes están protegidos por el guard de uso real (tienen exámenes e2e apuntándolos);
el guard hace bien en ser conservador — no puede distinguir un examen de prueba de uno real.

### Método

El P0 no lo encuentra ninguna suite: cada flujo por separado funciona, y los tests montan el
componente de cero. Solo aparece al **encadenar** dos plantillas en la misma sesión, que es
exactamente lo que hace un docente comparando universidades.
