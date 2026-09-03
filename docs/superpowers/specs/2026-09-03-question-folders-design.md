# Carpetas de preguntas por colegio — Diseño

**Fecha:** 2026-09-03
**Estado:** aprobado en conversación, pendiente de plan de implementación.
**Motivación:** el profesor necesita subir preguntas a un lugar ordenado, tipo Drive: `Matemática > Trigonometría > Longitud de arco y sector circular`. Hoy el banco solo ofrece la taxonomía global de dos niveles (Curso → Tema), fija y de solo lectura.

## Decisiones tomadas

1. Las carpetas son **propias de cada colegio** (tenant). La taxonomía global (`courses` → `topics` → `subtopics`) no cambia y sigue siendo la clasificación oficial que usan la generación de exámenes y la IA.
2. Cada colegio recibe un **set por defecto** sembrado desde la taxonomía. Puede crear, renombrar, mover y borrar carpetas libremente.
3. Borrar una carpeta muestra una **alerta de confirmación**. Al confirmar se borra el subárbol solo para ese colegio. **Ninguna pregunta se borra del banco**: las propias del colegio quedan sin carpeta y las del banco central dejan de verse en ese árbol.
4. Las preguntas del banco central (`questions.tenant_id IS NULL`) no pueden pertenecer a la carpeta de un colegio; se muestran dentro de la carpeta cuyo `topic_id` coincide con su Tema.
5. Descartado: `parent_id` en `topics`. Rompería los índices únicos `(course_id, name, grade_level)`, la agrupación del resumen del banco, `buildQuestionTree`, el seed y mezclaría lo global con lo de cada colegio.

## Modelo de datos

### Tabla nueva `question_folders`

| Columna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | `defaultRandom()` |
| `tenant_id` | uuid FK `tenants.id` NOT NULL | `ON DELETE CASCADE` |
| `parent_id` | uuid FK `question_folders.id` NULL | NULL = carpeta raíz. `ON DELETE CASCADE` para que borrar un padre borre el subárbol en la DB. |
| `name` | text NOT NULL | 1–80 caracteres tras `trim()` |
| `topic_id` | uuid FK `topics.id` NULL | Solo en carpetas sembradas desde un Tema. `ON DELETE SET NULL`. |
| `position` | integer NOT NULL DEFAULT 0 | Orden entre hermanos. Las sembradas siguen el orden del seed; las nuevas van al final. |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

Índices:

- Único `(tenant_id, parent_id, name)`. Postgres trata `NULL` como distinto en índices únicos, así que la unicidad de raíces se garantiza con un índice único parcial adicional `(tenant_id, name) WHERE parent_id IS NULL`.
- Único parcial `(tenant_id, topic_id) WHERE topic_id IS NOT NULL`: un Tema solo puede estar enlazado a una carpeta por colegio; así una pregunta central aparece en un único lugar.
- Índice `(tenant_id, parent_id)` para cargar hijos.

### `questions.folder_id`

`uuid FK question_folders.id NULL`, `ON DELETE SET NULL`. Solo tiene sentido en preguntas con `tenant_id` no nulo; el servicio rechaza asignar carpeta a una pregunta central (422 `central_question_has_no_folder`) y rechaza carpetas de otro tenant (404, no 403, para no revelar existencia).

Profundidad máxima: **6 niveles**. El servicio la valida al crear o mover (422 `folder_depth_exceeded`). Mover una carpeta dentro de sí misma o de uno de sus descendientes es 422 `folder_cycle`.

### Migración

`pnpm --filter @exams-generator/api db:generate` produce `drizzle/0022_*.sql` a partir del schema. Se revisa a mano que incluya los dos índices únicos parciales (drizzle-kit 0.24 los soporta vía `.where(sql\`...\`)` en `uniqueIndex`); si no, se agregan en el SQL generado.

## Siembra por defecto

Se hace **al vuelo**: la primera vez que un tenant llama `GET /bank/folders` y no tiene ninguna fila en `question_folders`, el servicio siembra dentro de una transacción y luego responde. No hay job ni cambio en la creación de tenants. Un tenant que borre todas sus carpetas vuelve a recibir el set por defecto en la siguiente carga; para evitarlo se guarda un marcador: la siembra solo corre si `tenants.folders_seeded_at IS NULL`, y se marca al terminar. (Columna nueva en `tenants`, `timestamptz NULL`.)

Forma del árbol sembrado:

```
Colegio                      (raíz, position 0)
  Matemática                 (curso de stage "colegio")
    Trigonometría: razones e identidades (4°)   topic_id = …
    Trigonometría: razones e identidades (5°)   topic_id = …
Preuniversitario             (raíz, position 1)
  Trigonometría
    Longitud de arco y sector circular          topic_id = …
Escuela                      (raíz, position 2)
```

- Un nodo raíz por `stage` que tenga cursos. Etiquetas: `escuela` → "Escuela", `colegio` → "Colegio", `preuniversitario` → "Preuniversitario".
- Bajo cada raíz, una carpeta por `courses` de ese stage, en orden alfabético.
- Bajo cada curso, una carpeta por fila de `topics`, con `topic_id`. Cuando dos temas del mismo curso comparten nombre y difieren solo en `grade_level`, el nombre lleva el sufijo de grado que ya aplica `buildQuestionTree` en la web (`bank-question-tree.ts`); la misma regla se implementa en el API para que el nombre sembrado sea el mismo que hoy se ve.
- `subtopics` no se siembran: la web no los usa y el ejemplo del usuario se cubre con curso → tema.

## API

Módulo nuevo `apps/api/src/modules/bank/folders/` (dentro del módulo bank para reusar guards y repositorio de preguntas). Todas las rutas requieren usuario autenticado con `tenantId`; un usuario sin tenant recibe 403 `tenant_required`.

| Ruta | Efecto |
|---|---|
| `GET /bank/folders` | Árbol completo del tenant con conteos. Siembra si corresponde. |
| `POST /bank/folders` | Body `{ name, parentId? }`. 201 con el nodo. 409 `folder_name_taken` si el nombre ya existe entre hermanos. |
| `PATCH /bank/folders/:id` | Body `{ name?, parentId? }`. Renombra o mueve. `parentId: null` lo vuelve raíz. |
| `DELETE /bank/folders/:id` | Borra el subárbol. 200 con `{ deletedFolders, unfiledQuestions }` para que la UI muestre el resultado. |
| `PATCH /bank/questions/:id` (existente) | Acepta `folderId` opcional. Valida tenant y tipo de pregunta. |
| `POST /bank/questions/structured` y `POST /bank/questions/image` (existentes) | Aceptan `folderId` opcional. |

Respuesta de `GET /bank/folders`:

```ts
interface BankFolderNode {
  id: string;
  name: string;
  parentId: string | null;
  topicId: string | null;
  position: number;
  ownCount: number;      // preguntas del colegio con folder_id = id
  centralCount: number;  // preguntas centrales cuyo topic_id = topic_id de la carpeta
  children: BankFolderNode[];
}
interface BankFoldersResponse {
  folders: BankFolderNode[];  // raíces ordenadas por position
  unfiledCount: number;       // preguntas del colegio con folder_id IS NULL
}
```

Los conteos son directos (no acumulados); la web suma hacia arriba. Se calculan con dos consultas agrupadas (`GROUP BY folder_id` y `GROUP BY topic_id` sobre centrales) y se pegan en memoria; el árbol se arma en memoria a partir de la lista plana, igual que hace hoy `buildQuestionTree`.

Listado de preguntas: `GET /bank/questions` acepta `folderId`. El repositorio traduce a `(questions.folder_id = :id) OR (questions.tenant_id IS NULL AND questions.topic_id = :topicIdDeLaCarpeta)`. El filtro `topicId` actual se mantiene para exam-builder y IA. `GET /bank/questions?folderId=unfiled` devuelve las propias sin carpeta.

`GET /bank/questions/summary` no cambia; lo siguen usando exam-builder y la IA. La web del banco deja de llamarlo y usa `GET /bank/folders`.

Borrado: en una transacción, `UPDATE questions SET folder_id = NULL WHERE folder_id IN (subárbol)`, luego `DELETE` de la raíz del subárbol (el `CASCADE` hace el resto). El subárbol se obtiene con un `WITH RECURSIVE`.

DTOs compartidos en `packages/shared/src/dto/bank-folder.dto.ts` (`BankFolderNode`, `BankFoldersResponse`, `CreateBankFolderDto`, `UpdateBankFolderDto`, `DeleteBankFolderResponse`). Los códigos de error nuevos van al enum de errores del bank que ya existe.

## Web

### Dependencia

`@angular/cdk@^22` (misma major que `@angular/core`). Solo se importan `CdkTreeModule` y, más adelante, `DragDropModule`.

### `ui-folder-tree` (`apps/web/src/app/ui/folder-tree/`)

Primitiva presentacional sobre `cdk-tree` con `childrenAccessor`. Entradas: `nodes`, `selectedId`, `expandedIds`, `mode: 'browse' | 'pick'`. Salidas: `select`, `toggle`, `create`, `rename`, `remove`. En modo `pick` no muestra acciones ni conteos centrales. Muestra el conteo acumulado (`ownCount + centralCount` del subárbol) a la derecha del nombre.

Accesibilidad la da el CDK: `role="tree"`, `aria-level`, `aria-expanded`, flechas, Home/End. El toggle es un `<button cdkTreeNodeToggle>`. Se agregan: `aria-label` en el toggle ("Expandir Matemática"), y Delete/F2 como atajos opcionales para eliminar/renombrar (con el mismo modal de confirmación).

Nodo virtual "Sin carpeta" al final de las raíces cuando `unfiledCount > 0`; no es editable.

### Banco (`bank-list`)

- El árbol Curso → Tema se reemplaza por `ui-folder-tree` alimentado por un `BankFoldersStore` (signals) que llama `GET /bank/folders` y expone `select`, `create`, `rename`, `remove`, con actualización optimista y rollback en error.
- Seleccionar una carpeta lista sus preguntas con `folderId`. La búsqueda por texto sigue global.
- Menú por carpeta (botón "⋯" con `aria-haspopup`): "Nueva subcarpeta", "Renombrar", "Eliminar". Crear y renombrar editan en línea en el nodo (input con Enter/Escape). Eliminar abre `ui-modal` con el copy: **"Se quitará la carpeta «Trigonometría» y sus 37 preguntas dejarán de verse aquí. Las preguntas no se borran del banco."** Botones "Cancelar" y "Quitar carpeta".
- Tras eliminar, banner "Carpeta quitada. 12 preguntas quedaron en Sin carpeta." con enlace a ese nodo (solo si `unfiledQuestions > 0`).
- Detalle de pregunta: campo "Carpeta" con `ui-folder-tree` en modo `pick` dentro de un popover, solo para preguntas del colegio. Guardar llama `PATCH /bank/questions/:id`.
- `bank-question-tree.ts` y su spec se eliminan cuando nada más los use; `group-rows-by-course.ts` (exam-builder) no cambia.

### Subida (`bank-new`)

- Campo nuevo arriba de Curso/Tema en ambos tabs: "Carpeta" con el selector en modo `pick`. Recordar la última carpeta elegida en `sessionStorage` para subir varias seguidas.
- Al elegir una carpeta con `topicId`, se precargan Curso y Tema y se marcan como derivados de la carpeta. Si el usuario los cambia a mano, la carpeta se mantiene (una carpeta puede agrupar temas mixtos) y aparece el hint "El Tema no coincide con la carpeta".
- Si la carpeta no tiene `topicId`, Curso/Tema se eligen como hoy. La sugerencia de la IA (`resolveStructuredTaxonomy`) solo rellena Curso/Tema cuando la carpeta no los fijó.
- El guardado envía `folderId` en `POST /bank/questions/structured` y en `POST /bank/questions/image`.

### Dirección visual

Se aplica la skill `frontend-design` al árbol y sus estados (vacío, carga, edición en línea, hover con acciones), respetando tokens y primitivas de `apps/web/src/app/ui/`. Nada de cards anidadas; la jerarquía la da la indentación del árbol y una línea guía vertical tenue por nivel.

## Fuera de alcance (esta iteración)

- Arrastrar y soltar carpetas o preguntas. El CDK lo permite; se agrega después con `DragDropModule` cuando el modelo esté estable.
- Carpetas para el banco central (los admins centrales siguen viendo Curso → Tema).
- Sembrar `subtopics`.
- Compartir carpetas entre colegios.

## Errores y bordes

- Nombre vacío o >80 caracteres: 422 `folder_name_invalid`.
- Nombre repetido entre hermanos: 409 `folder_name_taken`; la UI marca el input en línea.
- Mover a un descendiente: 422 `folder_cycle`.
- Profundidad >6: 422 `folder_depth_exceeded`.
- Carpeta de otro tenant o inexistente: 404 `folder_not_found`.
- Dos pestañas: si un `PATCH`/`DELETE` devuelve 404 porque otra pestaña borró la carpeta, la UI recarga el árbol y avisa.
- Siembra concurrente: la transacción de siembra toma `SELECT ... FOR UPDATE` sobre la fila del tenant; la segunda petición ve `folders_seeded_at` y no siembra.

## Tests

API (e2e con Postgres, MinIO y Redis reales, `--runInBand` como el resto):

- `GET /bank/folders` de un tenant nuevo siembra raíces por stage, cursos y temas con `topic_id`; segunda llamada no duplica; tenant B no ve las carpetas de A.
- Crear, renombrar, mover, ciclo, profundidad, nombre repetido.
- Borrar un subárbol con preguntas propias y centrales: propias quedan `folder_id NULL`, centrales intactas, respuesta con conteos, tenant B intacto.
- `GET /bank/questions?folderId=` mezcla propias y centrales de la carpeta; `unfiled` solo propias.
- `PATCH /bank/questions/:id` con `folderId` de otro tenant → 404; en pregunta central → 422.

Unit (API): armado del árbol y conteos desde listas planas; nombres sembrados con sufijo de grado.

Web (`ng test`, archivos tocados):

- `ui-folder-tree`: render anidado, expandir/colapsar, selección, modo `pick` sin acciones, atributos ARIA del CDK presentes.
- `BankFoldersStore`: optimista + rollback.
- `bank-list`: modal de confirmación con el copy exacto, banner post-borrado, filtro por carpeta.
- `bank-new`: elegir carpeta con tema precarga Curso/Tema; cambiar Tema mantiene carpeta y muestra hint; `folderId` viaja en el guardado; `sessionStorage` recuerda la carpeta.

Browser (Playwright MCP, una pasada manual al final): crear subcarpeta, subir una foto dentro, verla en el árbol, borrar la carpeta y confirmar que la pregunta cae en "Sin carpeta".
