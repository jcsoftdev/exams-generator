# Auditoría integral — /brain-audit (30 módulos) + flujos en vivo con Playwright

> Generada 2026-08-20. Índice project-brain sano (732 chunks, 1712 símbolos). App corriendo en
> vivo: web `localhost:4201`, API `localhost:3012` (`/health` ok: db/redis/storage). Sesión real
> con Playwright MCP: login `admin@colegio-demo.test`, banco, generador de exámenes, formas,
> IA, configuración, viewport móvil 390×844.
>
> **No repite** hallazgos ya cerrados en `audit-todo.md` (2026-07-24), `audit-2026-08-14.md`,
> `audit-frontend-exams-2026-08-15.md`, `audit-security-2026-08-18.md`,
> `audit-teacher-role-2026-08-18.md` ni `audit-2026-08-18-zonas-no-auditadas.md`.
>
> Prioridades: **Critical / High / Medium / Low / Info**. Cada hallazgo lleva evidencia
> (`file:line` o reproducción en vivo). Confianza indicada donde no es ~100%.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## 1. Resumen ejecutivo

Codebase en estado notablemente sano: los P0 de auditorías previas están cerrados y dejaron
infraestructura real (worker BullMQ para PDFs, watchdogs SSE, sniffing de MIME por magic
bytes, refusal de arranque con JWT débil, logging estructurado con correlation id, CI con
Postgres real). Los flujos principales funcionan de punta a punta en vivo.

Lo que esta pasada encontró es de otra categoría: **calidad de datos del banco cosechado**
(basura de harvest impresa en alternativas), **fugas de datos de test a la UI de producción**
(cursos "Test Course …" chequeados por defecto en el generador), **revocación de sesión
inexistente** frente a la función "Desactivar profesor", y **defaults inseguros en el compose
de producción** (contraseñas de fallback + Redis sin auth en red Docker compartida).

- Módulos corridos: 30 (todos los sugeridos). No aplicables: Mobile, i18n, Packaging/Versioning.
- Hallazgos: 0 Critical · 6 High · 12 Medium · 8 Low/Info.

## 2. Descubrimiento y arquitectura

- Monorepo pnpm + Turborepo, Node ≥ 22.13. `apps/api` (NestJS + Express, hexagonal),
  `apps/web` (Angular 22, signals), `apps/landing` (Astro), `packages/shared` (DTOs auth + 2 enums).
- Datos: Postgres 17 + drizzle (20 migraciones), Redis + BullMQ (`generation`, `exam-versions`),
  MinIO (assets), Typst CLI 0.15.1 (PDF), OpenRouter (LLM texto + visión, adapter
  OpenAI-chat-completions provider-neutral).
- Auth: JWT Bearer 8h, bcryptjs, throttle 5/min en login, CORS regex `*.creaexamen.com`,
  helmet, body limit 5mb.
- Ops: docker-compose local + Dokploy prod, GitHub Actions (3 jobs; e2e manual), pino + x-request-id.

### Mapa de features (verificado en vivo)

login → dashboard (contadores + últimos exámenes) → banco (65 354 preguntas, árbol
curso→tema→pregunta, detalle, crear imagen/estructurada) → generador (`/app/exams/new`:
plantilla por universidad/ciclo, temario semanal acumulativo, grid stock por celda) →
revisión → formas (worker BullMQ, SSE, PDFs + claves, ZIP) → IA (generar/revisar/extraer,
cola de revisión, historial) → configuración (datos, logo, profesores) → admin tenants.

## 3. Módulos corridos

Todos los sugeridos: Functional, Product, Goal, Future, Reachability, Flow Integrity,
Complexity, Consistency, Documentation, Prompt/Spec Gap, Backend, API, Frontend,
Accessibility, Database, AI, Performance, Scalability, Concurrency, Failure, Security, Abuse,
Privacy, DevOps, Infrastructure, Observability, Dependencies & Licensing, Cost, Testing,
Contract Drift.

Saltados con razón: **Mobile** (sin manifest nativo), **i18n** (sin locales — UI en español
hardcodeado, deliberado), **Packaging/Versioning** (todos los packages `private: true`, sin
release workflow).

---

## 4. Hallazgos por severidad

### High

- [x] **H1 — Datos de test contaminan la UI de producción del generador.** Reproducido en vivo:
      `/app/exams/new` lista "Test Course 81b7883e-…" y dos "ExamsRepo Course …" — y los dos
      últimos vienen **chequeados por defecto** ("25 de 26 elegidos"), o sea entran al examen
      de un docente real que no los deschequee. Origen: specs e2e siembran taxonomía global y
      `purge-test-taxonomy.ts:151` conserva deliberadamente cursos "con uso real" — un examen
      de test los ancla para siempre. Testing (aislamiento) + Product.
      **Fix**: marcar taxonomía de test con prefijo/flag y filtrarla de todo listado de
      producto, o purga que también borre exámenes de test que la anclan.
      **HECHO (2026-08-21)**: guard de lectura en `TaxonomyRepository` —
      `findAllCourses`/`findTopics`/`findTopicsByCourseIds` excluyen cualquier curso o tema
      cuyo nombre lleve la firma de fábrica de tests (`TEST_TAXONOMY_NAME_PATTERN`,
      `apps/api/src/db/test-taxonomy-name.ts`, con spec propia). Decisiones:
      - **Filtro por nombre, no columna `is_test`**: una columna solo protege lo que un fixture
        futuro se acuerde de marcar, y además necesitaría un backfill que usaría… este mismo
        regex. El patrón atrapa hoy mismo la basura ya sembrada, sin migración.
      - **Es guard de lectura, no reemplazo de la purga**: `purge-test-taxonomy.ts` ahora
        importa la misma constante en vez de duplicarla. La purga sigue siendo la que borra;
        esto es lo que impide que la basura se vea mientras tanto. Importa porque los 4 cursos
        de test que quedan en la DB local (`Test Course 81b7883e-…`, los dos
        `ExamsRepo Course …` que el audit vio en vivo) están anclados por exámenes de test y la
        purga los conserva a propósito — ahora son invisibles igual.
      - **También filtra por el nombre del tema**, no solo el del curso: un spec que cuelgue su
        tema de un curso real se colaría si no.
      - Los fixtures de `taxonomy.repository.spec.ts` / `taxonomy.e2e.spec.ts` que deben ser
        VISIBLES pasaron a un sufijo sin guiones (siguen únicos, siguen borrados por id), y cada
        archivo ganó un fixture nombrado como fábrica de tests que verifica la exclusión.
      - Cero preguntas cuelgan de esos cursos, así que el árbol del banco no estaba afectado
        (verificado en la DB local). El "25 de 26 elegidos" del reporte era el botón "Todos":
        no hay preselección automática en el builder — con el filtro esos cursos ya ni aparecen
        para poder marcarse.
      Verificado: 935 tests non-e2e + 273 e2e, 100% verde.

- [ ] **H2 — Basura de harvest impresa en alternativas del banco central.** Reproducido en vivo
      (Geometría → Triángulos): alternativa `e) 15 2da. Prueba Examen de Admisión 2020-1` — el
      pie de página de la fuente quedó pegado al valor. Eso se imprime tal cual en el examen
      del alumno. Escala no determinada (una pasada visual halló 1 de ~50 visibles; el banco
      tiene 65 354). Functional/Data quality. Confianza 95% en la instancia, escala por medir.
      **Fix**: sweep SQL por patrones (`Prueba|Examen de Admisión|20\d\d-[12]` al final de
      alternatives) + regla de limpieza en el pipeline de harvest + spec de lint de contenido.

- [ ] **H3 — "Desactivar profesor" no revoca la sesión: el JWT sigue válido hasta 8h.**
      `jwt-auth.guard.ts:45-52` solo verifica firma; `TOKEN_TTL = "8h"`
      (`token.service.ts:33`); no hay blacklist ni check de `users.active` por request (solo
      en login). Un profesor desactivado sigue operando el resto del día. La UI vende
      desactivación inmediata. Security/AuthN.
      **Fix barato**: check de `active` (+ existencia) en el guard con cache corto (p. ej.
      Redis 60s), o TTL corto + refresh.

- [~] **H4 — Compose de producción con fallbacks de credenciales públicas y Redis sin auth en
      red compartida.** `docker-compose.dokploy.yml:21-22,37-38,80-81`:
      `${DB_PASSWORD:-exams}`, `${MINIO_ROOT_PASSWORD:-minioadmin}` — si la var no está seteada
      en Dokploy, prod arranca con credenciales publicadas en este repo. `exams-redis` corre
      sin `requirepass`. El header del propio archivo documenta que la resolución DNS cruzó
      proyectos en la `dokploy-network` compartida — es decir, otros proyectos del host
      alcanzan estos servicios por red. Infrastructure.
      **Fix**: `:?must be set` (como ya hace JWT_SECRET) para DB/MinIO; `requirepass` en Redis;
      red interna propia para infra, solo api/web en la red compartida.
      **HECHO (2026-08-20, parcial)**: `DB_PASSWORD`/`MINIO_ROOT_PASSWORD`/`REDIS_PASSWORD`
      ahora `:?must be set` en `docker-compose.dokploy.yml`; `exams-redis` con `--requirepass`
      y healthcheck autenticado; `resolveRedisConnection()` (`common/queue.env.ts`) soporta
      `REDIS_PASSWORD` — omite la key cuando está vacía, dev local sigue sin auth — con spec
      nueva (`queue.env.spec.ts`); parity guard verde (el parser de
      `parse-compose-api-environment.ts` ahora tolera comentarios en el bloque `environment`,
      con spec). **Pendiente**: red interna propia para infra. **Deploy nota**: setear
      `REDIS_PASSWORD` (y passwords reales de DB/MinIO) en Dokploy ANTES del próximo deploy —
      el compose ahora se niega a arrancar sin ellos.

- [~] **H5 — Imágenes Docker corren como root y el build puede des-congelar el lockfile en
      silencio.** Ningún `USER` en `Dockerfile.api`/`Dockerfile.web`/(`Dockerfile.landing`);
      no existe `.dockerignore` (context `..` + `COPY . .` arrastra `.git`, `node_modules`
      locales y un `.env` raíz si existe, a la build stage);
      `pnpm install --frozen-lockfile … || pnpm install` (`Dockerfile.api:28`,
      `Dockerfile.web:14`) convierte un lockfile desincronizado en un build "verde" no
      reproducible. DevOps.
      **Fix**: `USER node`, `.dockerignore` raíz, quitar el `|| pnpm install`.
      **HECHO (2026-08-20, parcial)**: `.dockerignore` raíz creado; `USER node` en el runtime
      de `Dockerfile.api`; `|| pnpm install` eliminado de los tres Dockerfiles. **Pendiente**:
      los runtimes nginx de web/landing siguen como root (cambiarlos implica
      `nginx-unprivileged` + puerto ≠ 80 — cambio aparte, no quick win).

- [ ] **H6 — Llamadas LLM sin techo de gasto: sin `max_tokens`, input sin truncar, sin
      circuit-breaker.** `openrouter-request-builder.ts` no manda `max_tokens` (factura lo que
      el modelo decida); la `instruction` de revise llega sin límite de longitud
      (`revise-question.service.ts:55-57` solo exige no-blank; el único tope es el body de
      5mb); no hay quota por tenant ni alerta de consumo. Hoy el default es free-tier
      (mitigante real), pero `AI_BASE_URL` ya soporta providers pagados (DeepSeek documentado
      en `infra/env.example`). Cost + AI. Severidad condicionada: High al mover a modelo pagado.
      **Fix**: `max_tokens` explícito, cap de longitud en instruction (p. ej. 2 000 chars),
      contador de uso por tenant (ya existe `generation_jobs` para colgarlo).

### Medium

- [x] **M1 — La clave se muestra como índice crudo al docente.** **HECHO (2026-08-20)**:
      `question-display.util.ts` (`correctAnswerLabel`) convierte índice numérico a letra en
      lista y detalle del banco; letras de imagen pasan intactas; spec propia. En vivo: preguntas
      estructuradas muestran "Clave: 0…4" (índice 0-based de storage) y las de imagen "Clave:
      d" (letra). "Clave: 0" parece un bug para cualquier profesor. La conversión
      índice↔letra existe (`correct-answer-index-to-letter.ts`) — la lista/detalle del banco
      no la usa. Consistency/Functional.

- [ ] **M2 — Cursos duplicados sin desambiguar en el árbol del banco.** En vivo: "Comunicación"
      ×3 (99/1514/26), "Arte y Cultura" ×2, "Educación Física" ×2, "Matemática" ×2, etc. Son
      scopes de nivel distintos pero la UI no muestra el nivel — imposible saber cuál abrir
      con filtro "Todos". Product.

- [ ] **M3 — Móvil 390px: tarjetas de examen ilegibles.** Screenshot: título truncado a "Co…"
      (2 chars + ellipsis) y la meta ("4° secundaria · 8 preguntas · 0 formas") envuelta en
      columna de una palabra. Todas las tarjetas se ven iguales. Frontend/Responsive.

- [ ] **M4 — Contrato API↔web duplicado a mano sin guard.** `packages/shared` solo cubre auth
      (5 DTOs + 2 enums); las 10 features de web re-declaran cada shape de respuesta en
      `*.models.ts` (p. ej. `ExamVersionJob` en `exam-versions.models.ts:28` vs
      `ExamVersionJobRecord` en `exam-version-jobs.repository.ts:21`). Sin OpenAPI, sin test
      de equivalencia, sin check de CI — el drift solo aparece en runtime. Contract Drift.

- [ ] **M5 — Estado in-process bloquea una segunda instancia del API.**
      `ExamVersionJobEventsService` / `GenerationJobEventsService` son Subjects in-memory (el
      SSE solo notifica en la instancia que procesó) y el ThrottlerModule usa storage
      in-memory (límites por instancia). Asunción single-container documentada — pero no hay
      guard ni doc de despliegue que lo imponga. Scalability.

- [ ] **M6 — Observabilidad = solo logs.** Sin métricas (rate/error/duración/saturación), sin
      queue-depth de BullMQ, sin alerting — un worker muerto o una cola creciendo solo se nota
      cuando un usuario reclama. Lo bueno: pino estructurado, x-request-id, healthcheck con
      deps reales, `autoLogging.ignore` para /health. Observability.

- [ ] **M7 — El PR gate excluye la capa más frágil (e2e) y nunca se verificó en runners.**
      `ci.yml` corre non-e2e + db-serial; `api-e2e-manual` solo `workflow_dispatch` y su propio
      header dice "unverified". Exclusión honesta y documentada — pero el riesgo real (BullMQ
      races) queda sin gate. Testing/DevOps.

- [x] **M8** *(HECHO 2026-08-20: nota `template-distribution-note` en el builder cuando el
      reparto difiere del total pedido; 3 specs nuevas en exam-builder.component.spec.ts)* —
      **Pedí 30 preguntas, la plantilla repartió 29, la UI no lo decía.** En vivo: spinner
      "Cantidad total = 30" → "29 preguntas pedidas en 29 celdas", sin mensaje del porqué
      (resto de la división entre cursos). El docente cree que pidió 30. Functional.

- [ ] **M9 — Rate limit de IA solo por IP global (100/min), nada por cuenta.** Los endpoints
      caros (`/ai/questions/generate`, `/ai/extract`) comparten el default; un colegio entero
      detrás de un NAT comparte la misma cubeta y un solo usuario puede agotarla (o
      inflar el gasto LLM si H6 no se ataca). Abuse.

- [ ] **M10 — Privacidad: sin export ni retención de datos personales.** `users.email/name`
      sin política de retención; "Desactivar" conserva el registro para siempre; no hay
      export de datos del usuario (Ley 29733 pide acceso/cancelación). Mitigantes: hard-delete
      de tenant completo ya existe (commit 237e14f), logs redactan `authorization`, fixtures
      usan dominios `.test`. Privacy.

- [x] **M11** *(HECHO 2026-08-20: pineado a `RELEASE.2025-09-07T16-13-09Z` — la versión exacta
      que `latest` resolvía localmente, probada contra el volumen de datos existente —
      overrideable vía `MINIO_VERSION`; checksum de typst sigue pendiente)* —
      **`minio/minio:latest` flotante en ambos composes.** Un `pull` cualquiera puede
      cambiar la versión de MinIO bajo los pies de prod. Postgres/Redis sí están pineados.
      DevOps. (Bonus: typst se descarga de GitHub sin verificación de checksum,
      `Dockerfile.api:9-13`.)

- [ ] **M12 — Taxonomía con clasificación ruidosa.** En vivo bajo Geometría→Triángulos:
      identidades trigonométricas ("senA+4senB…", "CtgB+CtgC") y un problema de cono
      (variación porcentual de volumen). El blueprint por tema selecciona esto como
      "Triángulos". Escala no determinada. Data quality.

### Low / Info

- [x] **L1** *(HECHO 2026-08-20: Logger pino `@Optional` inyectado, error estructurado con
      examId/questionId/err; spec nueva del camino de fallo de recovery)* —
      `console.error` en `exam-generation.service.ts:229` en vez del Logger pino:
      ese error de swap queda fuera del stream estructurado (sin reqId/jobId queryables).
- [~] **L2** — Higiene git: 60 archivos de datos de lotes (`apps/api/src/db/data/lot-*`)
      llevan días untracked — un `git clean` o un disco muerto los pierde. (Los `.pyc` que el
      snapshot inicial mostraba como trackeados ya no están en HEAD — `tools/harvest/.gitignore`
      los cubre; se agregó regla `__pycache__/` también al `.gitignore` raíz, 2026-08-20.)
      Falta decidir: commitear los lotes o respaldarlos.
- [x] **L3** *(HECHO 2026-08-20: `gradeLevelLabel` en `question-display.util.ts`, aplicado al
      detalle del banco)* — Detalle de pregunta mostraba "Grado: pre" (código crudo) en vez de
      la etiqueta.
- [ ] **L4** — Sin formatter configurado (no prettier/biome); solo ESLint. La consistencia de
      estilo hoy es disciplina manual.
- [ ] **L5** — `packages/shared` `"test": "echo …"` no-op, pero el matrix de CI lo corre como
      si fuera una suite — verde decorativo.
- [ ] **L6** — `bypassSecurityTrustResourceUrl(url + PREVIEW_FRAGMENT)` duplicado en
      `ai-review-queue.component.ts:627` y `generation-job-detail.component.ts:322` — misma
      regla en dos sitios (son blob URLs propios, no hay riesgo XSS; es dedup).
- [ ] **L7** — Nombres "Copia de Copia de Copia de Copia de …" — el duplicado no incrementa
      (`(2)`, `(3)`) y el dashboard se llena de títulos idénticos.
- [ ] **Info** — Sin LICENSE en el repo (todo `private: true` — decisión válida; los datos
      cosechados sí tienen política en `docs/question-collection-pipeline.md`).

---

## 5. Wiring & Reachability

- Env vars: todas las `process.env.*` leídas por el API están declaradas en
  `infra/env.example` (verificado por diff leído-vs-declarado). El compose de prod **no**
  forwardea `AI_BASE_URL`/`AI_API_KEY`/`MINIO_BUCKET` (los defaults salvan; cambiar de
  provider en prod requiere editar compose — menor).
- Endpoints ↔ clientes: los flujos vivos ejercitaron bank/exams/versions/ai/settings sin 404;
  los e2e cubren assets y tenancy. No se hizo sweep exhaustivo de dead exports (ver Coverage Gaps).
- Half-wired: no se encontró cola sin consumer ni evento sin listener; ambas colas BullMQ
  tienen processor y producer verificados.

## 6. Coverage gaps de esta auditoría

- Dead-export sweep símbolo-por-símbolo: no corrido (65k+ LOC); muestreo únicamente.
- Escala real de H2/M12 (basura y misclasificación en 65 354 preguntas): requiere sweep SQL,
  no lectura visual.
- `api-e2e-manual` en GitHub runners: sin evidencia de ejecución.
- Contraste de colores (4.5:1) no computado par-por-par; sin hallazgos visuales flagrantes.

## 7. Fortalezas confirmadas (prompt/spec gap — lo que el equipo cubre solo)

Dimensiones que ninguna spec pidió y el código igual resolvió: sniffing de MIME por magic
bytes (`image-mime.ts`), refusal de boot con JWT débil (`auth/env.ts`), watchdogs SSE
derivados de los techos del servidor (no números mágicos), quarantine+swap de preguntas
incompilables con bound (`MAX_BROKEN_QUESTION_SWAPS`), retries BullMQ con distinción
content-fault vs blip, healthcheck con deps reales, correlation id, throttle específico de
login, clamps de paginación, idempotencia de seeds, CI que documenta sus propias
limitaciones. **La dimensión que más probablemente falte en el próximo request: calidad de
datos del contenido cosechado** — el pipeline técnico está; el QA de contenido no.

## 8. Recomendaciones

**Quick wins (≤1 día c/u)**: H4 (`:?` + requirepass), H5 (.dockerignore + USER node + quitar
`|| pnpm install`), M1 (letra en vez de índice), M11 (pin de MinIO), L1, L2, L3, M8 (mensaje
"repartimos 29 de 30").

**Mediano plazo**: H1 (aislamiento de taxonomía de test), H3 (check de `active` con cache),
H6+M9 (caps de tokens + límites por cuenta), M2 (etiqueta de nivel en el árbol), M3 (layout
móvil de tarjetas), M4 (mover shapes a `packages/shared` feature por feature, empezando por
exams/versions).

**Largo plazo**: sweep + lint de contenido del banco (H2/M12) integrado al pipeline de
harvest; métricas + alerting (M6); estabilizar y promover el e2e job al PR gate (M7);
política de retención/export de datos personales (M10).
