# Auditoría de latencia en producción — 2026-08-26

Pregunta que la origina: *"en local anda fino, en prod carga lento la data; creo que el
modelo de datos puede mejorar"*.

La respuesta corta es que el modelo de datos **no** es la causa dominante, y que el banco
no tiene "+5k, hasta 10k" preguntas sino **64,257** (`rg -c '"correctAnswer"'` sobre
`apps/api/src/db/data/collected/*.json`). Ambas cosas importan, pero en direcciones
distintas a las esperadas: el conteo real es 10× mayor que el asumido, y aun así 64k filas
siguen siendo un tamaño que Postgres resuelve sin despeinarse. Lo que sí explica la
diferencia local↔prod es geografía multiplicada por número de peticiones.

Todo lo numérico de la sección 1 está **medido contra prod** el 2026-08-26. Lo de las
secciones 3–5 es análisis estático del repo: no tengo acceso de red a la base de datos de
prod (vive en `exams-internal`, `internal: true`), así que ningún `EXPLAIN ANALYZE` real
respalda las estimaciones de plan. Están marcadas como tales.

---

## 1. La medición que reordena las prioridades

### 1.1 El piso de latencia por petición es ~620 ms, haga o no haga trabajo

```
GET https://api.creaexamen.com/__nope   (404, ningún handler, ninguna query)
  ttfb = 0.672s / 0.633s / 0.590s

GET https://app.creaexamen.com/index.html   (nginx sirviendo un archivo estático)
  ttfb = 0.925s / 1.204s / 0.616s

GET https://api.creaexamen.com/health   (toca Postgres + Redis)
  ttfb = 0.751s / 0.652s / 1.208s / 0.939s / 1.366s
```

Un 404 que no ejecuta absolutamente nada cuesta ~620 ms. Ese es el piso. Todo lo demás se
suma encima.

### 1.2 No es saturación de CPU — es distancia

Doce peticiones en paralelo al mismo 404:

```
0.623 0.629 0.633 0.635 0.636 0.637 0.642 0.644 0.650 0.719 0.933 0.947
wall = 1.14s
```

Si el servidor estuviera serializando por CPU, los tiempos escalarían linealmente. No lo
hacen: doce peticiones concurrentes cuestan casi lo mismo que una. El costo es
**round-trip**, no cómputo.

### 1.3 Dónde está el servidor

```
$ curl https://api.creaexamen.com/cdn-cgi/trace   ->  colo=GIG  loc=PE
$ dokploy settings.getIp                          ->  45.8.132.213
$ ipinfo 45.8.132.213  ->  Lauterbourg, Grand Est, FR — AS51167 Contabo GmbH
$ ping -c 5 45.8.132.213
  round-trip min/avg/max = 195.403/198.367/208.680 ms
```

El origen está en **Francia**. Los usuarios están en **Perú**. RTT directo: **198 ms**.
Cloudflare atiende el hostname desde **GIG (Río de Janeiro)** — no desde MIA, que es el
colo que sirve `cloudflare.com` al mismo cliente — así que el camino real es
Perú → Río → Francia → Río → Perú.

Ese es el número que explica "en local anda fino". En local el RTT es 0 ms y una página que
hace 55 peticiones se siente instantánea. En prod las mismas 55 peticiones arrancan
debiendo 620 ms cada una antes de que el servidor escriba un solo byte.

### 1.4 Estado del host

```
docker.getServerHealth:
  cpuCount        = 6
  memTotalBytes   = 12.54 GB
  memUsedBytes    =  9.75 GB   (78 %)
  containerCount  = 58
  serviceCount    = 35
```

Seis vCPU y 12.5 GB compartidos por 58 contenedores de once proyectos distintos. No es lo
que está causando los 620 ms (§1.2 lo descarta), pero sí es lo que explica la varianza:
`/health` oscila entre 652 ms y 1366 ms — un factor 2× de jitter que no aparece en el 404.
Esa diferencia es Postgres y Redis peleando por el host.

---

## 2. Cómo 620 ms se convierten en la lentitud que se ve

`/app/bank` en la primera carga (`bank-list.component.ts`):

| # | Petición | Depende de |
|---|----------|-----------|
| 1 | `GET /taxonomy/courses` | — |
| 2 | `GET /taxonomy/topics?courseIds=…` | **(1)** — `switchMap`, secuencial |
| 3 | `GET /bank/questions/summary` | — (en paralelo con 1–2) |

`fetchTaxonomy()` encadena cursos → temas con `switchMap`, así que son dos round-trips en
serie: **~1.24 s antes de pintar el árbol**, y el `forkJoin` con los conteos no ayuda
porque la rama larga manda.

Al expandir un tema:

| # | Petición | Notas |
|---|----------|-------|
| 4 | `GET /bank/questions?topicId=…&page=1&pageSize=50` | `TOPIC_PAGE_SIZE = 50` |
| 5…54 | `GET /assets/:id` × 50 | uno por miniatura, `loadImages()` |

Cincuenta peticiones de imagen, sin límite de concurrencia, cada una pagando el piso de
620 ms y transportando entre 36 KB y 112 KB (medido sobre
`apps/api/src/db/data/**/*.png`) — del orden de **3 MB por tema abierto**.

Y se repiten enteras en cada visita, porque nada se cachea. Ver §3.

---

## 3. El hallazgo con mayor relación impacto/esfuerzo: `/assets/:id` no cachea nada

`apps/api/src/modules/assets/assets.controller.ts` fija `X-Content-Type-Options`,
`Content-Type` y `Content-Disposition`. No fija `Cache-Control`, ni `ETag`, ni
`Last-Modified`. Un `rg 'Cache-Control|ETag|max-age'` sobre `apps/api/src` sólo encuentra
los tres `no-cache` de los endpoints SSE.

El agravante es cómo las consume el web. `bank.service.ts` las pide por `HttpClient` con
`responseType: 'blob'` y las convierte con `URL.createObjectURL` — no son `<img src>`
normales, porque `/assets/:id` exige `Authorization: Bearer` y un `<img>` no puede
mandarlo. Consecuencias encadenadas:

- Sin `Cache-Control`, el navegador revalida o refetchea en cada carga. Los 3 MB por tema
  se pagan siempre.
- Al ser XHR y no `<img>`, no hay `loading="lazy"`, ni prioridad de imagen, ni decodificación
  fuera del hilo principal.
- Cloudflare responde `cf-cache-status: DYNAMIC` sobre el hostname del API: nada de eso se
  cachea en el borde tampoco, y cada miniatura cruza el Atlántico entera.

Además, `assets.service.ts` hace `await this.storage.get(key)` y devuelve un `Buffer`
completo, que el controlador manda con `res.send()`. El binario íntegro pasa por la
memoria del proceso Node. Con un único contenedor de API — y `replicas: 1` está fijado a
propósito en `docker-compose.dokploy.yml`, con un comentario que explica por qué — cincuenta
imágenes concurrentes son cincuenta buffers vivos a la vez.

Y no hay miniaturas: `assets` guarda un solo `storage_key` por fila. `sharp` ya es
dependencia (`apps/api/package.json`) y ya se usa en `sharp-image-cropper.adapter.ts`, pero
sólo para recortar en el pipeline de extracción. La grilla del banco descarga el escaneo a
resolución completa para pintarlo del tamaño de una miniatura.

**Qué hacer, en orden de retorno:**

1. **[IMPLEMENTADO]** Emitir `Cache-Control` + `ETag` en `/assets/:id` — pero con una
   distinción que la primera versión de este documento daba por sentada y no lo es.

   Las **imágenes** sí son inmutables por construcción, y se verificó: todo camino de
   escritura genera `bank/questions/${randomUUID()}` e **inserta una fila `assets` nueva`
   —incluido `replaceImageAsset`, que deja la vieja en su lugar a propósito— y no existe
   ni un solo `UPDATE` contra `assets` en el código. Reciben
   `private, max-age=31536000, immutable`.

   Los **PDF no**. `exam-generation.service.ts` deriva su storage key de forma
   determinista (`exams/${exam.id}/versions/${version.code}/exam.pdf`), y la regeneración
   idempotente B4-B borra las versiones previas y vuelve a hacer `put()` sobre esas mismas
   keys. Es decir: el objeto al que apunta un asset id **ya entregado** puede ser
   sobrescrito. Marcarlos `immutable` serviría el PDF del examen anterior, desde caché,
   para siempre y sin forma de invalidarlo. Reciben `private, no-cache` — que significa
   "guárdalo pero revalida antes de usarlo", no "no lo guardes", así que conservan el
   ahorro de bytes vía `If-None-Match` sin poder servir nada rancio.

   Todas las políticas son `private`: Cloudflare está delante de esta API y una caché
   compartida no debe guardar la imagen privada de un tenant.

   Ver `apps/api/src/modules/assets/asset-cache.ts` y los 16 tests de
   `assets.e2e.spec.ts`, incluido el que fija que una petición cross-tenant con un `ETag`
   válido sigue siendo 404 y nunca 304 — un 304 no puede volverse una forma barata de
   confirmar que existe el asset de otro tenant.
2. Guardar una variante miniatura al subir (`sharp().resize({ width: 480 }).webp()`) como
   segunda fila de `assets`, o como columna `thumb_storage_key`. La grilla pide la
   miniatura; el detalle pide el original.
3. Servir el original con `res.setHeader` + stream en vez de bufferizar
   (`storage.getStream(key).pipe(res)`), para que el proceso no retenga el binario completo.
4. Acotar la concurrencia de `loadImages()` (`mergeMap(…, 6)`) para que expandir un tema no
   dispare cincuenta XHR de golpe.

---

## 4. Modelo de datos: sí hay una brecha real, y es un índice

La intuición de que el modelo puede mejorar es correcta, pero el problema concreto es más
pequeño y más específico de lo esperado.

### 4.1 `questions` no tiene índice sobre `created_at`

`listQuestions` ordena por `desc(created_at), desc(id)` — y el comentario del repositorio
explica bien por qué ambas mitades son necesarias. Pero los índices existentes sobre
`questions` (extraídos de `apps/api/drizzle/*.sql`) son:

```
questions_tenant_id_idx            (tenant_id)
questions_topic_id_idx             (topic_id)
questions_subtopic_id_idx          (subtopic_id)
questions_grade_level_idx          (grade_level)
questions_difficulty_idx           (difficulty)
questions_status_idx               (status)
questions_source_url_idx           (source_url)
questions_pool_idx                 (grade_level, status)
questions_tenant_id_body_hash_idx  (tenant_id, body_hash) UNIQUE
```

Ninguno incluye `created_at`. La asimetría es llamativa porque `exams` **sí** lo tiene
(`exams_tenant_created_idx` sobre `(tenant_id, created_at)`, migración 0011) — se arregló
para la tabla de cientos de filas y no para la de 64k.

Estimado, sin `EXPLAIN` de prod: cada página del banco filtra, **ordena el conjunto
completo que pasó el filtro**, y recién entonces aplica `LIMIT 50`. Con `topicId` presente
el conjunto es chico y da igual; sin `topicId` son decenas de miles de filas ordenadas para
devolver cincuenta.

```sql
CREATE INDEX CONCURRENTLY questions_topic_created_idx
  ON questions (topic_id, created_at DESC, id DESC);
```

Ese índice permite recorrer en orden y cortar en la fila 50 sin ordenar nada.

### 4.2 La paginación por OFFSET degrada en profundidad

`.offset((page - 1) * pageSize)` obliga a Postgres a producir y descartar las filas
anteriores. Página 1: gratis. Página 40: dos mil filas descartadas. Con el índice de §4.1
el costo es de recorrido de índice y no de sort, pero sigue siendo lineal en la profundidad.
Si la paginación profunda llega a importar, la alternativa es keyset:
`WHERE (created_at, id) < ($cursor_created, $cursor_id)`. El orden ya es exactamente el
correcto para eso — es un cambio de firma, no de modelo.

### 4.3 `countByCourseAndTopic` es un scan completo por diseño

```sql
SELECT topics.course_id, questions.topic_id, count(*)
FROM questions JOIN topics ON questions.topic_id = topics.id
WHERE (questions.tenant_id IS NULL OR questions.tenant_id = $1)
GROUP BY topics.course_id, questions.topic_id
```

Es la query que carga el árbol entero, y su predicado de visibilidad no descarta casi nada
(el banco central es `tenant_id IS NULL`, es decir, la mayoría de las 64k filas). No hay
índice que la salve: es un scan + hash aggregate, siempre.

En un host sano son decenas de milisegundos. Vale la pena decir explícitamente que **este
no es el cuello de botella actual** — 620 ms de red lo enanizan. Pero es la query que peor
escala si el banco crece a 500k, y en ese punto la respuesta correcta es una tabla de
conteos materializada y mantenida por trigger, no un índice.

### 4.4 `usedInExamCount` es un subquery correlacionado por fila

```sql
(SELECT COUNT(*)::int FROM exam_questions WHERE exam_questions.question_id = questions.id)
```

Se ejecuta una vez por fila devuelta — cincuenta lookups por página. `exam_questions_question_id_idx`
existe y los cubre, así que es barato, pero es trabajo que no hace falta en la vista de
lista: la grilla sólo necesita saber *si* se usa, no cuántas veces. Un `EXISTS` es más
barato que un `COUNT`, y el número exacto puede quedarse en el detalle.

---

## 5. Configuración: lo que está en default y no debería

### 5.1 Postgres corre sin tuning

`exams-postgres` en `docker-compose.dokploy.yml` es `postgres:17.2-bookworm` sin `command:`
y sin montar `postgresql.conf`. Es decir, defaults de fábrica: `shared_buffers = 128MB`,
`work_mem = 4MB`, `effective_cache_size = 4GB`, `random_page_cost = 4.0` (calibrado para
discos giratorios).

`work_mem = 4MB` es el que muerde: el `GROUP BY` de §4.3 sobre decenas de miles de filas y
el `ORDER BY` de §4.1 desbordan a disco en vez de resolverse en memoria. Un punto de partida
razonable para este host —tomando ~2 GB como la porción que le toca a este stack de los
12.5 GB compartidos— es:

```
shared_buffers = 512MB
effective_cache_size = 1536MB
work_mem = 16MB
maintenance_work_mem = 128MB
random_page_cost = 1.1        # NVMe, no disco giratorio
```

Conservador a propósito: el host está al 78 % de memoria y hay 34 servicios más encima.

### 5.2 El pool de conexiones no declara límites

`apps/api/src/db/client.ts`:

```ts
export const pool = new Pool({ connectionString: resolveDatabaseUrl() });
```

Sin `max` (default de `node-postgres`: 10), sin `idleTimeoutMillis`, sin
`connectionTimeoutMillis`, sin `statement_timeout`. Diez conexiones para una réplica está
bien. Lo que falta son los timeouts: una query colgada retiene su conexión indefinidamente,
y con diez en total bastan diez para dejar la API muda sin un solo error en los logs.

```ts
new Pool({
  connectionString: resolveDatabaseUrl(),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 15_000,
})
```

### 5.3 La API no comprime sus propias respuestas

No hay `compression` en `apps/api/package.json` ni middleware en `main.ts`. Cloudflare
comprime en el borde (`content-encoding: br` en `/health`), así que el tramo
borde→navegador está cubierto — pero el tramo que cuesta 198 ms, origen→borde, viaja en
claro. Una página de 50 preguntas con `bodyTypst` y `alternatives` jsonb no es un JSON
pequeño.

### 5.4 Los contenedores no declaran límites de recursos

Ningún servicio en `docker-compose.dokploy.yml` tiene `deploy.resources.limits`. El único
bloque `deploy:` es el `replicas: 1` de la API. En un host al 78 % de memoria compartido con
otros diez proyectos, un pico de memoria de este stack lo paga otro proyecto, o al revés.

### 5.5 El bundle del SPA se cachea 4 horas en vez de para siempre

```
GET /main-NERWJ2X7.js
  cache-control: max-age=14400
  cf-cache-status: MISS
  206 KB gzip (546 KB sin comprimir)
```

`infra/nginx/web.conf` no emite `Cache-Control` para nada; ese `max-age=14400` lo inyecta
Cloudflare por su default de Browser Cache TTL. Un archivo con hash en el nombre es inmutable
por definición y merece `max-age=31536000, immutable`. El `cf-cache-status: MISS` repetido
sobre un asset con hash sugiere además que el borde no lo está reteniendo.

nginx tiene `gzip on` pero no brotli; con Cloudflare delante importa poco para el navegador,
pero sí para el tramo origen→borde.

---

## 6. Qué se implementó

Todo lo de las secciones 3–5 está hecho, salvo el punto 9 — que no es código.
Cada cambio lleva su razonamiento en el archivo donde vive; esto es solo el índice.

| # | Cambio | Dónde | Evidencia |
|---|--------|-------|-----------|
| 1 | `Cache-Control` + `ETag` en `/assets/:id` | `assets/asset-cache.ts` | 8 unit + 16 e2e |
| 2 | Índice `(topic_id, created_at, id)` en `questions` | `drizzle/0021_blushing_nitro.sql` | `EXPLAIN ANALYZE`, §6.1 |
| 3 | Timeouts y límites del pool | `db/env.ts`, `db/migrate.ts` | 5 unit |
| 4 | `compression` con filtro que excluye SSE | `common/compression.filter.ts` | 5 unit |
| 5 | Miniaturas 320px WebP, generadas en frío | `assets/asset-thumbnail.ts` + `sharp-thumbnailer.adapter.ts` | 7 unit + 6 unit + 7 e2e |
| 6 | Cursos y temas en paralelo | `bank-list.component.ts`, `taxonomy.service.ts` | 2 + 2 web |
| 7 | Tope de 6 descargas de miniatura concurrentes | `bank-list.component.ts` | — |
| 8 | Tuning de Postgres | `docker-compose.dokploy.yml` | arranque verificado |
| 9 | Cache headers del SPA | `nginx/web.conf` | matcheo verificado, §6.2 |

Suites: **1290** unit API, **305** e2e API, **903** web. Typecheck limpio en los tres
paquetes.

### 6.1 El índice, medido

Base local de 67,025 preguntas y 524 temas — no una estimación. Tema de 1388 preguntas,
`LIMIT 50`:

```
sin índice   227 buffers   1.178 ms   Bitmap Heap Scan de las 1388 filas + top-N heapsort
con índice    55 buffers   0.247 ms   Index Scan Backward, corta en la fila 50
```

Lo que importa no es el 4.8×: es que el plan viejo leía **todas** las filas del tema para
devolver 50, así que su costo crecía con el tamaño del tema. El nuevo no.

**Un índice que propuse y descarté.** El plan original incluía un índice parcial
`(created_at, id) WHERE status = 'draft'` para la cola de revisión. Se creó, se midió, y
el planner **no lo usó** — eligió el `questions_status_idx` que ya existía, porque hay 14
drafts contra 66,957 aprobadas. Un índice que el planner ignora es peso muerto que igual
se paga en cada escritura. Se revirtió. La recomendación era plausible; la medición dijo
que no.

### 6.2 Los cache headers del SPA, verificados uno por uno

Servido en un contenedor nginx real con archivos de prueba:

```
main-NERWJ2X7.js       public, max-age=31536000, immutable
styles-NO7ENWZY.css    public, max-age=31536000, immutable
index.html             no-cache
favicon.ico            public, max-age=2592000
robots.txt             (sin header — revalidación por defecto)
/app/bank              no-cache
```

La última línea es la que valía la pena comprobar: confirma que el fallback SPA
(`try_files ... /index.html`) vuelve a matchear `location = /index.html`, así que una ruta
profunda no se cachea. Si eso fallara, el síntoma sería un deploy que sigue sirviendo los
nombres de chunk del anterior — y no se habría notado hasta el siguiente deploy.

### 6.3 Cuatro cosas que habrían roto prod si las asumía

Ninguna es visible leyendo el archivo que se toca.

1. **`immutable` no vale para todos los assets.** Las imágenes sí: cada camino de escritura
   genera `randomUUID()` e inserta fila nueva, y no hay ni un `UPDATE` contra `assets`. Los
   PDF no: su key es determinista (`exams/${id}/versions/${code}/exam.pdf`) y la
   regeneración B4-B la sobrescribe. Un `immutable` plano habría servido el examen anterior
   desde caché para siempre. Los PDF quedaron en `private, no-cache`.

2. **`CREATE INDEX CONCURRENTLY` no puede correr dentro de una transacción**, y el migrador
   de drizzle envuelve cada archivo en una. Sobre 64k filas el `CREATE INDEX` normal tarda
   menos de un segundo y el lock cae durante el deploy, antes de que la API sirva.

3. **`statement_timeout` habría matado la espera del `pg_advisory_lock`.** `migrate.ts`
   serializa con un lock de sesión, y esperar ese lock ES una sentencia. En una base de CI
   vacía, con varios workers de jest compitiendo, el perdedor habría fallado a los 30s. Se
   limpia el timeout en esa conexión y solo en esa.

4. **El filtro por defecto de `compression` comprime `text/*`, que incluye
   `text/event-stream`.** Habría bufferizado los dos streams SSE de progreso: la conexión
   queda abierta y muda, sin error y sin log. Una barra de progreso que no avanza.

También: `statement_timeout` no puede bajar de lo que tarda un batch de 1000 filas del
seeder, que corre en el arranque del contenedor sobre este mismo pool. Un valor más
ajustado no se vería como una página lenta — fallaría el deploy.

### 6.4 Miniaturas: por qué solo en un lugar

Son preguntas **imagen**: el enunciado y las alternativas están dentro del PNG. Reducir la
vista que un profesor LEE cambia un problema de latencia por uno de legibilidad.

Solo hay un lugar que renderiza a un tamaño donde eso no aplica: la fila hoja del árbol,
`class="h-10 w-10"` — 40px, una por pregunta, 50 por tema abierto. Ahí estaban los 3 MB.
Las otras dos vistas (el panel `max-h-64` de la pregunta seleccionada y el preview de
edición) renderizan una imagen a la vez y conservan el original.

El resultado es progresivo: la fila pinta la miniatura, y al seleccionar una pregunta el
panel aparece al instante con esos bytes y se afina cuando llega el original.

Sin migración, sin columna y sin backfill: la key de la miniatura se deriva de la del
original, así que "¿ya existe?" se lo pregunta al storage, y las 64k imágenes que ya están
en producción se curan solas la primera vez que alguien las mira. Camino caliente medido:
2 ms; camino frío 14 ms.

## 7. Lo único que queda, y no es código

El origen está en Francia y los usuarios en Perú: **198 ms de RTT** en cada petición, en un
sistema donde una pantalla dispara decenas. Todo lo de arriba reduce el NÚMERO de
peticiones y el tamaño de cada una, que es lo que se puede hacer desde el código. Ninguna
optimización de query compite con la distancia.

Las opciones son mover el origen a São Paulo o Miami (Contabo tiene presencia en EE. UU.),
activar Cloudflare Argo Smart Routing, o ambas. Es una decisión de infraestructura y de
plata, así que queda planteada, no tomada.

## 8. Qué queda sin verificar

- Ningún `EXPLAIN ANALYZE` sobre la base de prod. `exams-postgres` vive en una red
  `internal: true` sin exposición externa — cosa que está bien y es deliberada (auditoría
  2026-08-20, H4) — así que los planes de §4 son inferencia a partir del esquema, los
  índices y el conteo de filas, no medición.
- Los conteos de filas en prod. Las 64,257 preguntas salen de los JSON del seed en el repo,
  no de un `SELECT count(*)` contra prod. El seeder es idempotente
  (`onConflictDoUpdate`), así que debería coincidir, pero no está confirmado.
- Las latencias medidas son desde una única ubicación (Perú, colo GIG). Un usuario en otro
  país verá otro piso.
