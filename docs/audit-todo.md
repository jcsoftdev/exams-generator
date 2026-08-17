# Auditoría UI + Funcionalidades — Todo List

> Generada 2026-07-24. Tres auditorías paralelas: web (Angular), API (NestJS), landing (Astro).
> Prioridades: **P0** = vergonzoso/roto/seguridad · **P1** = claramente no profesional o frágil · **P2** = pulido.
>
> **Estado: cerrada.** Los `[ ]` que quedan son diferidos razonados, no pendientes de trabajo.
> La auditoría vigente es [`docs/audit-2026-08-14.md`](./audit-2026-08-14.md).

---


Legend: `[ ]` todo · `[~]` in progress · `[x]` done

> **Nota (P2, logging wave)**: correr la suite e2e completa por primera vez esta sesión destapó 2 regresiones reales de trabajo anterior en esta misma auditoría: (1) el throttler de login (API P0) rompía cualquier e2e que hiciera >5 logins/min compartiendo IP/proceso — fix: `skipIf` en `ThrottlerModule.forRoot` cuando `NODE_ENV==="test"`. (2) La paginación de `GET /tenants` (API P1) rompía un test que buscaba tenants recién creados en una lista sin `ORDER BY` (la tabla no tiene `createdAt`) contra un Postgres local con cruft acumulado de corridas anteriores — fix: el test ya no busca presencia vía lista (ya cubierto por sus propios tests de `GET /tenants/:id`). Ambos arreglados y verificados: 694 tests non-e2e + 173 e2e, 100% verde.


## P0 — Arreglar antes de mostrar a cualquier usuario

### Web (Angular)

- [x] **Estado de error muerto en cola de revisión IA** — `errorMessage` se setea pero el template nunca lo lee; un fetch fallido se muestra como "La cola está vacía" (`apps/web/src/app/features/ai/ai-review-queue/ai-review-queue.component.ts:195-198`). Renderizar error + botón reintentar.
- [x] **Estado de loading muerto en revisar examen** — `loading` se setea pero nunca se renderiza; la página queda vacía durante el fetch inicial (`apps/web/src/app/features/exams/exam-review/exam-review.component.ts:46-66`). Agregar skeleton.
- [x] **Chrome decorativo que parece funcional** — buscador del topbar sin ningún handler (`apps/web/src/app/ui/topbar/topbar.component.ts:40-46`) y campana de notificaciones con badge pero click muerto (`shell.component.html:36-43`). Conectarlos o quitarlos. → quitados: sin backend de search/notificaciones real, dejarlos era peor que no tenerlos.
- [x] **Typo "Administra" en chip de rol** — debería ser "Administrador"; el spec además asegura el string incorrecto (`tenant-settings.component.ts:182-184`, `tenant-settings.component.spec.ts:214`). Corregir label + spec juntos.
- [x] **"Borrar" pregunta del banco sin confirmación** — borra permanente al primer click, mientras eliminar examen sí usa `ui-modal` (`bank-list.component.ts:515-524`). Agregar modal de confirmación.
- [x] **Página 403 sin estilos, en inglés y sin salida** — único screen fuera del design system, "403 - Forbidden" en inglés, sin link de regreso (`apps/web/src/app/features/forbidden/forbidden.component.ts`). Rediseñar en español con CTA de vuelta.

### API (NestJS)

- [x] **Login sin rate limiting** — `POST /auth/login` sin throttling ni lockout; brute-force libre (`apps/api/src/modules/auth/auth.controller.ts:9`). Agregar `@nestjs/throttler` por IP/cuenta.
- [x] **Generación de PDFs síncrona y sin tope de `versionCount`** — solo valida `>= 1`; un valor grande cuelga el API (`exam-generation.service.ts:87-99`, `exams.controller.ts:263-281`). Tope servidor hecho (`MAX_VERSION_COUNT`), y **la migración a BullMQ ya está hecha** (no se difirió): tabla `exam_version_jobs` (migración 0014), cola `exam-versions` con `concurrency: 1` (Typst es CPU-bound, a diferencia de los 2 workers de `generation` que esperan I/O de OpenRouter), `ExamVersionJobsProcessor`, SSE `GET /exams/:id/versions/jobs/:jobId/stream` y progreso en vivo en la pantalla de versiones. `POST /exams/:id/versions` ahora responde **202** con el job. Detalles de diseño:
  - **Toda la validación sigue siendo síncrona** (`ExamVersionGenerationService.prepareGeneration`, llamada antes de encolar): rango de `versionCount`, tenant, examen inexistente/cross-tenant, auto-confirm draft→ready y selección vacía devuelven el mismo 400/404/409 de siempre y no encolan nada. Solo la mitad cara se movió al worker.
  - `BullModule.forRoot` se sacó de `AiModule` a un `QueueModule` global (`common/queue.module.ts`) — con dos colas, dejarlo ahí hacía que la cola de exámenes dependiera implícitamente del módulo de IA.
  - El worker **no es resumible** (cada intento arranca con `clearVersions()` y reconstruye todo), así que `startAttempt()` resetea `completed_count` en cada reintento — al revés que `GenerationJobsProcessor`, que sí reanuda desde `createdCount + failedCount`.
  - Un `ExamPdfGenerationError` (Typst no compila una pregunta) se resuelve terminal de una: reintentar recompila lo mismo con el mismo resultado, no vale quemar el presupuesto de backoff. Cualquier otro error sí se relanza para que BullMQ reintente.
  - Los 5 e2e que leían las formas de la respuesta del POST ahora usan `test-support/generate-versions.ts` (`generateVersionsAndWait`).
  - `infra/nginx/web.conf`: el `proxy_read_timeout 120s` se queda, pero por otra razón — ya no lo pide un compile síncrono sino el SSE, que solo escribe un frame por forma terminada (comentario actualizado).
- [x] **Typst sin timeout** — `spawn("typst")` puede colgar el request indefinidamente (`adapters/pdf/typst-cli.adapter.ts:30-52`). AbortController + kill.
- [x] **OpenRouter sin timeout** — `fetch()` sin signal; cuelga el SSE y agota los 2 workers de BullMQ (`adapters/openrouter/openrouter.adapter.ts:48,63`). Timeout que lance error retryable.

### Landing (Astro)

- [x] **Footer expone nota interna** — "Pendiente antes de publicar: nombre de marca real…" visible a todo visitante (`apps/landing/src/pages/index.astro:212-215`). Eliminar.
- [x] **WhatsApp placeholder** — ambos CTAs apuntan a `wa.me/51999999999` (`index.astro:63,192`). Número real.
- [x] **Email placeholder** — `mailto:hola@examgen.pe`, dominio no verificado (`index.astro:196`). Confirmar dominio/buzón real.
- [x] **Marca "ExamGen" es placeholder** — el propio footer lo admite; no existe en el resto del monorepo. Definir marca real.
- [x] **Sin Open Graph ni Twitter Cards** — el canal de distribución es WhatsApp: el link compartido se ve pelado y feo (`src/layouts/Layout.astro:16-34`). Agregar OG + imagen de preview.
- [x] **Contraste WCAG falla en modo claro** — `#b98700` sobre `#ecefe9` ≈ 2.77:1 en CTA principal, logotipo "Gen" y números de pasos (`index.astro:580-589,450-452,791-799`). Oscurecer el amarillo claro.

---

## P1 — Claramente no profesional / frágil

### Web — formularios y acciones

- [x] **Submits que no-op en silencio (patrón repetido en 4 forms)** — botón habilitado con form inválido y sin errores inline. `bank-upload` fue eliminado (ver ítem "dos UIs"); `bank-new`, `ai-generate` y `tenant-settings` (agregar profesor) ahora bindean `[disabled]` a validez real + mensaje inline.
- [x] **Acciones destructivas sin confirmación** — "Restablecer contraseña", "Desactivar" profesor, "Archivar" pregunta, "Generar más formas" (solo cuando reemplaza formas existentes) ahora pasan por `ui-modal` con botón `danger`.
- [x] **Falta variante `danger` de botón** — `ButtonVariant` ahora incluye `'danger'` (reusa el token `hard-text`); aplicado a los confirm de Eliminar/Rechazar/Borrar/Archivar/Desactivar/Restablecer/Generar.
- [x] **Dos UIs incompatibles para subir preguntas** — `/app/bank/upload` eliminado (componente, ruta, spec); `goToUpload()` del exam-builder ahora apunta a `/app/bank/new`.
- [x] **Dark mode roto en páginas IA** — `bg-white` → `bg-surface` en los 3 archivos señalados (dejé sin tocar los contenedores de vista previa de imagen/papel, que son intencionalmente blancos).
- [x] **Sin retry en errores** — dashboard, exam builder, exam review y job detail ahora tienen botón "Reintentar", mismo patrón que bank-list/exam-list/history.
- [x] **Loading ausente en historial IA y detalle de job** — skeletons agregados en ambos.
- [x] **`ui-input` sin label asociado** — `for`/`id`/`aria-describedby` agregado, mismo patrón instance-id que `ui-select`.
- [x] **Títulos de pestaña genéricos** — `title:` por ruta + `<title>GeneraExamen</title>` en `index.html`.
- [x] **Sin 404 real** — `NotFoundComponent` propio en el wildcard, ya no redirige a `/login`.
- [x] **Paginación que trunca sin avisar** — `ui-pagination` nuevo, wireado en exam-list y generation-history (ambos ya tenían `total` en su respuesta paginada). Bank-list se dejó como árbol sin paginar — decisión: es un rediseño deliberado y documentado en el propio código (`bank-list.component.ts` docstring: "no pagination needed, ~71 rows"), paginar ahí rompería la UX de árbol Curso→Tema→preguntas; confirmado con el usuario.

### API — robustez y seguridad

- [x] **Presigned URLs de MinIO (7 días) en response de crear versiones** — `POST /exams/:id/versions` ahora devuelve `/assets/:id` (mismo shape que `listVersions`), en vez del presigned url de `storage.put()`.
- [x] **Uploads sin límite de tamaño** — `MAX_IMAGE_UPLOAD_BYTES` (5MB) en `limits.fileSize` de los 4 `FileInterceptor` (bank image create/replace, tenants logo, ai extract).
- [x] **`uploadLogo` sin guard de archivo presente** — `BadRequestException` si no llega `file`, mismo patrón que `ai.controller.ts`.
- [x] **Sin `ValidationPipe` global** — agregado (`whitelist`/`forbidNonWhitelisted`/`transform`) + instaladas `class-validator`/`class-transformer`. **Limitación real**: no valida nada de los DTOs actuales — son interfaces TS planas, deliberadamente sin decoradores (compartidas verbatim con Angular), y Nest salta la validación cuando el metatype reflejado es `Object` (genérico de interfaces). Sirve de red para DTOs de clase futuros; la validación real de los DTOs existentes (email format, etc.) necesita convertirlos a clases — cambio más grande, no incluido aquí (decisión confirmada con el usuario).
- [x] **`platform_admin`/`content_editor` sin UI** — nueva pantalla `/app/admin/tenants` (`platform_admin`-only, nav "Administración → Colegios"): listar/crear/editar/activar-desactivar/eliminar colegios, mismo patrón de confirm-modal + danger button que el resto de la app. `content_editor` ya llegaba a `/app/bank` sin bloqueo (banco central) — no necesitaba pantalla propia. De paso se encontró y arregló un bug real: `ShellComponent` llamaba `TenantSettingsService.getSettings()` sin condición, que **lanza excepción síncrona** cuando `tenantId` es `null` (staff de plataforma) — el shell entero crasheaba al loguearse como `platform_admin`/`content_editor`, antes de este fix.
- [x] **`GET /tenants` y `GET /users` sin paginación** — ambos ahora devuelven `{items, total}` y aceptan `page`/`pageSize` (usa `clampPagination`, ya existente). `/tenants` alimenta la nueva pantalla admin; `/users` alimenta tenant-settings (pestaña Profesores) — ambos con `ui-pagination`.
- [x] **`isAuthenticated()` no chequea `exp`** — ahora decodifica y compara `exp * 1000 > Date.now()`, no solo "hay token".
- [x] **Generación de PDFs: fallo parcial deja versiones huérfanas** — versiones 1-2 persistían aunque el call devolviera 422 al fallar la 3; usuario veía "falló" pero había PDFs. Resuelto con la migración a job queue (ver P0). **Decisión: reportar parcial, no rollback** — el job queda `failed` con `completed_count = 2` y `failed_reason`, las formas generadas siguen descargables, y la pantalla lo dice explícito ("Se generaron 2 de 3 formas y luego la generación falló. Las formas de abajo sí están disponibles."). El bug real era que la UI mentía, no que se persistieran parciales; hacer rollback era peor porque `clearVersions()` ya borró las formas viejas al empezar, así que una regeneración fallida habría dejado el examen sin nada.

### Landing

- [x] **Sin `site` en config ni canonical** — `site` en `astro.config.mjs` (dominio placeholder `generaexamen.pe`, marcado TODO hasta tener el dominio real) + `<link rel="canonical">` en `Layout.astro`.
- [x] **Sin robots.txt ni sitemap** — `@astrojs/sitemap` instalado y en `integrations`, `public/robots.txt` agregado.
- [x] **Jerarquía de headings rota** — h1 único, secciones ahora h2, pasos "Cuatro pasos" ahora h3 bajo su h2 (antes h3→h4 sin jerarquía real). CSS actualizado en el mismo cambio.
- [x] **Imágenes crudas sin dimensiones** — `width`/`height` agregado a `bank.png` (1200×708) y `ai-review.png` (350×760), previene CLS.
- [x] **3 fonts importadas nunca usadas** — quitados `caveat/400.css`, `nunito/600.css`, `nunito/800.css` (solo `caveat/700` y `nunito/400` se usan realmente, verificado por `font-weight` en el CSS).
- [x] **Sin páginas legales** — `/privacidad` y `/terminos` agregadas + link en footer nuevo. Contenido genérico con nota TODO explícita (razón social/RUC reales pendientes — no hay dominio ni identidad legal registrada aún, confirmado con el usuario).
- [x] **Sin 404** — `src/pages/404.astro` agregado.
- [x] **`favicon.ico` es un PNG renombrado** — regenerado como ICO multi-resolución real (16/32/48) con ImageMagick desde `favicon.svg`; agregado `apple-touch-icon.png` (180×180) y `site.webmanifest` (+ iconos 192/512), enlazados en `Layout.astro`.

---

## P2 — Pulido

### Web

- [x] Favicon del app parece scaffold default de Angular — confirmado (era el escudo default de Angular). Reemplazado con el favicon.ico de GeneraExamen (mismo generado en Landing P1).
- [x] Componentes gigantes — refactor completo de los 4 archivos:
  - **bank-list / ai-review-queue**: el form de edición inline SÍ era duplicación real (mapeado línea por línea antes de tocar nada). Extraídos 3 componentes compartidos + 1 util a `features/bank/question-edit/`: `QuestionTaxonomyFieldsComponent` (Curso/Tema/Nivel/Grado), `QuestionContentFieldsComponent` (Enunciado/Alternativas/Clave), `AiReviseBoxComponent` ("Editar con IA", byte-idéntico en ambos), `parseAlternativesList()` util. Lo que NO se fusionó — imagen+OCR (solo bank-list) y figureCode (solo ai-review-queue) — se dejó fuera del componente compartido a propósito, como slots/campos locales de cada consumidor; forzarlos adentro habría sido la abstracción prematura que las reglas del proyecto piden evitar. HTML bajó de 458→411 líneas (bank-list) y 202→156 (ai-review-queue).
  - **exam-builder**: `groupRowsByCourse` (función pura) movida a su propio archivo con su propio spec. Se encontró duplicación real DENTRO del mismo archivo — la celda del grid (input de cantidad + indicador de stock + puente a IA + preview-ids) estaba copiada byte a byte entre la tabla desktop y las cards mobile — extraída a `GridCellContentComponent`, usado en ambos layouts.
  - **bank-new**: revisada la duplicación p*/s* (foto vs estructurada) — **no se fusionó a propósito**. No es duplicación limpia: el cascade de curso/tema de la pestaña "Estructurada" tiene lógica de preselección (`pendingStructuredCourseId`/`pendingStructuredTopicId`, usada por `extractWithAi()`) que la pestaña "Foto" no tiene, con un handoff de timing entre dos `effect()` que el propio código ya documenta como delicado ("ver design doc §3.1-3.2 por qué esto no se puede hacer con `.subscribe()` en carrera"). Forzar un helper compartido ahí arriesgaba romper esa lógica para un ahorro modesto (~90 líneas en un solo archivo, no duplicación cruzada). Decisión: dejarlo como está.
  - Verificado con la suite completa: **539/539 tests web**, 100% verde (incluye 5 archivos de spec nuevos para los componentes extraídos).
- [x] Patrón de tabs duplicado a mano en `bank-new` y `tenant-settings` → primitivo `ui-tabs` nuevo (`value`/`valueChange`, no `model` — ambos consumidores tienen side effects propios al cambiar de tab). `data-testid` por tab preservado, specs sin cambios de contrato.
- [x] Botones crudos fuera de `ButtonComponent` en `exam-review` (toda la página) y `generation-job-detail:2,105-112`. Migrados los 5 (`reroll`, `manual-replace`, `confirm`, `← Historial`, `go-review`). Dos notas:
  - Hizo falta agregar `size: 'md' | 'sm'` al primitivo: los botones de fila usaban `px-3 py-1.5` y forzarlos al `px-4 py-2` del DS los hacía dominar la fila a la que pertenecen. `sm` encoge solo la caja, nunca el `text-sm` (bajar el tamaño de letra rompería la misma barra de legibilidad que sostiene el resto de la app).
  - Las filas de `retry-history-item` se dejaron como `<button>` crudo **a propósito** (con comentario en el template): son filas de lista clickeables — ancho completo, con un `ui-tag` y timestamp alineado a la derecha adentro — no botones del design system; meterlas al primitivo pelearía con su contrato `inline-flex`/padding sin ganar consistencia.
  - Los `data-testid` pasaron al wrapper (misma convención que `exam-versions-panel`), así que los specs ahora consultan `[data-testid="x"] button`.
- [x] Valores fuera de escala: `rounded-[7px]`, `text-[11px]`, `text-[10px]` → `rounded-field` y `text-xs`.
- [x] Focus débil en toggles del árbol del banco — `focus:ring-2 focus:ring-primary-300` agregado a curso y tema, igual que los leaf.
- [x] `text-n500` (~3.5-4:1) en texto secundario significativo — recalculado con la fórmula WCAG real: `#666d76` (light, antes `#868d96`) y `#888f98` (dark, antes `#6b727b`/`#6b727b`). Ambos ahora ≥4.5:1 contra `surface` y `n100`/`n50`, verificado con script de luminancia relativa.
- [x] Sin `withInMemoryScrolling()` — agregado en `app.config.ts` (`scrollPositionRestoration: 'enabled'`).
- [x] Tokens con nombres mezclados: `--color-tint-activo`/`--color-tint-texto` → `--color-tint-active`/`--color-tint-text`, renombrado en las 4 declaraciones (light/dark × default/data-theme) y sus 12 usos en componentes.
- [x] `onRequestedChange` no guarda contra negativos — `Math.max(0, Number(rawValue) || 0)`.
- [x] `bank-upload`: ítem obsoleto — el componente fue eliminado por completo en Web P1 (dos UIs incompatibles), ya no aplica.

### API / infra

- [x] Sin `helmet()` ni security headers — `app.use(helmet())` en `main.ts`.
- [x] Health check stub — `HealthService` nuevo pinguea Postgres (`select 1`), Redis (`ping`) y MinIO (`listBuckets`) en paralelo, cada uno con timeout de 2s; `GET /health` devuelve 503 si algo falla (antes siempre 200, docker-compose usa el status code para reiniciar). `StoragePort.ping()` agregado a la interfaz + las 2 implementaciones.
- [x] Sin logging estructurado — `nestjs-pino` global (JSON, sin `pino-pretty` — deliberado, ver comentario en `app.module.ts`: evita worker threads en los specs e2e), correlation-id por request (`x-request-id`), `AllExceptionsFilter` global que loguea todo 5xx sin cambiar el shape de respuesta de ningún `HttpException` existente, y logging del fallo final (retries agotados) en `GenerationJobsProcessor`. Verificado con la suite **completa**: 74 suites/694 tests (non-e2e) + 21 suites/173 tests (e2e) — ver nota debajo sobre 2 regresiones reales que esto destapó y arregló.
- [ ] Cache de preview Typst y `bucketEnsured` son estado in-memory por proceso. **Diferido**: solo aplica al escalar a múltiples réplicas, no hay ese plan hoy — queda como nota, no como fix. (Nota adicional tras la migración a BullMQ: `ExamVersionJobEventsService` es un `Subject` in-process igual que `GenerationJobEventsService`, así que el SSE de progreso también asume worker y servidor HTTP en el mismo proceso. Con réplicas habría que pasar a pub/sub de Redis; hoy es un solo contenedor.)
- [x] nginx sin `proxy_read_timeout` override — `proxy_read_timeout 120s;` en `infra/nginx/web.conf`, con nota de que se revierte cuando la generación salga del request path.
- [x] Sin CORS explícito — documentado en `main.ts`: es una decisión deliberada, no un olvido — Nest tiene CORS deshabilitado por defecto y prod es same-origin vía nginx, así que no hace falta `enableCors()`. Sin cambio de comportamiento.
- [ ] Email sin validación de formato al crear usuario — ya documentado como flujo deliberado (este mismo ítem lo dice), no requiere cambio.
- [x] Dashboard: "recientes" capado a 5 sin link "ver todos" — link `Ver todos` → `/app/exams` agregado en la card de exámenes.

### Landing

- [x] Sin JSON-LD (`Organization`/`SoftwareApplication`) — agregado en `index.astro` (`@graph` con ambos tipos), mismo TODO de dominio/RUC placeholder que el resto.
- [x] Sin landmark `<main>` — todo en divs — hero/scribbles/closer ahora envueltos en `<main>`, footer legal queda fuera (semántica correcta).
- [x] Toggle de tema sin `aria-pressed` ni label dinámico — ahora sincroniza `aria-pressed`/`aria-label` en carga y en cada click; `:focus-visible` propio agregado.
- [ ] Variables CSS light/dark declaradas 3 veces — **Diferido**: los 4 bloques (`:root` default, `@media prefers-color-scheme`, `[data-theme=light]`, `[data-theme=dark]`) son todos necesarios para la cascada (default antes de JS, fallback OS, override explícito) — sin Sass/preprocessor no hay forma de deduplicarlos sin reescribir la lógica de temas, riesgo real de romper dark mode justo después de arreglar su contraste en P0. No es un fix mecánico.
- [x] `.hl` con `white-space: nowrap` — `white-space: normal` solo bajo 340px (donde de verdad clipea), el resto conserva el subrayado a tiza intacto.
- [x] Sin nav persistente ni "volver arriba" tras el hero — nav flotante (Confianza · Cómo funciona · WhatsApp · ↑) que aparece recién cuando el hero sale de vista. Detalles:
  - Va **fuera** de `.board-frame`: `.board` tiene `overflow: hidden` (sus capas de grano/smudge dependen de eso), así que un topbar `sticky` adentro se clipearía en vez de seguir el scroll. Es `position: fixed` en el `.stage`.
  - Se revela con `IntersectionObserver` sobre el hero (no un listener de scroll: cuesta cero por frame). Mientras está oculto lleva `inert`, no solo `opacity: 0` — un fade-out solo dejaría 4 paradas de foco invisibles delante del contenido.
  - Bajo 560px se ocultan los links de sección y queda solo "volver arriba", con padding subido a ~44px de target de pulgar (el tamaño de escritorio pasa el piso de 24px de WCAG 2.2 pero es chico para una mano).
  - Respeta `prefers-reduced-motion` (aparece sin desplazarse, y el scroll al tope pasa a `auto`).
  - Verificado con Playwright en 1200px y 390px, tema claro y oscuro: oculto+inert arriba, visible+focusable tras el hero, "↑" lleva a scrollY 0, los anchors caen con el `scroll-margin-top`, sin scroll horizontal ni errores de consola.
- [ ] Sin links sociales pese a target institucional — **Diferido**: no hay cuentas sociales reales que enlazar todavía.
- [x] `ai-review.png` pesada para su resolución — recomprimida con cuantización a 256 colores (88KB → 22KB, sin banding visible, verificado).
- [x] `package.json` sin scope ni `"private": true` — ahora `@exams-generator/landing` + `"private": true`.
- [x] Artefacto JSX `{" "}` en el headline — quitado (el espacio se preserva igual por colapso normal de whitespace HTML).
- [x] `meta generator` expone versión de Astro — quitado de `Layout.astro`.
- [ ] Sin analytics/conversión — **Pendiente de decisión** (agregar analytics implica elegir herramienta + flujo de consent, no es un fix mecánico).
- [x] `README.md` es el starter de Astro sin editar — reescrito con estructura real, comandos, y notas de los TODOs pendientes (dominio, RUC).

---

## Sugerencia de orden de ataque

1. **Landing P0** (1-2 h): quitar nota interna, contactos reales, OG tags, contraste. Es lo primero que ve un cliente.
2. **Web P0** (medio día): estados muertos, typo, confirmación de borrado, página 403.
3. **API P0** (1 día): throttler, timeouts (Typst/OpenRouter), tope de versionCount.
4. **P1 web forms + confirmaciones** (1 día): patrón único de validación visible + modal de confirmación + variante danger.
5. **P1 API** (1-2 días): límites de upload, ValidationPipe, paginación real, migrar PDF a BullMQ.
6. P2 en oleadas según tiempo.
