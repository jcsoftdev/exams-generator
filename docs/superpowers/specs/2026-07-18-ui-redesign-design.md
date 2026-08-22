# Diseño — Rediseño UI/UX del web (exams-generator)

**Fecha:** 2026-07-18
**Estado:** Borrador para revisión
**Alcance:** Rediseño completo (visual + flujos UX) del frontend Angular. El backend funciona end-to-end; este cambio viste y reordena la capa web, e identifica los endpoints faltantes que la nueva UX requiere.

---

## 1. Propósito

El web actual tiene el wiring funcional completo (formularios, servicios, guards, flujos verdes end-to-end) pero **cero diseño**: `styles.scss` vacío, clases BEM sin CSS, copy en inglés. El producto apunta a colegios/academias peruanas. Este rediseño entrega una identidad visual profesional, flujos UX pensados para un profesor de baja frecuencia técnica, y todo en español.

## 2. Usuarios (del design base)

4 roles: `platform_admin` (global), `content_editor` (global, banco central), `school_admin` (su colegio), `teacher` (su colegio). Usuario principal del rediseño: **profesor/school_admin de baja frecuencia** que arma exámenes un par de veces por periodo y necesita **velocidad Y control**, en desktop y mobile.

## 3. Identidad visual (fijada)

### 3.1 Marca — "Pizarra profunda"

Generada por algoritmo OKLCH (rampa perceptualmente uniforme, hue base ~246°, chroma bajo). Estructura "profesional" = **ancla oscura** (sidebar) + lienzo blanco + color controlado (solo acción principal + nav activo).

| Token                | Hex       | Uso                      |
| -------------------- | --------- | ------------------------ |
| primary-900 (ancla)  | `#072034` | Sidebar, títulos fuertes |
| primary-800          | `#1c3141` |                          |
| primary-700          | `#2f4657` |                          |
| primary-600          | `#3f596f` | Botón hover              |
| primary-500 (acción) | `#516f8a` | Botón primario, acentos  |
| primary-400          | `#7392ae` |                          |
| primary-300          | `#9db4cb` |                          |
| primary-200          | `#c3d3e2` |                          |
| primary-100          | `#e2ebf3` |                          |
| tint activo          | `#deedfb` | Fondo nav activo, chips  |
| tint texto           | `#3b5872` | Texto sobre tint         |
| primary-50           | `#f3f6fa` |                          |

Neutrales: `#f7f8f9 #eceef1 #dde0e4 #c3c8ce #a4abb3 #868d96 #6a717a #4e545c #363b41 #20242a`.

Semánticos (tags/estados): éxito/fácil `#dcfce7`/`#166534`; media `#fef3c7`/`#92620a`; difícil/error `#fee2e2`/`#9f1239`; IA `#f3e8ff`/`#6b21a8`; warning stock `#fff8f1`/`#9a3412`.

### 3.2 Tipografía

**Plus Jakarta Sans** (Google Fonts) — UI + headings, mismo tipo. Pesos 400/500/600/700/800. Self-host para producción (no depender de CDN externo).

### 3.3 Reglas duras

- **Sin gradientes** — rellenos sólidos siempre.
- Radios 8–12px, densidad media.
- Color con moderación: el neutro/blanco domina, el primario aparece poco.

### 3.4 Tech

**Tailwind CSS + design tokens propios + componentes a mano** (no Angular Material / no PrimeNG). Tokens mapean la tabla de arriba a variables Tailwind. Componentes primitivos: botón (primary/ghost), input, select, card, tabla, tag/chip, modal, empty-state, sidebar, topbar, banner/alert, progress. Todo standalone components (Angular actual), atomic + container/presentational.

## 4. Arquitectura de la app (navegación)

Shell con **sidebar oscuro** (`#072034`) + topbar + router-outlet. Sidebar agrupado:

- **Principal**: Banco de preguntas · Exámenes · Versiones y PDF
- **Inteligencia**: Generar con IA · Cola de revisión
- **Colegio**: Configuración (logo, datos) — visible según rol

Rutas existentes se conservan (`/app/bank`, `/app/exams`, `/app/exams/:id`, `/app/exams/:id/versions`, `/app/ai/generate`, `/app/ai/review`). El rediseño reestructura los componentes internos, no el árbol de rutas.

## 5. Flujo maestro — Armar examen

Arquitectura elegida: **una sola pantalla "tabla + preview vivo"** (blueprint-first fusionado con el borrador editable; patrón respaldado por investigación UX — ExamSoft/Certiverse/table-of-specifications). Se descartaron: wizard puro (rígido, falla en control), single-page denso sin guía, banco-primero tipo carrito (tedioso a escala).

**Terminología de colegio (cero jerga):** nunca "blueprint". Se llama **"Contenido del examen"**. Nivel = fácil/media/difícil. Filas = "pedidos".

### 5.1 Estructura de la pantalla

1. **Ribbon de pasos** "1 Arma · 2 Revisa · 3 Genera" (orienta sin gatear) + toggle "Modo guiado" + tip descartable ("No mostrar").
2. **Datos del examen**: título editable, grado (dropdown), colegio, "logo en PDF automático".
3. **Contenido del examen (Tabla B)**: filas = curso·tema, columnas = fácil/media/difícil, celda = nº que quieres. **Debajo de cada celda: stock del banco** ("de 18", rojo "solo 2 ✕"). Convierte el error 422 reactivo en restricción visible ANTES de comprometer. "+ Agregar tema". Totales por nivel.
4. **Preguntas del examen — agrupadas por lo que pediste**: cada grupo con encabezado que repite el pedido ("Biología·Célula · Fácil · pediste 6") y debajo las preguntas reales del banco. Frase líder: "Sacamos estas preguntas de tu banco según el contenido que pediste". Cada pregunta: nº + thumbnail (imagen o IA) + título + **"Cambiar"** (reemplaza por otra del mismo tema+nivel, no rompe el pedido). "Ver todas" colapsa grupos largos. Tocar = ver grande. **Sin jerga** (nada de "elegida al azar de 18", "fijar", "IA aprobada" en modo simple — se probó y confundió).
5. **Puente a IA** (resuelve la desconexión): cuando falta stock en una fila → "✨ Generar N con IA" · "Elegir del banco" · "Bajar la cantidad". Nunca callejón sin salida.
6. **Divulgación progresiva**: "Generar versiones" aparece **bloqueado 🔒** ("disponible cuando completes las N, faltan X") hasta completar. Footer pegado con barra de progreso (N de M) + "Generar versiones".
7. **Empty state** (banco vacío): CTA "Subir preguntas" / "✨ Generar con IA".

### 5.2 Paso 3 — Versiones

"¿Cuántas formas?" (2/3/4/5), toggle "barajar también las alternativas (a/b/c/d)", cada Forma A/B/C con "Examen (PDF)" + "Hoja de claves", botón "Descargar todo (ZIP)". Branding/logo del colegio se aplica a todas las versiones (se configura una vez).

## 6. Flujos hermanos (reusan los patrones aprobados)

- **Banco de preguntas**: lista/grid con filtros (curso/tema/dificultad/grado/estado), tags de dificultad y estado, thumbnail vía `/assets/:id`, paginación. "Nueva pregunta" → form: imagen (foto enunciado + clave + taxonomía) o estructurada. Empty state.
- **Generar con IA**: form (curso/tema/dificultad/grado/cantidad/con-figura) → resultado con éxitos/fallos parciales; las creadas entran como borrador.
- **Cola de revisión IA**: lista de borradores → ver enunciado (preview Typst renderizado) → editar (re-valida server-side) → Aprobar/Rechazar. IA nunca publica directo.
- **Versiones (pantalla propia)**: además de dentro del maestro, lista de versiones ya generadas + descarga.
- **Login**: entrada limpia con marca, email+password.
- **Configuración de colegio**: datos + subir logo (para el PDF).

## 7. Responsive

Desktop = sidebar fijo + layout de 2 columnas. Mobile:

- Sidebar → drawer / bottom-nav.
- Tabla de contenido → se colapsa a una tarjeta por tema (fácil/media/difícil apiladas).
- Preview de preguntas → debajo de la tabla (una columna), no en paralelo.
- Resumen de progreso siempre visible (pinned/colapsable).

## 8. Copy / i18n

Todo en **español (Perú)**, tono de colegio, sin jerga técnica. Se reemplaza el copy inglés actual ("Question Bank" → "Banco de preguntas", etc.).

## 9. Cambios de API requeridos por la nueva UX

Auditado contra `main`. Todo lo demás que la UI necesita YA existe y calza (ver 9.3).

### 9.1 Bloqueantes (implementar antes/junto con la UI)

**B1 · Stock por celda** — sin esto no hay "de 18 / solo 2" en vivo.

```
POST /exams/stock/batch     (batch preferido: la tabla tiene N filas; 1 GET por tecla es derroche)
Body:  { gradeLevel, cells: [{ courseId, topicId?, difficulty? }] }
Resp:  { results: [{ courseId, topicId?, difficulty?, available: number }] }
Auth:  JwtAuthGuard + RolesGuard @Roles(Teacher, SchoolAdmin); tenant de user.tenantId; 400 si gradeLevel inválido; 403 si tenantId null
```

Slot: nuevo `ExamsRepository.countStock()` reusando el query de `getQuestionPool` (`exams.repository.ts:247-266`) con `courseId/topicId/difficulty` en el WHERE + `COUNT(*)`. **Read fino, fácil** — la lógica de visibilidad/approved/gradeLevel ya existe verbatim.

**B2 · Preview de selección sin persistir** — para el preview vivo agrupado.

```
POST /exams/preview
Body:  { gradeLevel, blueprint: [{courseId, topicId?, difficulty?, count}] }   // = CreateExamDto sin title
Resp:  { selections: [{ rowIndex, courseId, topicId?, difficulty?, questionIds: string[] }], shortages: ShortageDetail[] }
Auth:  igual que POST /exams; SIN escrituras a DB
```

Slot: nuevo `ExamsService.previewExam()` reusando `getQuestionPool` + `blueprint-selector.select()` (el tercio medio de `createExam`, `exams.service.ts:152-186`) sin `createExam`/`saveSelection`. **Wiring nuevo ligero.**
⚠ **Decisión de diseño**: la selección es aleatoria; llamadas repetidas re-rollean. Para que las preguntas no "salten" mientras el profe edita otra fila → el cliente cachea la respuesta por fila, o se pasa un `seed`. Preferencia: **cache en cliente por fila** (no persistir hasta generar).

**B3 · Gate draft→ready sin botón "confirmar"** — la pantalla única no expone confirmar.
Opción recomendada (mínima): **auto-confirmar al generar**. En `exam-generation.service.ts:95-101`, si `status==='draft'` llamar inline a la lógica de `confirmExam` en vez de tirar 409, luego generar. Reusa lógica existente, sin reglas nuevas. `replace` sigue bloqueado correctamente (post-generación ya es `ready`). Descartado: quitar el gate del todo (dejaría PDFs viejos stale sin flag de invalidación).

**B4 · GET historial de versiones** — hoy `POST /versions` regenera a ciegas; las versiones SÍ se persisten en `exam_versions` pero no hay endpoint de lectura.

```
GET /exams/:examId/versions
Resp:  [{ code, pdfUrl, answerSheetUrl }]   // reconstruido desde exam_versions + assets
Auth:  igual que ExamsController; 404 si no existe/otro tenant
```

Slot: nuevo `ExamsRepository.getVersions(examId, tenantId)` join `exam_versions`→`assets`. **Read fino** pero necesita reconstruir URL desde `storageKey` (hoy no se persiste la URL, solo asset ids) — revisar si `StoragePort` tiene `getUrl(key)`.
⚠ **Bug latente detectado**: `POST /versions` dos veces choca con el índice único `(examId, code)` en el insert (`exams.repository.ts:461-470`) — no está manejado. Al tocar esto, hacer la generación **idempotente** (borrar/reemplazar versiones previas del examen antes de regenerar).

### 9.2 Nice-to-have (post-MVP del rediseño)

- **N1 · Descargar ZIP** — `GET /exams/:examId/versions/zip` (stream). Necesita lib de zip (`archiver`, no es dependencia hoy). Lógica nueva aislada.
- **N2 · Paginación en `GET /bank/questions`** — hoy sin paginar (unbounded). Agregar `?page=&pageSize=` → `{ items, total }`. Riesgo si el banco crece.
- **N3 · `GET /tenants` (list)** — `TenantsService.findAll()` existe pero sin ruta. 1 línea de controller. Para selector de colegio (platform_admin).
- **N4 · Preview render de un draft** — `GET /bank/questions/:id/preview` (PDF/PNG) reusando `PdfCompilerPort`. Solo si la cola de revisión quiere WYSIWYG en vez de mostrar el contenido crudo (el contenido ya está garantizado-compila).

### 9.3 Existentes confirmados (se reutilizan, file:line en el audit)

Login (`POST /auth/login`), banco completo (list/filtros/`GET :id`/`POST image`/`POST structured`/`PATCH`/`approve`/`reject`), armar examen (`POST /exams`, `GET /exams/:id`, `replace` reroll+manual, `confirm`, `POST /versions`), IA generate (con fallo parcial), taxonomía (`GET /courses`, `GET /topics`), tenants CRUD + `POST /tenants/:id/logo` (ya consumido por el generador de PDF), assets (`GET /assets/:id` streaming tenant-scoped). Nada de esto necesita cambios.

Los faltantes (B1–B4, luego N1–N4) se implementan vía **TDD (test primero)** en su módulo (`exams` para B1/B2/B3/B4).

## 10. Testing

Strict TDD (convención del proyecto). Componentes Angular: tests de presentación por primitivo y por pantalla (estados: cargando, vacío, error, con datos, stock corto). Endpoints nuevos: service + e2e (stock exacto, preview coincide con selección real, auto-confirm en versiones, tenant scoping). Snapshot visual opcional.

## 11. Fuera de alcance

- Rendir examen en línea (sigue siendo generador de documentos).
- Cambiar el árbol de rutas o el modelo de datos (salvo lo mínimo para los endpoints faltantes).
- Analítica de ítems / estadísticas de preguntas (futuro).

## 12. Referencias

- Investigación UX: `engram ui-redesign/exam-flow-research` (Testmoz, Canvas, Moodle, ExamSoft, table-of-specifications, NN/g wizards).
- Decisiones de marca/flujo: `engram ui-redesign/brand`, `ui-redesign/exam-flow-final`.
- Mockups aprobados: `.superpowers/brainstorm/52346-*/content/` (`flow-master.html`, `questions-origin.html`, `brand-locked.html`, `type-specimen.html`).
