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

- [x] **H2 — Basura de harvest impresa en alternativas del banco central.** Reproducido en vivo
      (Geometría → Triángulos): alternativa `e) 15 2da. Prueba Examen de Admisión 2020-1` — el
      pie de página de la fuente quedó pegado al valor. Eso se imprime tal cual en el examen
      del alumno. Escala no determinada (una pasada visual halló 1 de ~50 visibles; el banco
      tiene 65 354). Functional/Data quality. Confianza 95% en la instancia, escala por medir.
      **Fix**: sweep SQL por patrones (`Prueba|Examen de Admisión|20\d\d-[12]` al final de
      alternatives) + regla de limpieza en el pipeline de harvest + spec de lint de contenido.
      **HECHO (2026-08-21)**. Escala medida antes de tocar nada: **120 preguntas de 65 387**
      (0,18%) con basura en alternativas. Y lo grave no era el pie de página sino lo que la
      medición destapó: la forma más común es la ÚLTIMA alternativa terminando en
      `Rpta.: "C"` — la clave impresa en el examen del alumno. Origen: scrapes de blogspot
      (`banco-preguntas`, `razonamiento-verbal1`, `matematicasn`), no los lotes PDF, salvo 4
      filas UNI 2020-1 que sí traían el pie del cuadernillo.
      - `strip-solution-tail.ts` (dominio, spec propia): corta desde el primer ancla —
        `Rpta`, `Clave:`, `CLAVES-RESPUESTAS`, `Key :`, `Solucionario`, `SOLUCIÓN:`,
        `Resolución <1-2 dígitos>`, `Respuesta <A-E>`, "Ver respuesta correcta", "Lee la
        explicación breve", y el pie `2da. Prueba`. Cada ancla exige más que la palabra suelta
        porque las palabras sueltas son español normal: "una tecla de clave numérica" y
        "Resolución 1080" (documento, no paso de solucionario) sobreviven, verificado con
        casos reales de la DB. Si el corte dejaría vacío, devuelve el original: una opción en
        blanco en un examen impreso es peor que una cola visible.
      - **Dos caminos de ingesta**, para que no vuelva: `prepareCollectedContent` (scrapes) y
        `planLotSeed` (lotes cosechados). En ambos el strip corre DESPUÉS del hash — el
        `body_hash` es la única llave de dedup del seeder y repinnarla haría que el próximo
        boot reinsertara el banco entero.
      - **Un paso en sitio** (`strip-seeded-solution-tails.ts`, corre en el boot junto a los
        otros backfills): ninguna de las dos ingestas reescribe lo ya guardado — el corpus
        collected sí se re-deriva, los lotes NO (dedupean por hash con figura y nunca se
        reescriben) y un par de filas son anteriores a ambos caminos. Trabaja sobre el valor
        almacenado, así que alcanza los tres, y es idempotente por construcción (su salida ya
        no contiene ancla). Alcance `tenant_id IS NULL`: si un profesor escribió "Rpta." en su
        propia pregunta, no es nuestro para reescribir.
      - `escape-collected-typst.ts` pasó a llamarse `normalize-collected-content.ts`: ya no
        solo escapa Typst, y el nombre mentía.
      - Resultado en la DB local: **120 → 3**, y las 3 son falsos positivos del barrido, no
        basura: "Nadie sabe cómo aprobó el examen de admisión 2026-I" (contenido real),
        "Aplicación de la Resolución 1080" (documento real) y una etiqueta de procedencia
        `(CEPRE SAN MARCOS 2017-I)` pegada al final de una alternativa — una sola fila,
        cosmética, no se le construyó regla propia por no arriesgar recortes en preguntas que
        hablen de universidades.
      **Hallazgo nuevo al medir, NO incluido en este fix**: 73 enunciados (`body_typst`)
      cargan su propia solución. Hay tres formas distintas y ninguna se arregla cortando la
      cola: bloques `Texto: A) … E) … SOLUCIÓN: …` con las alternativas dentro del enunciado,
      la palabra "Solucionario" inyectada A MITAD de frase ("en sus Solucionario cerebros"), y
      colas de solucionario tras el enunciado. Ver ítem H8 abajo.

- [x] **H3 — "Desactivar profesor" no revoca la sesión: el JWT sigue válido hasta 8h.**
      `jwt-auth.guard.ts:45-52` solo verifica firma; `TOKEN_TTL = "8h"`
      (`token.service.ts:33`); no hay blacklist ni check de `users.active` por request (solo
      en login). Un profesor desactivado sigue operando el resto del día. La UI vende
      desactivación inmediata. Security/AuthN.
      **Fix barato**: check de `active` (+ existencia) en el guard con cache corto (p. ej.
      Redis 60s), o TTL corto + refresh.
      **HECHO (2026-08-21)**: `AccountStatusService` (auth) + `JwtAuthGuard` ahora async. Una
      firma válida ya no alcanza: el guard pregunta por la cuenta detrás del token en cada
      request, y devuelve 401 si está desactivada **o si la fila ya no existe** (las dos
      responden igual a propósito — quien tenga el token de una cuenta borrada no aprende
      cuál de las dos era).
      - **Cache en memoria, no Redis** (el audit sugería Redis 60s). El espacio de claves se
        limita a ids que vienen dentro de tokens con firma válida, así que no se puede inundar;
        con varias instancias cada una guarda su propia respuesta, a lo sumo 60s vieja — la
        misma garantía, no una peor. Y una caída de Redis no se lleva puesta la autenticación.
        Costo: ~1 lectura por usuario por minuto, no una por request.
      - **`ACCOUNT_STATUS_TTL_MS = 60s` ES la ventana de revocación**, y `TOKEN_TTL` dejó de
        serlo: su docstring decía "no hay revocación de tokens" y ya no es cierto. Lo que las
        8h siguen acotando es un token ROBADO de una cuenta que sigue activa — eso nada lo
        re-chequea.
      - **`setActive` invalida la entrada**, así que la desactivación pega al instante en esa
        instancia: esperar el TTL sería correcto pero un admin que acaba de tocar "Desactivar"
        lo lee como que el botón no hizo nada.
      - `taxonomy.e2e.spec.ts` firmaba un token para un `sub` inventado; ahora crea un usuario
        real. Era el único spec del repo que lo hacía — los demás ya usaban ids reales.
      - Tests nuevos: spec propia del servicio (activo / inexistente / desactivado tras vencer
        el cache / invalidación), caso del guard, y dos e2e — desactivar revoca el token que el
        profesor ya tenía en la mano, y un token de un usuario borrado da 401.
      Verificado: **956 non-e2e + 275 e2e, 100% verde**.
      **Nota de entorno**: a mitad de la sesión 13 suites e2e y `minio-storage.adapter.spec`
      empezaron a fallar con `S3Error: Storage backend has reached its minimum free drive
      threshold`, reproducible con el árbol limpio. No era del código: el disco de la VM de
      Docker estaba al 100% (60G de 63G) y `infra_minio_data` solo pesa 227 MB — los que
      ocupaban eran ajenos al proyecto (`voto-informado-ai_ollama_data` 20.48 GB sin
      contenedor, imágenes y build cache). `docker builder prune` liberó 5.06 GB y todo volvió
      a verde, sin tocar ningún volumen.

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

- [x] **H6 — Llamadas LLM sin techo de gasto: sin `max_tokens`, input sin truncar, sin
      circuit-breaker.** `openrouter-request-builder.ts` no manda `max_tokens` (factura lo que
      el modelo decida); la `instruction` de revise llega sin límite de longitud
      (`revise-question.service.ts:55-57` solo exige no-blank; el único tope es el body de
      5mb); no hay quota por tenant ni alerta de consumo. Hoy el default es free-tier
      (mitigante real), pero `AI_BASE_URL` ya soporta providers pagados (DeepSeek documentado
      en `infra/env.example`). Cost + AI. Severidad condicionada: High al mover a modelo pagado.
      **Fix**: `max_tokens` explícito, cap de longitud en instruction (p. ej. 2 000 chars),
      contador de uso por tenant (ya existe `generation_jobs` para colgarlo).
      **HECHO (2026-08-21)**:
      - `MAX_COMPLETION_TOKENS = 3000` en los tres bodies (generate / revise / extract). Está
        deliberadamente POR ENCIMA de lo que necesita una respuesta buena, no al ras: la
        respuesta es una pregunta + 5 alternativas + una figura CeTZ opcional, bastante por
        debajo de mil tokens. Un tope apretado cortaría el JSON a mitad de objeto, fallaría la
        validación de schema y compraría un reintento — cambiar un bug de costo por uno de
        correctitud. Es un muro contra la fuga, no un ajuste de presupuesto.
      - `MAX_INSTRUCTION_CHARS = 2000` en `ReviseQuestionService`, validado ANTES de leer la
        pregunta o llamar al modelo. El único tope que había era el body de 5mb, y esa cadena
        se pega tal cual en el prompt.
      - **El contador por tenant NO se hizo, y hay una razón**: el freno que faltaba ya existe
        desde el audit del 2026-08-18 — `MAX_ACTIVE_JOBS_PER_TENANT = 20` corta el total de
        jobs en vuelo por colegio, que es lo que permitía encolar miles. Un contador de consumo
        es reporte (cuánto gastó cada colegio), no control, y pide esquema y pantalla propios.
        Queda como ítem de producto aparte, no como agujero de gasto.
      Verificado: 986 non-e2e + 276 e2e.

- [x] **H8 — 73 enunciados del banco central cargan su propia solución.** Encontrado al medir
      H2 (2026-08-21): `body_typst` de 73 preguntas contiene el solucionario de la fuente. Tres
      formas, ninguna arreglable con el corte de cola de H2:
      - Bloques completos: `GUERRA / Texto: A) palabra B) frase … SOLUCIÓN: Se denomina texto
        al enunciado…` — las alternativas Y la explicación viven dentro del enunciado, así que
        el alumno lee la respuesta en el propio texto de la pregunta.
      - Palabra inyectada a mitad de frase: "…casi nunca llegan a morir de un ataque al
        corazón, pero en sus **Solucionario** cerebros queda el rechazo…". Un corte por ancla
        truncaría la pregunta a la mitad.
      - Cola de solucionario después de un enunciado por lo demás sano.
      Cortar a ciegas destruye enunciados buenos, y el barrido por regex tiene falsos positivos
      reales en este campo ("Resolución 217 – A" de la Asamblea General). Necesita clasificar
      las tres formas por separado y decidir por forma: recortar, re-extraer del scrape, o
      archivar. Data quality. Confianza 100% en la existencia, 73 filas exactas medidas.
      **HECHO (2026-08-21)**. Al clasificarlas apareció lo que el conteo escondía: **67 de
      las 76** son la MISMA falla, y no es una cola de solucionario sino el bloque del
      ejercicio ANTERIOR sangrando al siguiente. El scrape de una página de términos excluidos
      dejó enunciados así:
      `FÚTBOL / Texto: / A) palabra B) frase C) inferencia D) oración E) párrafo / SOLUCIÓN: … Rpta. C`
      — mientras las alternativas REALES de esa pregunta (arquero, zaguero, delantero,
      futbolista, portero) estaban intactas en su columna. O sea la pregunta estaba bien; solo
      había que cortar lo ajeno. Ahora el enunciado es "FÚTBOL" y la pregunta funciona.
      `stripStatementPollution` (dominio, spec propia) hace tres cosas distintas porque son
      tres fallas distintas, y ninguna es la de H2 — por eso NO se reusó `stripSolutionTail`:
      - **Bloque ajeno**: corta desde `Texto:` solo cuando lo sigue el bloque `A) palabra`. Un
        texto de comprensión lectora que empiece con "Texto:" sobrevive.
      - **Palabra inyectada a mitad de frase** ("en sus **Solucionario** cerebros", "haustorios
        **Solucionario** , raíces"): se borra la palabra, no se corta la frase. Se reconoce por
        el contexto en minúscula a ambos lados.
      - **Cola al final**: solo se recorta un marcador que esté al FINAL. A mitad de frase
        cortar truncaría la pregunta, que es exactamente el caso anterior.
      Va en `prepareCollectedContent`, no en un script suelto: el backfill del boot re-deriva
      el corpus collected desde los JSON, así que una limpieza en sitio se desharía sola en el
      siguiente arranque. Hash sobre el enunciado CRUDO, como el escapado.
      Resultado: **76 → 6**, y de esas 6, **3 son falsos positivos del barrido** que las reglas
      dejaron en paz con razón ("la Resolución 217 – A de la Asamblea General", "el pacto
      colectivo 2014 y la resolución 477", "COHIPÓNIMOS … Método de resolución").
      **Las 3 restantes quedan abiertas, y no por pereza**: no tienen enunciado que rescatar.
      Una es literalmente `RESOLUCIÓN : INDECISIÓN` y las otras dos son analogías cuyo par base
      se perdió en el scrape (`… el par base escrito en mayúscula. RESOLUCIÓN : NORMA::`).
      Recortar deja la pregunta vacía y adivinar el par base sería inventar contenido; el
      camino real es re-extraerlas de la fuente. Ver ítem H9.

- [ ] **H9 — 3 preguntas sin enunciado recuperable.** Separadas de H8 (2026-08-21) porque no
      se arreglan cortando: el scrape nunca capturó el enunciado. Una es
      `RESOLUCIÓN : INDECISIÓN` a secas; las otras dos son analogías cuyo par base se truncó
      (`Seleccione la opción que mantiene una relación concordante con el par base escrito en
      mayúscula. RESOLUCIÓN : NORMA::`). Las tres son inrespondibles hoy. Adivinar el par base
      sería inventar contenido, así que la salida es re-extraerlas de su `source_url` o
      archivarlas — decisión de producto, no mecánica. Data quality.

### Medium

- [x] **M1 — La clave se muestra como índice crudo al docente.** **HECHO (2026-08-20)**:
      `question-display.util.ts` (`correctAnswerLabel`) convierte índice numérico a letra en
      lista y detalle del banco; letras de imagen pasan intactas; spec propia. En vivo: preguntas
      estructuradas muestran "Clave: 0…4" (índice 0-based de storage) y las de imagen "Clave:
      d" (letra). "Clave: 0" parece un bug para cualquier profesor. La conversión
      índice↔letra existe (`correct-answer-index-to-letter.ts`) — la lista/detalle del banco
      no la usa. Consistency/Functional.

- [x] **M2 — Cursos duplicados sin desambiguar en el árbol del banco.** En vivo: "Comunicación"
      ×3 (99/1514/26), "Arte y Cultura" ×2, "Educación Física" ×2, "Matemática" ×2, etc. Son
      scopes de nivel distintos pero la UI no muestra el nivel — imposible saber cuál abrir
      con filtro "Todos". Product.
      **HECHO (2026-08-21)**: `GET /courses` ahora manda `stage` (la unicidad de un curso es
      `(stage, name)`, así que el nivel es literalmente lo único que separa a los homónimos), y
      el web lo usa vía `courseLabels()` (`features/taxonomy/course-label.ts`, spec propia) en
      el árbol del banco y en el filtro de curso: "Comunicación · Colegio" /
      "Comunicación · Preuniversitario".
      - **Solo se etiqueta lo que se repite.** Poner el nivel a los 45 cursos ensuciaría el
        caso común para arreglar el raro; los nombres únicos siguen desnudos.
      - Comparación normalizada (trim + minúsculas), así que "Arte y Cultura" y
        "arte y cultura " cuentan como el mismo nombre y ambos se desambiguan.
      - Un `stage` que el front no conozca se imprime crudo en vez de omitirse: una distinción
        que no sabemos nombrar sigue siendo una distinción que el lector necesita. Por eso
        `Course.stage` es `string` y no la unión `Stage`.
      - Etiqueta corta ("Colegio") y no `STAGE_LABELS` ("Colegio (Secundaria)"): aquí es un
        sufijo sobre un nombre que ya es largo.
      Verificado: 957 non-e2e + 275 e2e (API) y 839 tests de web, todo verde.

- [x] **M3 — Móvil 390px: tarjetas de examen ilegibles.** Screenshot: título truncado a "Co…"
      (2 chars + ellipsis) y la meta ("4° secundaria · 8 preguntas · 0 formas") envuelta en
      columna de una palabra. Todas las tarjetas se ven iguales. Frontend/Responsive.
      **HECHO (2026-08-21)**: la tarjeta se apila por debajo de `md` — título y meta en su
      propia línea, y tag + acciones agrupadas debajo (`[data-testid="exam-row-actions"]`).
      La causa era que las acciones y el tag comparten fila con el título: no encogen, así que
      se llevaban el ancho y al título le quedaban ~30px. Se usa `md` (768px), el mismo
      breakpoint del drawer del shell, no un `sm` nuevo.
      **Verificado en vivo con Playwright a 390×844** (no solo por clases): el título mide
      **317px** de ancho y se lee completo, la meta entra en una sola línea, y las acciones
      caben en su fila. A 1280px la tarjeta sigue siendo una sola fila (título 684px, acciones
      a la derecha) — sin regresión de escritorio.
      De paso, en la misma pasada se confirmó **M2** en vivo: el árbol del banco muestra
      "Comunicación · Colegio 99", "· Escuela 26" y "· Preuniversitario 1559", y los nombres
      únicos siguen desnudos. **Matiz descubierto ahí**: un curso cuyo homónimo existe en el
      catálogo pero no tiene preguntas igual lleva sufijo (p. ej. "Ciencia y Tecnología ·
      Colegio", que aparece solo). Es deliberado: desambiguar solo entre lo visible haría que
      la etiqueta de un mismo curso cambiara al cambiar de filtro, y una etiqueta inestable
      confunde más que un sufijo de más.

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

- [x] **M9 — Rate limit de IA solo por IP global (100/min), nada por cuenta.** Los endpoints
      caros (`/ai/questions/generate`, `/ai/extract`) comparten el default; un colegio entero
      detrás de un NAT comparte la misma cubeta y un solo usuario puede agotarla (o
      inflar el gasto LLM si H6 no se ataca). Abuse.
      **HECHO (2026-08-21)**: `AccountThrottlerGuard` (`common/account-throttler.guard.ts`)
      cuenta por CUENTA, no por IP, y se aplica a `AiController` y `AiJobsController` con
      `AI_PER_ACCOUNT_THROTTLE` (30/min). La IP es la unidad equivocada para un colegio: la
      sala de profesores comparte un NAT, así que la cubeta por IP castiga a los colegas del
      que se pasa, mientras que quien de verdad abusa se cambia de IP con el dato del celular.
      La cuenta es lo que gasta la plata en esas rutas, así que es lo que se cuenta.
      - **El orden de los guards ES el arreglo**: `@UseGuards(JwtAuthGuard,
        AccountThrottlerGuard)`. Al revés, `request.user` no existe todavía y el guard degrada
        en silencio a limitar por IP. Y no lo detectaría ninguna prueba de comportamiento,
        porque el `skipIf: NODE_ENV === "test"` del `ThrottlerModule` apaga el throttler entero
        bajo tests — por eso hay una spec que verifica el ORDEN de los guards por metadata en
        los dos controladores, además de la del tracker.
      - Si alguna vez corriera sin autenticar, cae a `super.getTracker` (la IP): una
        configuración mala cuesta el límite fino, no todo el límite.
      - 30/min está muy por encima de lo que hace un profesor a mano (generar, leer, revisar) y
        muy por debajo de lo que hace un script.
      Verificado: 989 non-e2e + 276 e2e.

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

- [~] **M12 — Taxonomía con clasificación ruidosa.** En vivo bajo Geometría→Triángulos:
      identidades trigonométricas ("senA+4senB…", "CtgB+CtgC") y un problema de cono
      (variación porcentual de volumen). El blueprint por tema selecciona esto como
      "Triángulos". Escala no determinada. Data quality.
      **MEDIDO Y PARCIALMENTE CORREGIDO (2026-08-21)**. La medición corrige el propio
      hallazgo:
      - **Las trigonométricas NO están mal archivadas.** Se leyeron las 25 de 317 preguntas de
        Triángulos que mencionan sen/cos/tg: todas son problemas DE triángulos que usan
        trigonometría como herramienta ("Si el perímetro del triángulo ABC es 24 y el
        circunradio mide 5, halla SenA+SenB+SenC"). Un profesor que pide preguntas de
        triángulos recibe preguntas de triángulos. Mover eso a Trigonometría empeoraría el
        banco, no lo arreglaría.
      - **Los sólidos sí.** 3 de 317 en Triángulos y 1 en Circunferencia son problemas de
        volumen de cono/cilindro: ahí el profesor pide triángulos y recibe un cono. Movidas a
        Cuerpos Redondos con `scripts/refile-round-solid-questions.ts`
        (`pnpm db:refile-round-solids`), sobre la regla de dominio `isRoundSolidQuestion` —
        que exige el sólido **y** la medida (volumen / área lateral). Sin esa segunda
        condición la regla se traga un problema de tiro parabólico ("dos esferas caen de una
        mesa… calcula la altura"), que es física disfrazada de esfera: se dejó donde estaba, y
        hay una spec que lo fija.
      - El movimiento conserva curso y grado — solo cambia el tema — y si el curso no tiene
        `cuerpos-redondos` a ese grado, la pregunta se reporta y no se fuerza a ningún lado.
      **Lo que queda abierto, y por qué**: la única pregunta que la medición dejó marcada como
      realmente mal ubicada es la de tiro parabólico bajo Segmentos y Ángulos — está en el
      CURSO equivocado (Física, no Geometría), y mover de curso pide criterio por pregunta.
      Certificar la clasificación de las 65 387 preguntas no es un barrido por palabras clave:
      es un proyecto de re-clasificación semántica aparte. Lo que este ítem sí deja es la
      escala real de la muestra que el audit señaló — ~1% de ruido duro, no el 10% que la
      lectura por palabras sugiere.
      Verificado: 973 non-e2e + 276 e2e.

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
- [x] **L5** — `packages/shared` `"test": "echo …"` no-op, pero el matrix de CI lo corre como
      si fuera una suite — verde decorativo.
      **HECHO (2026-08-21)**: primero se miró QUÉ hay en el paquete antes de decidir. Los
      `dto/*.ts` son interfaces puras — cero representación en runtime, nada que un test pueda
      ejercitar que `tsc` no cubra ya. Pero `role.enum.ts` y `difficulty.enum.ts` sí son código
      real: un `enum` de TS compila a un objeto JS cuyos valores string son contrato de wire y
      de base de datos (`JwtPayload.role`, columnas `role`/`difficulty`). O sea había algo que
      testear de verdad, y sacarlo del matrix habría sido deshonesto en la otra dirección.
      Ahora `"test": "jest"` (mismo stack jest + ts-jest que la API, sin meter un segundo
      framework) sobre specs que fijan cada miembro y cada valor. **Comprobado que muerde**:
      renombrar `Teacher = "teacher"` a `"instructor"` deja el suite en 1 fallo / 8 pases; si
      no fallara sería el mismo verde decorativo con otro disfraz. El comentario del `ci.yml`
      que decía "shared's test script is a no-op echo" también se corrigió — dejarlo habría
      sido documentación mintiendo sobre su propio pipeline.
- [x] **L6** — `bypassSecurityTrustResourceUrl(url + PREVIEW_FRAGMENT)` duplicado en
      `ai-review-queue.component.ts:627` y `generation-job-detail.component.ts:322` — misma
      regla en dos sitios (son blob URLs propios, no hay riesgo XSS; es dedup).
      **HECHO (2026-08-21)**: verificado primero que fuera duplicación REAL y no dos cosas
      parecidas — mismo fragmento, mismo sanitizer, misma construcción de la URL; lo único
      distinto es qué hace cada componente con el resultado, que es aguas abajo. Extraído a
      `features/ai/pdf-preview-url.ts` (`toPdfPreviewUrl`, spec propia), siguiendo la
      convención de la carpeta (funciones puras chicas con spec al lado, como
      `extract-error-message.ts`). La razón por la que el bypass es seguro ahora vive en un
      solo sitio. Web 842 → 844.
- [x] **L7** — Nombres "Copia de Copia de Copia de Copia de …" — el duplicado no incrementa
      (`(2)`, `(3)`) y el dashboard se llena de títulos idénticos.
      **HECHO (2026-08-21)**: `duplicateTitle()` (`modules/exams/domain/duplicate-title.ts`,
      spec propia) decide el título y `duplicateExam` lo usa: "Copia de X", luego
      "Copia de X (2)", "(3)". Duplicar una COPIA da otra copia del mismo examen, no una copia
      de segunda generación — que es como lo piensa cualquiera. Ocupa el primer número libre,
      así que borrar la (2) la reutiliza en vez de saltar a la (4).
      **Lo que casi se cuela**: la primera versión recortaba cualquier `(n)` final, y con eso
      "Simulacro (2024)" perdía el año. Nada distingue nuestro "(2)" del "(2024)" del docente,
      así que la regla se inclina a conservar lo que él escribió: solo se recorta un número de
      **1 a 3 dígitos** y **solo** de un título que ya empieza con "Copia de".
      Los títulos tomados se leen dentro de la transacción, pero NO es garantía de unicidad:
      no hay índice único en `(tenant_id, title)` ni se quiere — un docente puede querer dos
      exámenes con el mismo nombre. Dos duplicaciones en carrera pueden empatar de número; es
      un empate cosmético, no una fila rota.
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
