# Un tema por concepto, grados como atributo — Diseño

**Fecha:** 2026-09-03
**Estado:** aprobado en conversación (opción A de la auditoría), pendiente de plan.
**Base:** `docs/audits/2026-09-03-taxonomy-data-audit.md`.

## Problema

`topics` es único por `(course_id, name, grade_level)`: cada tema del currículo se repite como una fila por grado. Hoy hay 953 filas para 626 nombres; la duplicación vive en escuela (256 filas / 81 nombres) y colegio (273 / 120); preuni ya usa un solo grado `pre` (424 filas / 425 nombres). El grado de una pregunta vive en `questions.grade_level` y coincide con el del tema en 66 943 de 67 029 filas, así que la copia del tema no aporta información y multiplica selects, árboles y carpetas (~1 000 carpetas sembradas por colegio, 510 de ellas copias con sufijo "· N° grado").

## Decisiones

1. Un tema es un concepto de un curso: `topics` único por `(course_id, name)`.
2. Los grados en que se dicta viven en una tabla nueva `topic_grades`.
3. `questions.grade_level`, `generation_jobs.grade_level` y el resto de grados por fila no cambian: siguen siendo el eje independiente de la pregunta o del trabajo.
4. Los cursos repetidos entre etapas (Matemática en Escuela y en Colegio) se quedan: son currículos distintos y ya cuelgan de raíces distintas en el árbol.
5. `subtopics` no se toca (nadie la usa; se evalúa borrarla en otra iteración).
6. La migración de datos corre como migración Drizzle numerada, dentro del pipeline de deploy (`migrate && seed && main`). Es de una sola pasada; el seed queda idempotente sobre la forma nueva.

## Modelo

### `topics`

- Se elimina la columna `grade_level`.
- Índices únicos: `(course_id, name)` y parcial `(course_id, slug) WHERE slug IS NOT NULL` (el `slug` sigue siendo nulo fuera de los 276 temas preuni canónicos).

### `topic_grades` (nueva)

| Columna | Tipo |
|---|---|
| `topic_id` | uuid FK `topics.id` `ON DELETE CASCADE` |
| `grade_level` | text FK `grade_levels.code` |
| PK | `(topic_id, grade_level)` |
| Índice | `(grade_level)` |

Un tema sin filas en `topic_grades` se dicta en toda su etapa (hoy no existe; la migración escribe siempre al menos una fila).

## Migración `0023_topic_grades`

Orden dentro de una transacción:

1. Crear `topic_grades`.
2. Insertar `(topic_id, grade_level)` para cada fila actual de `topics` con grado, usando como `topic_id` el **canónico** de su grupo `(course_id, name)`: la copia con menor `grade_levels.sort_order`; si el grupo no tiene grado, la de menor `created_at`/`id`.
3. Re-apuntar a la canónica todas las FK de las copias: `questions.topic_id`, `generation_jobs.topic_id`, `exam_blueprint_rows.topic_id`, `exam_blueprint_template_rows.topic_id`, `subtopics.topic_id`, `syllabus_week_maps.topic_id` (borrando la fila duplicada cuando `(template_id, topic_id)` ya existe).
4. `question_folders`: por tenant, si varias carpetas apuntan a copias del mismo grupo, se conserva la de menor `position`, se mueven a ella las preguntas (`questions.folder_id`) y las subcarpetas (`parent_id`) de las demás, y se borran las demás. A toda carpeta con `topic_id` se le quita el sufijo ` · <etiqueta de grado>` del nombre; si al quitarlo colisiona con una hermana, se numera ` (2)`, ` (3)`… como hace la siembra, saltando los nombres que el grupo destino ya ocupa. Ese nombre final se calcula **dentro de la misma sentencia** que mueve o renombra la carpeta: `question_folders_sibling_name_idx` y `question_folders_root_name_idx` no son diferibles, así que una pasada posterior de "arreglar duplicados" nunca llegaría a correr — la transacción ya habría abortado. Caso aparte: si la carpeta que se conserva es hija de una que se borra, sube al padre de esa (no puede ser su propio padre, y `parent_id` es ON DELETE CASCADE).
5. Borrar las copias no canónicas de `topics`.
6. Quitar `grade_level` y los dos índices viejos; crear los índices nuevos.

Resultado esperado con los datos actuales, verificado corriendo `0023` contra la base local: 953 → **625** temas; `topic_grades` con **953** filas repartidas sobre esos 625 temas; **0** temas sin filas; ninguna pregunta cambia de grado.

Los 2 temas preuni con `grade_level` NULL no quedan sueltos, que es de donde salían el 626 y el 951 de la estimación previa: como el colapso agrupa por `(course_id, name)`, cada uno cae dentro de un grupo que sí tiene grado, se colapsa en él y no aporta ninguna fila a `topic_grades` — el grupo conserva los grados de sus otras copias. Un tema queda sin filas (dictado en toda su etapa) solo si TODAS las copias de su grupo tienen el grado en NULL, caso que hoy no se da.

**Antes de desplegar en prod**, tres pasos, en este orden:

**1. Respaldo.** `pg_dump` del esquema y de los datos de todo lo que `0023` toca, guardado **fuera del contenedor**. La migración es irreversible salvo desde ese respaldo, así que la lista tiene que estar completa:

```
pg_dump --data-only \
  -t courses -t grade_levels -t topics -t topic_grades \
  -t question_folders -t subtopics -t syllabus_week_maps \
  -t exam_blueprint_rows -t exam_blueprint_template_rows -t generation_jobs \
  "$DATABASE_URL" > 0023-pre.sql
psql "$DATABASE_URL" -c "\copy (select id, topic_id, folder_id, grade_level, tenant_id \
  from questions) to '0023-pre-questions.csv' csv header"
```

`questions` va por `\copy` y no por `pg_dump` porque de sus 67k filas solo hacen falta cinco columnas — `(id, topic_id, folder_id, grade_level, tenant_id)`, las únicas que `0023` puede mover — y `pg_dump` no sabe recortar columnas. **`folder_id` es obligatoria** — el merge de carpetas reasigna `questions.folder_id` a la carpeta que sobrevive, y un respaldo sin esa columna no permite reconstruir en qué carpeta estaba cada pregunta. `courses` y `grade_levels` no se modifican, pero sin ellas el volcado no se puede restaurar en una base limpia (son el destino de las FK y la fuente del `sort_order` que decide la fila canónica).

**2. Ensayo cronometrado.** Restaurar ese volcado en una base de scratch (`createdb exams_0023_dry`, `migrate` hasta `0022`, cargar el dump), correr `0023` ahí y **anotar la sentencia más lenta**:

```
psql "$SCRATCH_URL" --single-transaction --echo-all \
  -c '\timing on' -f apps/api/drizzle/0023_topic_grades.sql 2>&1 | tee 0023-dry-run.log
rg '^Time: ' 0023-dry-run.log | sort -k2 -g -r | head -5
```

`\timing` en vez de `pg_stat_statements`: la extensión necesita `shared_preload_libraries` y este Postgres no la carga. `--single-transaction` importa — sin ella `SET LOCAL` solo emite un warning y no hace nada, y el ensayo no reproduciría la transacción única del migrador.

Es el único número que dice si el deploy real se va a quedar corto: el archivo abre con `SET LOCAL statement_timeout = 0` (las conexiones del pool traen 30 s desde `POOL_STATEMENT_TIMEOUT_MS`), así que ya no aborta por tiempo, pero sí mantiene la tabla `questions` bloqueada mientras corre. Si el peor caso se acerca al minuto, la ventana de mantenimiento deja de ser opcional.

**3. Verificar la estrategia de despliegue en Dokploy.** Tiene que ser **stop-first** (detener el contenedor viejo antes de arrancar el nuevo), no rolling. El entrypoint es `migrate && seed && main` (`infra/docker-compose.dokploy.yml`) y el servicio corre con `replicas: 1`: en un despliegue rolling el contenedor nuevo ejecutaría `0023` mientras el viejo sigue sirviendo tráfico contra un esquema que la migración está borrando — `topics.grade_level` desaparece a mitad de una consulta viva. Con stop-first hay unos segundos de caída y ningún lector concurrente.

## Seed y datos

- `seedStage`: una inserción por tema (`onConflictDoNothing` en `(course_id, name)`) y una fila por grado en `topic_grades` (`onConflictDoNothing` en la PK). Los arreglos `grades: [...]` del seed no cambian de forma.
- `reconcileLegacyTopics` sigue igual pero indexado por `(courseName, name)` sin grado.
- `seed-collected-questions.ts` y `seed-lot-questions.ts`: el mapa de temas pasa a la clave `courseId|topicName`; el `gradeLevel` de la entrada va a `questions.grade_level` y, si falta, se agrega a `topic_grades` (`onConflictDoNothing`).
- `canonical-taxonomy.json` no cambia (nunca tuvo grado).
- `seed-idempotency.spec.ts` indexa por `name` en vez de `name:gradeLevel` y afirma que `topic_grades` tampoco crece en la segunda corrida.

## API

- `TopicListItem` y el DTO web `Topic`: `gradeLevel: string | null` se reemplaza por `gradeLevels: readonly string[]` (ordenado por `sort_order`).
- `GET /topics?gradeLevel=` y `findTopicsByCourseIds(…, gradeLevel)` filtran con `EXISTS (topic_grades)`; sin filtro devuelven todos los temas con su lista de grados (un `array_agg` con `left join`, sin N+1).
- `exams.repository.getTopicsForCourses(courseIds, gradeLevel)` usa el mismo `EXISTS`.
- `GET /bank/questions/summary` y `countByCourseAndTopic` se eliminan: ningún consumidor queda en la web tras las carpetas (`rg` en `apps/web/src` solo encuentra un comentario). `BankTopicQuestionCount` sale de `bank-repository.port.ts`, donde estaba declarada; `packages/shared` no cambia.
- Carpetas: `SeedTopicRow` pierde `gradeLevel`; `folderNameForTopic` y `dedupeSiblingNames` desaparecen porque dos temas de un curso ya no pueden compartir nombre (el `clamp` a 80 caracteres se mantiene). La siembra crea una carpeta por tema, nombre igual al del tema.
- `GRADE_LEVEL_LABELS` se queda en `packages/shared` (lo usa la web); el API deja de generar copy con grado.
- AI (`topicId` + `gradeLevel` independientes) y `validate-question-taxonomy` no cambian.

## Web

- `Topic.gradeLevels` reemplaza a `Topic.gradeLevel` en `taxonomy.models.ts` y en todos los fixtures.
- Selects de Tema (`bank-new`, `exam-builder`, `ai-generate`, `question-taxonomy-fields`): siguen pidiendo `getTopics(courseId, gradeLevel)`; el servidor ya filtra por `topic_grades`, así que dejan de mostrar copias sin que cambie su lógica.
- `bank-new` prefill desde carpeta: si Grado está vacío o no pertenece a `topic.gradeLevels`, se pone el primer grado de la lista; si el tema tiene un solo grado, se pone ese. El hint "El Tema no coincide con la carpeta" no cambia.
- `taxonomy-matcher.ts` no cambia; al no haber copias, el match por nombre deja de ser ambiguo.
- El árbol de carpetas ya no muestra sufijos de grado; `grade-level-labels.ts` deja de ser "contrato" con el API (comentario).

## Tests

API (e2e con Postgres real, `--runInBand`):
- `taxonomy.e2e.spec.ts`: un tema con dos grados sale una vez con `gradeLevels: [a, b]`; `?gradeLevel=a` lo incluye y `?gradeLevel=c` lo excluye; crear dos temas con el mismo nombre en un curso viola la unicidad.
- `bank-folders.e2e.spec.ts`: la siembra crea una carpeta por tema sin sufijo; los fixtures que insertaban "Trigo" x2 por grado pasan a un tema con dos filas en `topic_grades`.
- `bank.e2e.spec.ts`: se retiran los casos del `summary`; el filtro `gradeLevel` del listado sigue probado sobre `questions.grade_level`.
- `exams` e2e: el selector de temas por grado del constructor de exámenes devuelve solo temas dictados en ese grado.
- Migración: un spec `db-serial` que crea, sobre un esquema en el estado `0022`, dos copias por grado con preguntas, carpetas y una fila de syllabus, corre `0023` y afirma el colapso, el re-apuntado, el merge de carpetas y el nombre sin sufijo. Si Drizzle no permite correr una sola migración aislada, el spec aplica la lógica de datos vía el SQL de `0023` extraído a un helper.
- Unit: `build-seed-folder-plan.spec.ts` sin casos de grado; `seed-idempotency.spec.ts` con `topic_grades`.

Web (`ng test`, archivos tocados): fixtures con `gradeLevels`; `bank-new` prefill con un grado y con varios; bank-list sin sufijos.

Navegador (manual al final): árbol del banco sin copias, select de Tema en la subida filtrado por grado, constructor de exámenes por grado.

## Fuera de alcance

- Borrar `subtopics`.
- Fusionar cursos entre etapas o los 27 cursos de preuni.
- Cambiar el eje de grado de las preguntas.
