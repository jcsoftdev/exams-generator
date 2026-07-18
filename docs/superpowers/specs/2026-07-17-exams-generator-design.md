# Diseño: Generador de Exámenes Tipo Admisión

**Fecha**: 2026-07-17
**Autor**: jcsoftdev
**Estado**: Borrador para revisión

## 1. Propósito

Plataforma web multi-tenant que permite a colegios/academias generar exámenes tipo admisión en PDF a partir de un banco de preguntas central (propiedad del operador de la plataforma) más preguntas privadas por colegio. Soporta versiones múltiples barajadas (Forma A/B/C) con hoja de claves por versión, y generación de preguntas con IA.

**Modelo de negocio**: el banco de preguntas es el activo central del operador. Los colegios son clientes (tenants) que consumen el banco compartido, agregan preguntas privadas propias y generan exámenes con su logo.

## 2. Usuarios y Roles

| Rol | Alcance | Capacidades |
|---|---|---|
| `platform_admin` | Global | Gestiona banco central, tenants, usuarios; genera preguntas con IA; aprueba borradores |
| `content_editor` | Global | Carga/edita preguntas del banco central; genera con IA; sin gestión de tenants |
| `school_admin` | Su tenant | Gestiona usuarios y logo de su colegio; todo lo del profesor |
| `teacher` | Su tenant | Navega banco (central + privado), crea preguntas privadas, arma y genera exámenes |

## 3. Modelo de Datos (PostgreSQL)

Multi-tenant con discriminador `tenant_id`. Banco compartido = filas con `tenant_id NULL`.

```
tenants        id, name, slug, logo_asset_id, active
users          id, tenant_id (NULL = staff plataforma), email, password_hash, role
courses        id, name                       -- Aritmética, Álgebra, RM, RV...
topics         id, course_id, name           -- fracciones, ecuaciones...
questions      id, tenant_id (NULL = banco central), type ('image'|'structured'),
               topic_id, difficulty ('easy'|'medium'|'hard'),
               grade_level,                   -- catálogo fijo seedeado: 1ro-6to primaria, 1ro-5to secundaria, pre
               status ('draft'|'approved'),
               image_asset_id (type=image),
               body_typst, alternatives jsonb, figure_code (type=structured),
               correct_answer,                -- índice/letra de la clave
               ai_generated boolean, created_by
assets         id, tenant_id, storage_key, mime, width, height   -- MinIO
exams          id, tenant_id, title, grade_level, status, created_by
exam_blueprint_rows   id, exam_id, course_id, topic_id?, difficulty?, count
exam_questions        id, exam_id, question_id, position         -- selección final ordenada
exam_versions         id, exam_id, code ('A','B','C'...),
                      question_order jsonb, alternative_orders jsonb,
                      answer_key jsonb, pdf_asset_id, answer_sheet_asset_id
```

Reglas:
- `questions.tenant_id NULL` → visible para todos los tenants (banco central). Con `tenant_id` → visible solo para ese tenant.
- Toda query de preguntas desde un tenant filtra: `tenant_id IS NULL OR tenant_id = :current`.
- Preguntas `type=image`: la imagen contiene enunciado + alternativas; solo se guarda la clave aparte. **No se barajan sus alternativas.**
- Preguntas `type=structured`: enunciado en marcado Typst (soporta matemáticas), alternativas como array JSON, figura opcional como código CeTZ/Typst. **Sí se barajan alternativas.**

## 4. Arquitectura

Monorepo TypeScript. Backend con arquitectura hexagonal.

```
apps/
  web/        Angular  — SPA
  api/        NestJS   — REST API
packages/
  shared/     tipos y contratos compartidos (DTOs, enums)
infra/
  docker-compose.yml   (Postgres, MinIO, api, web)
```

### Backend (NestJS) — módulos

| Módulo | Responsabilidad |
|---|---|
| `auth` | Login JWT, guards por rol y tenant |
| `tenants` | CRUD colegios, logo |
| `bank` | CRUD preguntas (imagen y estructuradas), taxonomía, filtros, aprobación de borradores |
| `ai` | Generación de preguntas vía `QuestionGeneratorPort` |
| `exams` | Blueprint, selección automática, revisión/reemplazo, versiones |
| `pdf` | Render Typst: plantillas, compilación, subida a MinIO |
| `storage` | Adaptador S3/MinIO (assets) |

### Puertos y adaptadores clave

- `QuestionGeneratorPort` → `OpenRouterAdapter` (inicial). Modelo por variable de entorno (`AI_MODEL`, ej. `openai/gpt-oss-20b:free`). La lista free de OpenRouter rota — el modelo NUNCA se hardcodea. Adaptadores futuros: Gemini, Claude.
- `StoragePort` → `MinioAdapter` (S3-compatible, self-host).
- `PdfCompilerPort` → `TypstCliAdapter` (binario `typst` en el contenedor del API).

## 5. Flujos Principales

### 5.1 Carga de preguntas-imagen (equipo central o colegio)

1. Usuario sube imagen (recorte con enunciado + alternativas dentro) → MinIO.
2. Registra: clave correcta, curso, tema, dificultad, nivel.
3. Queda `approved` directo (carga manual es curada por definición).

### 5.2 Generación con IA

1. Usuario indica: curso, tema, dificultad, nivel, cantidad, ¿con figura?
2. `OpenRouterAdapter` pide **salida estructurada** (JSON Schema): enunciado (marcado Typst con matemáticas), 5 alternativas, índice de la correcta, código de figura CeTZ opcional.
3. Backend valida el JSON, renderiza una **vista previa Typst** (detecta errores de sintaxis del marcado antes de guardar).
4. Preguntas entran como `draft`. Un humano revisa, corrige y aprueba → `approved`.
5. **La IA nunca publica directo al banco.** Contenido de admisión exige curaduría humana.

### 5.3 Armado de examen

1. Profesor crea examen: título, nivel.
2. Define blueprint: filas de "N preguntas de {curso, tema?, dificultad?}".
3. Sistema selecciona al azar del banco visible (central + privadas del tenant) preguntas `approved` que cumplan cada fila. Si no alcanza el stock, error claro indicando qué fila falla.
4. Vista de revisión: ve las preguntas elegidas, puede reemplazar cualquiera (re-sorteo o elección manual del banco filtrado).
5. Confirma la selección → examen `ready`.

### 5.4 Versiones y PDF

1. Profesor pide K versiones (1..N). Cada versión recibe código `A`, `B`, `C`...
2. Por versión se genera: permutación del orden de preguntas; permutación de alternativas **solo en preguntas estructuradas**; `answer_key` calculada tras el barajado.
3. `pdf` module rellena la plantilla Typst:
   - Encabezado: logo del tenant (descargado de MinIO), nombre del colegio, título, código de Forma.
   - Cuerpo a **dos columnas**: preguntas numeradas; imágenes insertadas tal cual (escaladas al ancho de columna); estructuradas renderizadas con matemáticas y figuras.
   - Documento aparte: **hoja de claves** de esa versión (tabla número → letra).
4. Compila con `typst compile` (workspace temporal con imágenes descargadas), sube ambos PDFs a MinIO, entrega URLs de descarga.
5. Compilación síncrona en el MVP (Typst compila en ms–s). Si un examen con muchas imágenes tarda, se migra a cola (BullMQ) — decisión pospuesta a evidencia real.

## 6. Stack (decidido)

| Pieza | Tecnología | Justificación |
|---|---|---|
| Frontend | Angular | CRUD pesado, formularios reactivos, ecosistema del equipo |
| Backend | NestJS | Hexagonal natural, módulos claros |
| BD | PostgreSQL | Multi-tenant relacional limpio |
| ORM | Drizzle | Tipado fuerte, migraciones SQL explícitas |
| Storage | MinIO | S3-compatible self-host |
| PDF | Typst (CLI) | Dos columnas nativas, matemáticas nivel LaTeX, figuras CeTZ, plantillas con variables, compila en ms |
| IA | OpenRouter free tier tras puerto | Costo cero para validar; modelo configurable; ver referencia `openrouter/free-models` en web-research |
| Deploy | Docker + Dokploy (VPS propio) | Infra existente |
| Auth | JWT propio (NestJS) | Suficiente para MVP; sin dependencia externa |

## 7. Manejo de Errores

- **IA devuelve JSON inválido**: reintento 1 vez con el error en el prompt; si falla, se descarta y reporta. Nunca se guarda sin validar contra schema.
- **Marcado Typst inválido en pregunta**: la vista previa compila ANTES de guardar; error de compilación bloquea el guardado con mensaje.
- **Stock insuficiente para blueprint**: error por fila ("Aritmética/media: pides 5, hay 3") antes de generar nada.
- **Compilación de examen falla**: se reporta la pregunta culpable (compilación incremental por pregunta en la vista previa reduce este riesgo a casi cero).
- **Free tier agotado (429 de OpenRouter)**: mensaje claro al usuario; el modelo/proveedor se cambia por config sin deploy.

## 8. Testing

Strict TDD (test primero) según convención del entorno.

- **Dominio (máxima prioridad)**: barajado de versiones y cálculo de `answer_key` (propiedad: la clave siempre apunta a la alternativa correcta tras permutar); selección por blueprint (cumple filas, no repite preguntas, respeta visibilidad de tenant).
- **Puertos**: adaptador OpenRouter con respuestas mockeadas (JSON válido, inválido, 429); TypstCliAdapter con plantillas doradas (golden files de `.typ` generado, no del PDF binario).
- **API**: e2e de flujos por rol y aislamiento de tenants (un tenant NUNCA ve preguntas privadas de otro — test obligatorio).
- **Frontend**: tests de componentes del armado de examen (blueprint, reemplazo).

## 9. Fases

**Fase 1 — MVP (validar el producto)**
Auth + tenants + roles · banco de preguntas-imagen (carga, taxonomía, filtros) · blueprint + selección + revisión · versiones barajadas · PDF dos columnas + hoja de claves + logo · deploy en Dokploy.

**Fase 2 — IA y preguntas estructuradas**
Preguntas estructuradas (editor con vista previa Typst) · generación IA con revisión de borradores · figuras CeTZ.

**Fase 3 — Según demanda real**
Cola de compilación · estadísticas de uso del banco · export a Word · OMR (lectura de fichas ópticas) · facturación.

La Fase 1 NO incluye IA a propósito: el valor central (banco → examen barajado en PDF) se valida sin gastar en integración IA.

## 10. Fuera de Alcance (por ahora)

- Rendir el examen en línea (es un generador de documentos, no un LMS).
- Corrección automática / OMR.
- Facturación y planes.
- Barajar alternativas de preguntas-imagen (imposible por definición del formato).
