# Diseño — Tipos de examen, universidades y tracks ("mis exámenes")

**Fecha:** 2026-07-21
**Estado:** Borrador — pendiente de aprobación
**Alcance:** Restructurar la creación de exámenes para soportar tipos por defecto (Manual, Fastest, ETA, ETA por semana) respaldados por catálogos de Universidad/Track/plantilla de examen, generalizado para ser resiliente a cualquier tipo de examen futuro, sin tocar el pipeline de selección/generación existente (`blueprint-selector.ts`, `exam_blueprint_rows`, `exam_questions`, `exam_versions`).

---

## 1. Propósito

Hoy "Mis exámenes" solo tiene un flujo: título libre + `gradeLevel` + filas de blueprint armadas a mano (curso/tema/dificultad/cantidad). Cero noción de universidad, agrupación, o "qué semana del ciclo estamos". El pedido es agregar **tipos de examen** que aceleren la creación:

- **Manual** — flujo actual, sin cambios.
- **Fastest** — el usuario elige curso(s), el sistema trae preguntas de los temas de la **semana activa** del ciclo.
- **ETA** (Examen Tipo Admisión) — examen completo, todo el temario del track.
- **ETA por semana** — como ETA pero acumulativo: solo temas de la semana 1 hasta la semana activa (no el ciclo completo).

Estos tres últimos se apoyan en **plantillas por Universidad + Track** (curso, peso, tema→semana) que la app trae por defecto (investigadas para UNI y UNCP) pero el tenant puede editar. **No son fuente de verdad** — son un punto de partida reusable. El usuario siempre puede crear un examen 100% manual sin tocar plantillas.

El objetivo explícito de este diseño es **resiliencia**: soportar cualquier tipo de examen futuro y cualquier forma de agrupación universitaria (área por carrera, ciclo de preparación, o lo que aparezca) sin rediseñar el schema cada vez.

## 2. Research — hallazgos que definen el modelo

Investigación con fuentes primarias .edu.pe (cacheada en `web-research` MCP, slugs `peru-university-admissions/uni-cepre-admission-syllabus` y `peru-university-admissions/uncp-ceprunc-admission-syllabus`):

|                        | UNI (CEPRE-UNI)                                                                                                                                                                                                                                                                                                                  | UNCP (CEPRUNC)                                                                                                                                                                            |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Agrupación             | **Sin áreas por carrera** — 28 especialidades bajo ~12 facultades, currícula uniforme. Pero SÍ tiene **tracks de preparación distintos**: Ciclo Básico (8 cursos, sin Humanidades, 21 semanas) vs Ciclo Preuniversitario (9 cursos, con Humanidades, 20 semanas) vs Intensivo I/II — cada uno con curso-set y calendario propio. | **5 áreas por carrera**: I Salud, II Ingenierías y Arquitectura, III Administrativas/Contables/Económicas, IV Sociales y Educación, V Agrarias                                            |
| Batería de examen      | E1 (Aptitud+Humanidades, 745pts) + E2 (Matemática, 600pts) + E3 (Física y Química, 500pts) = 1845pts, uniforme para todos. **Puntos, no cantidad de preguntas por curso** — el reglamento no publica un desglose de Nº de preguntas por curso, solo pesos por sección.                                                           | Actual (2026-II): 80 preguntas por área, con **Nº de preguntas exacto por curso y por NIVEL** (P.B./P.I./P.A.) — tabla completa de las 5 áreas extraída de Anexo 7 del prospecto oficial. |
| Ciclo                  | 20-21 semanas según track, oficial                                                                                                                                                                                                                                                                                               | No confirmado (no encontrado)                                                                                                                                                             |
| Sílabo semana-a-semana | **Sí, completo** para el track Ciclo Preuniversitario — 9 cursos evaluados, Semana 00-20. RM (Razonamiento Matemático) se evalúa aparte pero **no tiene sílabo propio** — sus temas están etiquetados dentro de las semanas de Aritmética/Álgebra/Geometría.                                                                     | **No existe públicamente** — Anexo 6 es catálogo plano de temas por curso (sin semana), no cronograma. Confirmado ausente tras dos pasadas de research.                                   |

**Implicaciones directas:**

1. La agrupación secundaria (antes llamada "Area") no es siempre "área por carrera" — para UNI es "track de preparación". El modelo necesita un concepto genérico que cubra ambos casos sin forzar la semántica de uno sobre el otro.
2. UNCP da conteo de preguntas real; UNI solo da pesos en puntos. No podemos asumir que siempre habrá un `question_count` confiable.
3. UNCP diferencia NIVEL por fila (P.B./P.I./P.A.) — el modelo tiene que soportar múltiples filas por curso con distinta dificultad de origen, y esa distinción tiene que sobrevivir hasta el momento de generar el examen (si no, se pierde la fidelidad de la mezcla real).

## 3. Decisiones de diseño (las que evitan deuda técnica)

1. **`tracks` generaliza "área por carrera" y "ciclo de preparación" en un solo concepto.** Es la agrupación secundaria opcional bajo una universidad — puede representar cualquiera de las dos cosas (o algo distinto que aparezca a futuro); un campo `kind` puramente descriptivo (`'area'` | `'cycle_track'` | lo que haga falta) solo ayuda a la UI a rotular correctamente, no cambia el comportamiento de resolución. UNI: 3-5 filas tipo `cycle_track` (Básico, Preuniversitario, Intensivo I/II). UNCP: 5 filas tipo `area`.
2. **Plantillas append-only, nunca mutadas en sitio.** Cada plantilla vigente tiene `is_current = true`; al actualizar datos se inserta fila nueva y se apaga la anterior. Un examen generado en enero sigue apuntando a la versión de datos que realmente usó.
3. **`currentWeek` se calcula, no se guarda.** `cycles` solo persiste `starts_on` + `week_length_days`; la semana activa es `floor((hoy - starts_on) / 7)`, función pura, sin cron. El examen generado sí **congela** `week_number` al momento de crearse (auditoría inmutable).
4. **`cycles` desacoplado de la versión de plantilla.** Un ciclo (calendario) referencia `university_id` + `track_id?`, NO un `template_id` específico. El calendario y la tabla de ponderación tienen ciclos de vida distintos — el calendario casi no cambia, la tabla de ponderación se puede revisar cada admisión. Al generar, el template vigente se resuelve aparte (`WHERE is_current=true`). Esto también evita que una academia con 5 áreas UNCP tenga que duplicar 5 filas de `cycles` idénticas solo para compartir la misma fecha de inicio — puede usar `track_id = NULL` si su calendario es el mismo para todas las áreas, o una fila por track si de verdad difieren.
5. **`question_count` es nullable; `weight_points` es el dato primario cuando no hay conteo real.** UNI solo da puntos por sección (E1/E2/E3), no conteo por curso — forzar `question_count NOT NULL` ahí sería inventar un número. El resolver usa `question_count` si existe; si no, deriva proporción desde `weight_points`.
6. **Nivel/sección de origen (P.B./P.I./P.A. de UNCP, E1/E2/E3 de UNI) se guarda crudo en `source_level`, sin forzarlo al `difficulty` (easy/medium/hard) existente** — la columna cruda queda lista para un futuro sistema de calibración por universidad (RAG), sin perder señal ahora. **Pero el resolver SÍ necesita un valor de dificultad utilizable en el momento de generar** (si no, `blueprint-selector.ts` no puede distinguir dos filas del mismo curso con NIVEL distinto — verían el mismo pool y competirían por las mismas preguntas, perdiendo la mezcla real). Fix: una función pura de dominio, `resolveDifficultyFromSourceLevel(sourceLevel)`, vive junto al resolver — traduce el crudo a `easy`/`medium`/`hard` **solo al armar el `BlueprintRow` transitorio**, nunca escribe de vuelta a la DB. Así el dato queda lossless y el resolver funciona.
7. **Mismo patrón `tenant_id` nullable que ya usan `questions`/`assets`/`users`** (`tenant_id IS NULL OR = actual`) para `exam_blueprint_templates` y `cycles`. Default global editable por tenant vía fila-override.
8. **Cero cambios a `exam_blueprint_rows` / `exam_questions` / `exam_versions` / `blueprint-selector.ts`.** Las tablas nuevas son un "resolver" upstream que produce filas con la misma forma de siempre.
9. **`exam_types` es data-driven, no una función bespoke por tipo** (ver §5) — agregar un tipo nuevo que sea combinación de ejes existentes es un insert, cero código.
10. **RM (Razonamiento Matemático) es su propio `course_id` en nuestro banco**, aunque el temario oficial de UNI no le dé sílabo propio (sus temas viven dentro de Aritmética/Álgebra/Geometría). Motivo: `blueprint-selector.ts` matchea por `course_id` exacto (`matchesRow()`) — una fila con `course_id=RM` no podría reusar topics de otro curso sin romper ese matching. Es una divergencia consciente del temario oficial, documentada, no un bug.
11. **Un único flujo de creación de examen.** Los tipos `fastest`/`eta`/`eta_by_week` pre-llenan el mismo builder manual de blueprint que ya existe — no son pantallas nuevas.

## 4. Modelo de datos

Todas las tablas nuevas usan `uuid("id").primaryKey().defaultRandom()` salvo donde se indique.

### `universities` — catálogo global, sin `tenant_id` (igual que `courses`)

```
id      uuid PK
code    text NOT NULL UNIQUE   -- "uni", "uncp"
name    text NOT NULL
active  boolean NOT NULL DEFAULT true
```

### `tracks` — catálogo global, opcional por universidad (generaliza área-por-carrera y ciclo-de-preparación)

```
id             uuid PK
university_id  uuid NOT NULL REFERENCES universities.id
code           text NOT NULL   -- "I".."V" (UNCP) o "basico"/"preuniversitario"/"intensivo_1" (UNI)
name           text NOT NULL   -- "Ciencias de la Salud" / "Ciclo Preuniversitario"
kind           text NOT NULL   -- 'area' | 'cycle_track' — solo descriptivo para la UI, no filtra nada
UNIQUE (university_id, code)
```

Universidad sin necesidad de agrupación: cero filas de `tracks`, todo lo demás usa `track_id = NULL`.

### `exam_types` — catálogo sembrado, data-driven (ver §5)

```
code           text PRIMARY KEY   -- "manual" | "fastest" | "eta" | "eta_by_week"
label          text NOT NULL
course_scope   text NOT NULL      -- 'none' | 'all' | 'selected'
week_scope     text NOT NULL      -- 'none' | 'current_only' | 'cumulative'
sort_order     integer NOT NULL UNIQUE
```

### `exam_blueprint_templates` — la "receta" de curso+peso para (universidad, track?)

```
id               uuid PK
university_id    uuid NOT NULL REFERENCES universities.id
track_id         uuid REFERENCES tracks.id            -- nullable
tenant_id        uuid REFERENCES tenants.id            -- nullable: NULL = default global, set = override del tenant
cycle_label      text NOT NULL                         -- "2026-II" — de dónde salió esta data, texto libre
is_current       boolean NOT NULL DEFAULT true
created_at       timestamptz NOT NULL DEFAULT now()
```

**Nota de implementación — unicidad con columnas nullable:** un `UNIQUE` normal sobre `(university_id, track_id, tenant_id)` no funciona como se espera en Postgres porque `NULL <> NULL` (dos filas con `track_id NULL` no chocan). Usar un índice único parcial sobre una expresión con `COALESCE`:

```sql
CREATE UNIQUE INDEX exam_blueprint_templates_current_idx
  ON exam_blueprint_templates (
    university_id,
    COALESCE(track_id, '00000000-0000-0000-0000-000000000000'::uuid),
    COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  WHERE is_current = true;
```

(el mismo patrón aplica a `cycles`, ver abajo).

### `exam_blueprint_template_rows` — filas curso/tema/peso dentro de una plantilla

```
id               uuid PK
template_id      uuid NOT NULL REFERENCES exam_blueprint_templates.id
course_id        uuid NOT NULL REFERENCES courses.id
topic_id         uuid REFERENCES topics.id      -- nullable, igual que exam_blueprint_rows
question_count   integer                         -- nullable — "Nº Preg" real (UNCP). NULL cuando la fuente solo da puntos (UNI)
weight_points    numeric                         -- dato primario cuando no hay question_count — "ponderado"/puntaje (UNCP) o puntaje E1/E2/E3 (UNI)
exam_section     text                             -- nullable — "E1"/"E2"/"E3" (UNI) o "área curricular" (UNCP), solo descriptivo
source_level     text                             -- nullable — NIVEL crudo (P.B./P.I./P.A.), sin mapear (ver §3.6)
CHECK (question_count IS NOT NULL OR weight_points IS NOT NULL)
```

### `syllabus_week_maps` — tema→semana, opcional (existe para UNI, no para UNCP)

```
id            uuid PK
template_id   uuid NOT NULL REFERENCES exam_blueprint_templates.id
course_id     uuid NOT NULL REFERENCES courses.id
topic_id      uuid NOT NULL REFERENCES topics.id
week_number   integer NOT NULL     -- 0-based, "Semana 00" de UNI
UNIQUE (template_id, topic_id)
```

`eta_by_week` solo está disponible para un `template_id` si `EXISTS` al menos una fila acá. Si no hay filas (caso UNCP hoy), la UI no ofrece esa opción para esa plantilla.

### `cycles` — tracking de semana activa, global por defecto, override por tenant, desacoplado de la versión de plantilla

```
id                uuid PK
tenant_id         uuid REFERENCES tenants.id      -- nullable: NULL = ciclo global compartido, set = calendario propio del tenant
university_id     uuid NOT NULL REFERENCES universities.id
track_id          uuid REFERENCES tracks.id        -- nullable
label             text NOT NULL      -- "Ciclo 2026-II"
starts_on         date NOT NULL
week_length_days  integer NOT NULL DEFAULT 7
is_active         boolean NOT NULL DEFAULT true
```

Mismo patrón de índice único parcial con `COALESCE` que `exam_blueprint_templates`, sobre `(tenant_id, university_id, track_id) WHERE is_active`.
`currentWeek` NO es columna — se deriva en dominio: `floor((today - starts_on) / week_length_days)`.

### Columnas nuevas en `exams` (existente)

```
exam_type      text NOT NULL DEFAULT 'manual' REFERENCES exam_types.code
university_id  uuid REFERENCES universities.id   -- nullable, solo si vino de plantilla
track_id       uuid REFERENCES tracks.id         -- nullable
cycle_id       uuid REFERENCES cycles.id         -- nullable, solo eta_by_week
week_number    integer                            -- nullable, snapshot congelado al generar (§3.3)
```

Metadata de **cómo se produjo** el blueprint — el contenido real sigue viviendo en `exam_blueprint_rows`/`exam_questions`, sin cambios.

## 5. Cómo escala a cualquier tipo de examen futuro

`exam_types` es **data-driven**: cada tipo es una combinación de ejes, no una función a medida.

```
course_scope: 'none' (manual, sin plantilla) | 'all' (todo el track) | 'selected' (el usuario elige curso(s))
week_scope:   'none' (sin filtro de semana) | 'current_only' (solo semana activa) | 'cumulative' (semana 1..activa)
```

Seed inicial:

| code          | course_scope | week_scope   |
| ------------- | ------------ | ------------ |
| `manual`      | none         | none         |
| `fastest`     | selected     | current_only |
| `eta`         | all          | none         |
| `eta_by_week` | all          | cumulative   |

**Un único resolver genérico**, no cuatro funciones:

```
resolveBlueprint(examType, template, currentWeek?, courseSelection?) → BlueprintRow[]
```

Lee `course_scope`/`week_scope` del `exam_types` del examen, filtra `exam_blueprint_template_rows` (por curso si `course_scope='selected'`) y cruza con `syllabus_week_maps` según `week_scope`. Cada fila resultante pasa por `resolveDifficultyFromSourceLevel()` (§3.6) antes de convertirse en `BlueprintRow`.

**Agregar un tipo nuevo que sea combinación de ejes existentes = 1 insert en `exam_types`, cero código.** Ejemplo: "simulacro final" (`all` + `none`, igual que `eta` pero con otro `cycle_label`/plantilla) no necesita nada nuevo.

**Cuando aparezca un eje genuinamente nuevo** (ej. `difficulty_scope: 'weak_topics_only'` para un futuro "examen de refuerzo" basado en desempeño), se agrega como columna nueva a `exam_types` (nullable, default que preserva el comportamiento actual) y una rama nueva en el resolver — el resto del modelo no se toca. Esto es lo que hace al diseño resiliente sin necesitar adivinar hoy todos los tipos futuros.

## 6. Fuera de alcance (explícitamente, por pedido del usuario)

- **Sistema RAG / calibración de dificultad por universidad**: el diseño deja el dato crudo (`source_level`) sin destruir; la traducción a `difficulty` es transitoria en el resolver (§3.6), no persistida. No se construye ninguna tabla de calibración ahora, pero `questions.id` (UUID estable) permite enganchar una futura `question_calibrations` (question_id, university_id, track_id?, señal) sin migrar nada existente.
- **Cronograma semanal de UNCP**: no existe públicamente. `eta_by_week` no estará disponible para plantillas UNCP hasta que se cargue manualmente o aparezca una fuente.

## 7. Fases de implementación (sub-proyectos independientes)

1. **Catálogo base**: `universities`, `tracks`, `exam_types` + seed UNI (tracks: básico/preuniversitario/intensivo) y UNCP (tracks: áreas I-V) + corregir el comment desactualizado en `exams.models.ts` (taxonomy ya existe, ver `taxonomy.controller.ts`).
2. **Plantillas y datos**: `exam_blueprint_templates`, `exam_blueprint_template_rows`, `syllabus_week_maps` + seed con la data investigada (UNI: 15 tablas semana-a-semana del track Ciclo Preuniversitario; UNCP: Anexo 7 completo, 5 áreas).
3. **Ciclos**: `cycles` + cálculo de `currentWeek` en dominio + UI para que el tenant configure su propio calendario si no quiere el global.
4. **Wiring del flujo de generación**: columnas nuevas en `exams`, resolver genérico data-driven (§5), `resolveDifficultyFromSourceLevel()`, UI de selección de tipo que pre-llena el blueprint builder existente.

Cada fase es spec → plan → implementación por separado.

## 8. Preguntas abiertas / asunciones a validar

- Fecha de inicio (`starts_on`) del ciclo global por defecto: usar la fecha oficial 2026-II de cada universidad (UNI Ciclo Preuniversitario: 05 marzo; UNCP: sin cronograma público — necesita definirse manualmente o usar fecha de examen conocida, 08-09 agosto 2026, como ancla).
- Los otros tracks de UNI (Básico, Intensivo I/II) solo tienen calendario confirmado, no sílabo semana-a-semana extraído todavía — el track Ciclo Preuniversitario es el único con data completa hoy. Se puede sembrar solo ese primero y agregar los demás después sin cambios de schema.
