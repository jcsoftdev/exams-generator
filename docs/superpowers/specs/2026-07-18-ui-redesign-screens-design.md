# Diseño — Screens de navs restantes (rediseño UI exams-generator)

**Fecha:** 2026-07-18
**Estado:** Definido — layouts aprobados screen por screen en el visual companion (mockups en `.superpowers/brainstorm/13165-*/content/`). Listo para plan de implementación.
**Relación:** Complementa `2026-07-18-ui-redesign-design.md` (flujo maestro + marca, implementándose en paralelo). Este doc define los screens de los demás navs del sidebar. Hereda TODA la identidad visual (§3 del doc base: paleta pizarra profunda, Plus Jakarta Sans, sin gradientes, radios 8–12px) y la terminología sin jerga.

**Orden de definición (elegido):** Banco → Versiones/Historial → IA generar → Cola de revisión → Config colegio → Login/Shell.

---

## Decisiones de alcance ya cerradas (2026-07-18)

1. **Banco**: una sola pantalla para el profesor; preguntas del banco central visibles con badge "Banco central 🔒" (solo lectura para profe). Curaduría content_editor = pantalla futura, fuera de este spec.
2. **Acciones sobre pregunta**: aprobada → **Archivar** (nuevo estado `archived`, sale de circulación sin romper exámenes viejos); borrador → borrar directo. Endpoints nuevos requeridos.
3. **Paginación del banco** (N2 del doc base) sube a **requerida**: `GET /bank/questions?page=&pageSize=` → `{ items, total }`.
4. **Form "Nueva pregunta"**: imagen O estructurada (el endpoint `POST bank/questions/structured` existe sin UI — se cablea).
5. **Nav "Versiones y PDF" = Historial de exámenes**: lista de todos los exámenes (título, grado, estado, formas) → detalle con versiones re-descargables. Requiere `GET /exams` (nuevo) + B4 (`GET /exams/:id/versions`).
6. **Acciones por examen en historial**: **Duplicar** ("Usar de plantilla" → flujo maestro precargado; `POST /exams/:id/duplicate` nuevo) y **Eliminar** (`DELETE /exams/:id` nuevo; borrador libre, generado con confirmación).
7. **Cola de revisión IA**: preview **WYSIWYG real** — N4 del doc base sube a requerido (`GET /bank/questions/:id/preview` PNG/PDF vía Typst). Compilación bajo demanda al abrir el borrador + caché por pregunta (no compilar toda la cola de golpe).
8. **Config colegio**: datos + logo (backend ya existe) **+ pestaña "Profesores"**: listar/crear/desactivar usuarios del tenant. Requiere módulo `users` nuevo (API+UI). Sin infra de email: el school_admin genera password temporal (cubre "olvidé mi contraseña" sin SMTP).
9. **Login/Shell — fixes requeridos**: botón logout (el `AuthService.logout()` existe y nadie lo llama), manejo 401 en interceptor (token vencido → redirect a login), cablear `roleGuard` en rutas (escrito y testeado, nunca usado), nav condicionada por rol.

## Endpoints nuevos que este spec agrega (además de B1–B4 del doc base)

| ID | Endpoint | Para |
|---|---|---|
| S1 | `GET /exams` (list, filtros título/grado/estado, paginado) | Historial |
| S2 | `POST /exams/:id/duplicate` | Usar de plantilla |
| S3 | `DELETE /exams/:id` | Eliminar examen |
| S4 | `PATCH /bank/questions/:id/archive` (estado `archived` nuevo en enum) | Archivar pregunta |
| S5 | `DELETE /bank/questions/:id` (solo draft propio) | Borrar borrador |
| S6 | Paginación en `GET /bank/questions` (= N2 promovido) | Banco |
| S7 | `GET /bank/questions/:id/preview` (= N4 promovido, PNG vía Typst, caché) | Cola revisión WYSIWYG |
| S8 | Módulo `users`: `GET/POST /users`, `PATCH /users/:id` (desactivar), `POST /users/:id/reset-password` (temporal) — tenant-scoped, school_admin | Config colegio |
| S9 | Migración: `created_at` (+`updated_at`) en `exams`, `questions`, `users` — hoy NINGUNA tabla tiene timestamps (hallazgo del audit) | Prerequisito de S1 (orden reciente) y del orden FIFO de la cola |

## Pantallas (definidas)

### 1. Banco de preguntas — ELEGIDO: C · Lista + panel de detalle

Mismo patrón del flujo maestro (lista izquierda + preview vivo derecha). Ruta existente `/app/bank`.

**Estructura:**
1. **Barra de filtros** arriba: Curso ▾ · Tema ▾ (dependiente de curso) · Nivel ▾ (fácil/media/difícil) · Grado ▾ · Estado ▾ (aprobada/borrador/archivada) + búsqueda por título + botón primario "+ Nueva pregunta" (derecha).
2. **Lista izquierda (~55%)**: filas compactas — thumbnail chico (vía `/assets/:id`), título, curso·tema, tag de nivel. Fila activa = borde primary-500 + fondo primary-50. Paginación al pie ("124 preguntas · ‹ 1/7 ›", S6).
3. **Panel derecho (~45%)**: pregunta seleccionada completa — imagen grande (o contenido estructurado formateado), título, badges (nivel, origen: "Colegio" tint / "IA" morado / "Banco central 🔒" primary-100), metadata (clave, grado, "usada en N exámenes"), acciones: **Editar** (ghost) · **Archivar** (ghost, S4) · **Borrar** (rojo, solo borrador propio, S5). Preguntas del banco central: sin acciones, nota "Pregunta del banco central — solo lectura".
4. **Empty states**: banco vacío → CTA "Subir preguntas" / "✨ Generar con IA" (patrón del doc base §5.1.7); filtros sin resultados → "No hay preguntas con esos filtros" + limpiar filtros.
5. **Nueva pregunta**: pantalla/route propia con dos modos en tabs — "Foto de la pregunta" (form actual: imagen + clave + taxonomía) y "Escribir pregunta" (form estructurado → `POST bank/questions/structured`, hoy sin UI). Al guardar vuelve a la lista con la pregunta seleccionada en el panel.
6. **Mobile**: lista a pantalla completa; tocar fila → panel como pantalla/sheet completa con back. Filtros colapsan a un botón "Filtros" (sheet).
7. **Estados**: cargando (skeleton filas), error (banner con reintentar).

### 2. Historial de exámenes ("Versiones y PDF") — ELEGIDO: B · Lista + pantalla de detalle

Nav del sidebar renombrado a **"Mis exámenes"** en el grupo Principal (cumple mejor lo que muestra; "Versiones y PDF" describía solo la mitad).

**Rutas** (ajuste mínimo al árbol — ver "Coordinación con doc base" al final): `/app/exams` = lista índice (pantalla nueva) · `/app/exams/new` = flujo maestro para examen nuevo (hoy exam-create vive en `/app/exams`; se mueve) · `/app/exams/:id` = flujo maestro sobre borrador existente · `/app/exams/:id/versions` = detalle de formas (existente, se enriquece).

**Lista (índice):**
1. Barra de filtros: Grado ▾ · Estado ▾ (borrador/generado) + búsqueda por título + botón primario "+ Nuevo examen" (→ flujo maestro).
2. Tarjetas-fila por examen: título, grado, nº preguntas, nº formas, tag estado ("Generado" verde / "Borrador" ámbar). Acción según estado: "Abrir ›" (generado) / "Seguir armando ›" (borrador → flujo maestro con estado cargado).
3. Menú ⋯ por examen: **Usar de plantilla** (S2 → flujo maestro precargado con contenido duplicado, título "Copia de …") · **Eliminar** (S3; borrador borra directo, generado pide confirmación con nombre del examen).
4. Datos: `GET /exams` (S1) paginado, orden más reciente primero.
5. Empty state: "Aún no tienes exámenes" + CTA "+ Nuevo examen".

**Detalle (examen generado):**
1. Encabezado: título, grado, tag estado, "Usar de plantilla".
2. Formas: fila por Forma A/B/C… con "Examen (PDF) ⬇" + "Hoja de claves ⬇" (B4) + botón oscuro "⬇ Descargar todo (ZIP)" (N1 si está disponible; si no, se ocultan hasta implementarlo).
3. "Generar más formas" → reutiliza paso 3 del flujo maestro (regeneración idempotente según B4 ⚠ del doc base).
4. Contenido del examen en solo lectura (grupos por pedido, patrón §5.1.4 del doc base) colapsado bajo "Ver contenido".
5. Mobile: lista una columna; detalle apilado (formas primero, contenido después).

### 3. Generar con IA — ELEGIDO: A · Taller (form fijo + tanda al lado)

Ruta existente `/app/ai/generate`. Dos columnas: form persistente izquierda (~300px), resultados ("la tanda") derecha.

**Form (izquierda, panel blanco):**
1. Campos: Curso ▾ · Tema ▾ · Nivel (segmented fácil/media/difícil) · Grado ▾ · Cantidad (stepper − N +) · ☐ Incluir figura (diagrama).
2. CTA primario full-width: "✨ Generar N preguntas". Hint: "Tarda ~1 min · puedes seguir navegando".
3. El form NUNCA se resetea tras generar — ajustar y volver a pedir sin re-llenar.

**Tanda (derecha):**
1. Tarjeta de estado: "7/10 preguntas generadas" + contexto (curso·tema·nivel·grado) + barra de progreso. Durante generación: progreso vivo.
2. Fallos parciales: banner warning "3 no pasaron la validación" + botón "Reintentar 3" (mismos parámetros, solo las faltantes).
3. Preguntas legibles inline: nº (badge morado IA), chip "Borrador IA", clave, enunciado completo, alternativas con la correcta marcada ✓ verde. Colapsa a "y N borradores más…" si son muchas.
4. Footer: botón oscuro "Revisar los 7 en la cola →" (→ Cola de revisión).
5. Copy clave: "lo generado entra como borrador a tu cola de revisión — nada se publica solo".
6. Empty state (antes de generar): explicación corta del flujo 1-2-3.
7. Mobile: una columna, form arriba colapsable tras generar, tanda debajo.

### 4. Cola de revisión IA — ELEGIDO: A · Mesa de trabajo (lista + preview impreso)

Ruta existente `/app/ai/review`. Mismo patrón del Banco: lista izquierda (~240px) + panel derecha. Badge contador de pendientes en el nav del sidebar ("Cola de revisión · 7").

**Lista (izquierda):**
1. Fila por borrador: primera línea del enunciado (truncada), curso·tema, chip nivel. Activa = borde primary-500.
2. Orden: más antiguo primero (FIFO — requiere S9). Fuente: `GET /bank/questions?status=draft`.
3. La cola muestra TODOS los borradores del tenant (generados por IA y subidos a mano); el chip "Borrador IA" aparece solo en los de origen IA.

**Panel (derecha):**
1. Cabecera: chips "Borrador IA" (morado) + nivel·grado + "clave: X".
2. **Preview "papel"** (S7, WYSIWYG): la pregunta renderizada por Typst como PNG, sobre fondo papel con nota "Vista previa real — así se imprimirá". Compilación bajo demanda al seleccionar + caché por pregunta; skeleton mientras compila; si falla el render → fallback a contenido formateado + aviso.
3. Acciones: **✓ Aprobar** (verde sólido) · **Editar** (ghost → form estructurado, re-valida server-side, invalida caché del preview) · **Rechazar** (outline rojo, confirmación). Al decidir, la lista avanza al siguiente pendiente.
4. Empty state: "No hay borradores por revisar" + CTA "✨ Generar con IA".
5. Mobile: lista a pantalla completa → panel como pantalla con back (igual que Banco).

### 5. Configuración del colegio — ELEGIDO: A · Tabs ("Datos y logo" | "Profesores")

Ruta nueva `/app/settings` (grupo Colegio del sidebar). Visible solo para `school_admin` (roleGuard). Subtítulo: nombre del colegio.

**Tab "Datos y logo":**
1. Form: nombre del colegio, ciudad (campos de `PATCH /tenants/:id` existente).
2. Logo: preview 64px + "Cambiar logo" (`POST /tenants/:id/logo` existente). Nota: "Sale en el encabezado de cada examen PDF".
3. Guardado con botón primario + toast "Guardado".

**Tab "Profesores" (módulo users nuevo, S8):**
1. Contador "N profesores activos" + botón primario "+ Agregar profesor".
2. Tabla: avatar iniciales, nombre — email, chip rol ("Administra" / "Profesor"), chip estado ("Activo" verde / "Desactivado" gris), menú ⋯.
3. Menú ⋯: **Restablecer contraseña** (genera temporal, se muestra UNA vez en modal para copiar/entregar) · **Desactivar/Reactivar** (desactivado no puede iniciar sesión; nunca se borra — preserva autoría).
4. "+ Agregar profesor": modal con nombre, email, rol (teacher/school_admin) → crea con password temporal mostrada al cerrar (mismo patrón del reset).
5. Empty state: "Aún no agregas profesores" + CTA.
6. Mobile: tabs se mantienen; tabla colapsa a tarjetas por profesor.

### 6. Login — ELEGIDO: A · Panel dividido + Shell (fixes obligatorios)

**Login** (`/login`): mitad izquierda oscura (primary-900) con marca, promesa ("Tus exámenes tipo admisión, listos para imprimir."), texto de apoyo y mini-preview de un examen generado (tarjeta primary-800); mitad derecha canvas claro con form: "Inicia sesión" / "Con la cuenta que te dio tu colegio", correo, contraseña, botón "Entrar". Ayuda: "¿Olvidaste tu contraseña? Pídele una nueva al administrador de tu colegio" (coherente con S8: reset por admin, sin email). Sin registro público. Mobile: panel oscuro se reduce a franja superior con marca; form debajo.

**Shell (correcciones obligatorias, sin mockup):**
1. **Topbar**: nombre del colegio + menú de usuario (iniciales) → "Cerrar sesión" (llama al `AuthService.logout()` existente que hoy nadie usa).
2. **401 handling**: interceptor captura 401 → limpia sesión → redirect a `/login` con mensaje "Tu sesión expiró, vuelve a entrar". Hoy no existe: token vencido = app rota silenciosa.
3. **roleGuard cableado** en rutas (existe testeado, sin uso): `/app/settings` solo school_admin; `/app/ai/*` según rol si aplica; resto autenticado.
4. **Nav condicional por rol**: grupo "Colegio" (Configuración) solo school_admin.
5. **Sidebar final** (ajusta doc base §4): Principal = "Banco de preguntas · **Mis exámenes**" — el nav "Exámenes" del doc base se FUSIONA con "Mis exámenes": el flujo maestro se entra por "+ Nuevo examen" / "Seguir armando" desde la lista. Dos navs de exámenes confundían; la lista es el hub. Inteligencia y Colegio quedan igual.
6. Badge contador en "Cola de revisión" (nº borradores pendientes).
7. Mobile: sidebar → drawer (doc base §7).

## Coordinación con doc base (para el agente que lo implementa)

Este spec ajusta 3 cosas del doc base `2026-07-18-ui-redesign-design.md`:
1. **Sidebar §4**: "Exámenes" + "Versiones y PDF" se fusionan en un solo nav "Mis exámenes" (lista → flujo maestro / detalle de formas).
2. **Árbol de rutas**: se agrega `/app/exams` como índice y el flujo maestro de examen nuevo pasa a `/app/exams/new`. El doc base decía "no se cambia el árbol"; este es el ajuste mínimo que exige tener historial.
3. **Promociones**: N2 (paginación banco) y N4 (preview WYSIWYG) pasan de nice-to-have a requeridos (S6, S7). N1 (ZIP) sigue nice-to-have: el detalle de formas oculta el botón ZIP hasta que exista.

Los endpoints S1–S9 viven en los módulos existentes (`exams`, `bank`) + módulo `users` nuevo; TDD estricto como B1–B4. No pisan los archivos del flujo maestro que el otro agente está tocando, EXCEPTO: mover exam-create a `/app/exams/new` (app.routes.ts) y el sidebar del shell — coordinar esos 2 archivos al integrar.
