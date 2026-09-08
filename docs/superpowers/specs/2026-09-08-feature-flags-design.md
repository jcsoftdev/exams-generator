# Feature flags administrados por el superadmin — Diseño

**Fecha:** 2026-09-08
**Estado:** aprobado en conversación, pendiente de plan de implementación.
**Motivación:** hoy toda funcionalidad está encendida para todo colegio. No hay forma de vender planes distintos, ni de apagar un flujo caro cuando el proveedor de IA falla o el costo se dispara. El `platform_admin` (superadmin) necesita dos perillas: un corte de plataforma que aplica a todos, y una concesión por colegio.

## Decisiones tomadas

1. **Dos capas.** Una de plataforma (corte general) y una por tenant (concesión). La de plataforma gana: un flag apagado arriba no se puede encender abajo.
2. **Dos tablas, no una con `tenant_id` nullable.** Se evaluó una sola tabla donde `tenant_id IS NULL` significara "fila de plataforma", imitando la convención que `questions` ya usa para el banco global. **Descartada por un hecho verificado de la librería:** en drizzle-orm 0.33 `.nullsNotDistinct()` existe solo en el constructor de constraint `unique(...).on(...)`; `uniqueIndex()` no lo soporta (cero ocurrencias en `pg-core/indexes.js`, contra `pg-core/unique-constraint.js:18-49`). El patrón que se iba a imitar, `questions.schema.ts`, usa `uniqueIndex` y su comentario **depende** de que los NULL sean distintos. Copiar esa forma haría legales varias filas de plataforma por key, sin que Drizzle ni la migración se quejen, y el resolver leería "la" fila de plataforma de forma no determinista.
3. **El default vive en el catálogo, en código, no en la base.** Cada key declara su `defaultEnabled`. Una fila de tenant existe **solo** cuando alguien decidió algo distinto al default. La migración no siembra nada.
   Se descartó "ausente significa apagado": `TenantsService.create` es un insert pelado sin hook (`tenants.service.ts:46`), el seed crea el tenant demo igual, y 26 specs e2e insertan tenants a mano y después pegan a los endpoints que el guard bloquearía. Ese default dejaba sin nada a todo cliente nuevo, a toda base de datos fresca y a la línea e2e completa de IA y exámenes.
4. **No hay exención de rol.** La capa de plataforma aplica a todos, incluido el `platform_admin`. Lo único que se salta para un usuario sin tenant es la **consulta** de la capa de tenant, porque no hay tenant que consultar.
   Esto importa: `AiController` no tiene `RolesGuard` (`ai.controller.ts:104`, solo `JwtAuthGuard` y el throttler), así que un `content_editor` sí llega a los endpoints de IA y genera directo al banco global. Una exención general habría dejado el corte de plataforma sin efecto justo sobre quien genera a escala.
5. **Solo se gatean las rutas de creación.** Listar, ver, hacer streaming y cancelar quedan siempre abiertas. Apagar un flag no debe secuestrar trabajo ya en vuelo ni datos ya generados.
6. **Los flags viajan en `GET /auth/me`, nunca en el JWT.** Un token no se refresca cuando alguien mueve una perilla.
7. **Los flags no viajan en el DTO de tenant.** `PATCH /tenants/:id` es escribible por `school_admin` (`tenants.controller.ts:78-79`); meterlos ahí los volvería editables por el propio colegio.

## Catálogo

Vive en `packages/shared` como fuente única. La base nunca define qué flags existen, solo su estado.

| Key | `defaultEnabled` | Qué controla |
|---|---|---|
| `global_bank` | `true` | Ver y usar preguntas del banco central (`questions.tenant_id IS NULL`) |
| `ai_generation` | `false` | Generar y revisar preguntas con IA (streaming y jobs) |
| `ai_extraction` | `false` | Extraer preguntas desde foto, OCR y recorte de figuras |
| `exam_versions` | `false` | Generar versiones barajadas de un examen |
| `tenant_branding` | `true` | Logo del colegio impreso en el PDF |

Agregar una key al enum es la única forma de crear un flag, y obliga a declarar su default en el mismo commit.

## Modelo de datos

### `platform_feature_flags`

| Columna | Tipo | Notas |
|---|---|---|
| `key` | `text` | Clave primaria. Valor del enum del catálogo. |
| `enabled` | `boolean` | `NOT NULL` |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `updated_by` | `uuid` | Nullable, FK a `users.id`, `ON DELETE SET NULL` |

Sin columna de tenant, a propósito: el resolver no puede consultar esta tabla con un tenant id por accidente.

### `tenant_feature_flags`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, `defaultRandom()` |
| `tenant_id` | `uuid` | `NOT NULL`, FK a `tenants.id`, `ON DELETE CASCADE` |
| `key` | `text` | Valor del enum del catálogo |
| `enabled` | `boolean` | `NOT NULL` |
| `updated_at` | `timestamptz` | `NOT NULL DEFAULT now()` |
| `updated_by` | `uuid` | Nullable, FK a `users.id`, `ON DELETE SET NULL` |

Índice único normal sobre `(tenant_id, key)`. Sin `NULLS NOT DISTINCT`, sin ramas `isNull()`.

`updated_by` es nullable por una razón concreta: los usuarios se marcan como borrados en `users.repository.ts:64`, pero `TenantsService.remove` sí borra en duro los usuarios del tenant (`tenants.service.ts:145`) y los specs borran usuarios libremente.

### Migración `0024`

Crea las dos tablas y **no siembra ninguna fila**. El journal termina en `0023_topic_grades`, así que `0024` es el número correcto.

`TenantsService.remove` (`tenants.service.ts:101-147`) borra a mano y en orden. Aunque `tenant_feature_flags` declara `ON DELETE CASCADE`, hay que agregarla igual a esa lista para no depender de un cascade que el resto del módulo no usa.

## Regla de resolución

```
usuario CON tenant:
  efectivo(key, tenant) = plataforma(key) AND tenant(key, tenant)

usuario SIN tenant (platform_admin, content_editor):
  efectivo(key) = plataforma(key)

plataforma(key)      fila ausente -> true                      (corte: ausencia = no cortado)
tenant(key, tenant)  fila ausente -> catálogo[key].defaultEnabled
```

Las dos capas tienen defaults distintos y eso es deliberado, no un descuido: arriba la ausencia significa "nadie cortó", abajo significa "nadie decidió, usa el default del producto".

Consecuencia que la UI debe hacer visible: prender el override de un tenant cuya plataforma está cortada deja el valor efectivo en apagado. Por eso el panel de admin muestra los tres valores por separado, y `/auth/me` expone solo el efectivo.

## Servicio y caché

`FeatureFlagsService` es un **singleton** con `Map` en memoria y TTL de 60 segundos más `invalidate()` en cada escritura, copiando la forma de `AccountStatusService` (`account-status.service.ts:15-33`).

No se usa `Scope.REQUEST`. No hay ningún proveedor request-scoped en el API hoy, y meter uno contagiaría el scope a guards, `BankService` y `ExamsService`; `BankService.previewCache` (`bank.service.ts:114-133`) se reconstruiría en cada request. Además los procesadores de BullMQ corren en el mismo proceso Nest sin request alguno (`generation-job-events.service.ts:5-8`), así que un servicio request-scoped simplemente no sería alcanzable desde ahí.

Si producción llega a correr varias instancias, el TTL acota el desfase y el `invalidate()` en memoria es best-effort. Está aceptado.

## Enforcement

| Flag | Dónde se aplica | Rutas gateadas |
|---|---|---|
| `ai_generation` | `@RequiresFeature` en handlers | `POST ai/questions/generate/stream`, `POST ai/questions/:id/revise`, `POST ai/questions/jobs` |
| `ai_extraction` | `@RequiresFeature` en handlers | `POST ai/questions/extract`, `POST ai/questions/extract/:extractionId/crop` |
| `exam_versions` | `@RequiresFeature` en handler | `POST exams/:examId/versions` |
| `tenant_branding` | Dentro de `materializeLogo` | Ninguna ruta |
| `global_bank` | Predicado SQL de visibilidad | Ninguna ruta |

`FeatureFlagGuard` corre después de `JwtAuthGuard` y responde `403` con un cuerpo que nombra la key, para que la web pueda distinguir "no habilitado" de "sin permiso".

**Nunca se gatea a nivel de clase.** En `AiJobsController` un guard de clase dejaría `GET :id`, `GET :id/stream` y `POST :id/cancel` en 403, y el tenant no podría ni mirar ni cancelar el job que sigue quemando presupuesto. Lo mismo en exámenes: `GET :examId/versions` y `GET :examId/versions/zip` siguen abiertos, porque los PDF ya generados son datos del colegio.

Los jobs ya encolados terminan. El procesador lee `getByIdUnscoped` y solo consulta `cancelRequested` entre ítems (`generation-jobs.processor.ts:37-89`); no se le agrega verificación de flag. Apagar `ai_generation` corta el ingreso, no el trabajo en curso.

`tenant_branding` no se resuelve con un guard sobre la subida del logo: un logo ya subido se seguiría imprimiendo. La verificación va en `materializeLogo` (`exam-generation.service.ts:366, 675-679`), que es camino de worker y no tiene request.

## `global_bank`: refactor previo obligatorio

La regla `tenant_id IS NULL OR tenant_id = :current` está copiada a mano unas 11 veces en `bank.repository.ts` (:41, :342, :384, :434, :454, :480, :576, :657, :750, :787, :849), más un `isNull(questions.tenantId)` incrustado en el OR de carpetas en :85. Al lado, `exams.repository.ts:92` tiene la misma regla factorizada en un solo `questionVisibility()` cuyo comentario dice "B1-R7 — must not be duplicated".

Enhebrar un booleano en la forma actual son unos 15 edits. **Primero se construye el punto único, después se mueve la perilla.**

El puerto ya pasa `currentTenantId: string | null` en cada método (`bank-repository.port.ts:129, 173-250`) y `BankService` lo alimenta desde `user.tenantId` en unos 21 sitios. Ese escalar se ensancha a un objeto de alcance:

```ts
type QuestionScope = { tenantId: string | null; includeGlobal: boolean };
```

`BankService` lo calcula una vez, y `bank.repository.ts` gana un `questionVisibility(scope)` con la misma forma que el de exámenes.

Consumidores de la regla, los tres que hay que tocar:

1. `bank.repository.ts` — las 11 copias más el OR de carpetas de :85, que bajo un alcance solo-tenant queda muerto y se elimina.
2. `exams.repository.ts:92` — usado en `getQuestionPool` (:363), `countStock` (:387) y `countApprovedByGradeLevel` (:451). Módulo independiente, alimenta stock, vista previa, resolución de plantilla y reemplazo.
3. `bank-folders.repository.ts:268` `countCentralByTopic` — el contador del árbol de carpetas. **Es el que se olvida:** no pasa por `BankRepository`, lo llama `bank-folders.service.ts:82`.

`dashboard-stats.service.ts:59` queda cubierto: pasa por `countByDifficultyAndStatus`.

### Qué pasa con lo que ya existe

Los exámenes ya armados **se respetan**. El renderizado de versiones une `exam_questions` con `questions` sin predicado de visibilidad (`exams.repository.ts:554-577`), así que un examen que ya seleccionó preguntas centrales las sigue imprimiendo.

Lo que sí cambia al apagar el flag: `POST :examId/questions/:questionId/replace` (`exams.controller.ts:266`) saca candidatos de `getQuestionPool` y ya no encontrará preguntas centrales.

`POST :examId/duplicate` (:290) **no** revalida: `duplicateExam` copia las filas de `exam_questions` tal cual dentro de una transacción (`exams.repository.ts:220-222`), sin predicado de visibilidad. Duplicar un examen viejo, entonces, sí produce una selección nueva que apunta a preguntas centrales con el flag apagado. **Se acepta:** la selección ya es dato del colegio, y bloquear el duplicado rompería "usar de plantilla" sobre exámenes que el colegio armó cuando sí tenía el permiso.

Regla explícita: **lo ya seleccionado queda grandfathered, incluso al duplicarlo. Elegir de cero, no.**

`assets.repository.ts:25-27` deja las imágenes de preguntas globales legibles por id. Es una inconsistencia conocida y aceptada: sin el id de una pregunta que ya no se lista, no hay forma de llegar ahí.

Los scripts de `src/scripts` y `db/seed-*` filtran por `isNull(questions.tenantId)` para **operar sobre** el banco central. No se tocan.

Fuera de alcance de este flag: `exams.repository.ts:918-919` (plantillas globales) y :1043-1044 (ciclos globales) usan la misma convención de tenant nulo para otras entidades. `global_bank` **no** las cubre.

## API

Todo bajo `@Roles(Role.PlatformAdmin)`.

| Ruta | Qué hace |
|---|---|
| `GET /feature-flags/platform` | Catálogo completo con el estado de plataforma de cada key |
| `PUT /feature-flags/platform/:key` | Corta o restaura una key para todos |
| `GET /tenants/:id/feature-flags` | Por key: `{ platform, tenant, effective }` |
| `PUT /tenants/:id/feature-flags/:key` | Escribe el override del tenant. Body `{ enabled }`. |
| `DELETE /tenants/:id/feature-flags/:key` | Borra el override. El tenant vuelve al default del catálogo. |

El `DELETE` existe en vez de resolverlo con un `PUT` al valor del default, porque el sistema debe poder distinguir "vuelve al default" de "apagado explícito". Si mañana cambia el default de una key, el tenant sin fila la sigue, y el que decidió apagarla no.

`MeResponseDto` (`packages/shared/src/dto/me-response.dto.ts:9-15`) gana `features: Record<FeatureFlagKey, boolean>` con el valor efectivo. Hoy ese DTO es un select directo sobre `users` (`auth.service.ts:57-76`); resolver los flags es una segunda consulta ahí.

## Web

**Store de identidad.** Hoy la web deriva rol y tenant del JWT (`core/auth/auth.service.ts:22-33`) y llama a `/auth/me` una sola vez desde `ShellComponent` hacia una señal local del componente (`shell.component.ts:165`). No hay store compartido. Hace falta uno a nivel raíz para que guards de ruta y plantillas lean los flags.

Consecuencia aceptada y que hay que decir en voz alta: **un cambio de flag se propaga en la siguiente carga completa, no al navegar.**

Puntos de consumo:

- `bank-list`: sin `global_bank`, no se ofrecen preguntas del banco central ni el filtro que las distingue.
- `ai`: sin `ai_generation`, la entrada de generación desaparece; sin `ai_extraction`, la de subir foto.
- `exams`: sin `exam_versions`, el botón de generar versiones desaparece; el historial y el ZIP siguen.
- `tenant-settings`: sin `tenant_branding`, la subida de logo desaparece.

**Panel en `admin-tenants`.** Por cada key, los tres valores separados y un control que escribe solo el del tenant. El de plataforma se lee, no se edita desde aquí; tiene su propia pantalla.

`school_admin` ve únicamente booleanos efectivos, nunca la descomposición en capas.

## Fuera de alcance (esta iteración)

- Impersonación o "ver como este colegio". No existe hoy en el repo (`rg impersonat|viewAs|actAs` no da resultados) y no se agrega aquí.
- Historial de cambios de flags más allá de `updated_at` y `updated_by`.
- Propagación en vivo por websocket. La siguiente carga alcanza.
- Flags por usuario. El alcance mínimo es el colegio.

## Errores y bordes

- Key desconocida en cualquier ruta: `400`, no `404`. La key es un valor de enum, no un recurso.
- Escribir el override de un tenant que no existe: `404`.
- Filas huérfanas con una key retirada del catálogo: el resolver las ignora. Retirar una key requiere una migración de limpieza en el mismo commit.
- Apagar `global_bank` mientras un profesor tiene el banco abierto: la siguiente request devuelve solo lo del tenant. No hay error, la lista se acorta.

## Lo que la implementación agregó al diseño

Tres cosas que no estaban en el diseño y que el código obligó a resolver.

**`AuthModule` importa `FeatureFlagsModule` explícitamente.** `@Global` solo significa "no hace falta importarlo una vez que está en el grafo", y `auth.e2e.spec.ts` arma su módulo de prueba con `AuthModule` solo. Como `AuthService.me()` resuelve los flags, sin ese import Nest ni siquiera puede construir `AuthService` y la suite entera de auth muere en el arranque.

**Las suites e2e necesitan `grantFeaturesFixture(tenantId)`.** Es el costo real del default apagado, y conviene decirlo sin adornos: cada suite que inserta su propio tenant y llama a una ruta de IA o de formas recibe 403 antes de llegar a lo que venía a probar. El helper vive en `test-utils/db-fixtures.ts` y escribe las filas directo a la tabla.

Eso último tiene una regla de tiempo que hay que respetar. `FeatureFlagsService` cachea cada capa 60 segundos y solo suelta ese caché en sus propias escrituras, así que escribir filas a mano es seguro únicamente en `beforeAll`, antes del primer request, con el caché todavía vacío. Una suite que necesite mover un flag a mitad de camino tiene que pasar por las rutas HTTP.

**`GET /auth/me` cambió de contrato.** El cuerpo ahora trae `features`, y los dos tests de auth que comparaban el objeto completo se actualizaron. No es un detalle de test: cualquier consumidor que valide la forma exacta de esa respuesta ve un campo nuevo.

## Tests

Test rojo primero, y a nivel de feature: e2e con supertest contra el Nest real y el Postgres real en el API, spec de componente por TestBed en la web. Unitario solo para el resolver puro.

- **Resolver puro:** matriz de las dos capas por sus dos ausencias, más el caso de usuario sin tenant.
- **e2e por flag apagado:** cada ruta de creación responde `403`; cada ruta de lectura, streaming y cancelación sigue respondiendo `200`.
- **e2e de `global_bank`:** un tenant con el flag apagado no ve preguntas centrales en el banco, ni en el pool de exámenes, ni en el contador del árbol de carpetas. Con el flag prendido, las tres las ven.
- **e2e de grandfathering:** un examen armado antes de apagar el flag sigue renderizando sus preguntas centrales.
- **e2e de precedencia:** override de tenant en `true` con plataforma en `false` da efectivo `false`, y `/auth/me` lo refleja.
- **e2e de tenant nuevo:** un tenant creado sin filas recibe exactamente los defaults del catálogo.
- **e2e de borrado de tenant:** borrar un tenant con overrides no revienta.
- **Web:** cada punto de consumo esconde su entrada con el flag apagado; el panel de admin muestra las tres capas.
- **Contrato de `/auth/me`:** el cuerpo trae `features` con las cinco keys, siempre completo.

Las suites del API corren con `--runInBand`, y el filtro de ruta va **antes** de `--selectProjects`.
