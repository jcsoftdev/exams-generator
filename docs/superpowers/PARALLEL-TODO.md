# TODO maestro — ejecución en paralelo hasta producto con IA

**Estado base:** `main` (auditado @ bb5b01e). Estrategia activa: **merge directo a main** (sesiones paralelas).
**Objetivo:** producto funcionando end-to-end, MVP + Fase 2 (IA).

## Cómo leer esto

- **Olas (Wave)** = orden de dependencia. Una ola no arranca hasta que su ola previa cubre lo que necesita.
- **Carriles (Lane)** dentro de una ola = corren **en paralelo**, en módulos distintos, sin colisión.
- **[GATE]** = release gate, no se mergea sin verde.
- **⚠️ COLISIÓN** = archivo compartido; serializar (ver Reglas de Coordinación).
- Cada carril lo toma UNA sesión. No dupliques un carril (fue la causa de las ramas PR3 duplicadas).

---

## Reglas de coordinación (evitar pisarse)

1. **Un integrador** es dueño de los 3 archivos compartidos: `apps/api/src/app.module.ts`, `packages/shared/**`, `apps/api/src/db/schema/**` (y sus migraciones). Los demás carriles NO editan estos; piden el cambio al integrador o abren un mini-PR aislado que el integrador serializa.
2. Cada carril trabaja **solo en su carpeta de módulo**. Nada de tocar módulos ajenos.
3. **Contratos primero**: si un carril de UI necesita un DTO, se define en `packages/shared` (vía integrador) ANTES de que UI y API lo consuman. Sin eso, UI adivina y rehace.
4. Nada de `git worktree` manual descoordinado. Limpiar los worktrees huérfanos (`worktree-agent-*`) cuando el harness los suelte.
5. Respetar el orden de los **[GATE]**: no mergear deploy/UI de una feature cuyo backend no existe (ya pasó: PR9/PR8a entraron antes que exams).

---

## Estado actual (hecho en main)

- [x] Scaffold monorepo (pnpm, turbo, NestJS, Angular, docker-compose, typst en imagen)
- [x] Dominio puro: VersionShuffler, BlueprintSelector, GradeLevel, RandomPort — **[GATE] answer_key post-shuffle ✅**
- [x] Data model: schema Drizzle, migración, seed idempotente
- [x] Ports/adapters: StoragePort (Minio/in-memory), TypstCliAdapter + template + error-mapper — **[GATE] golden .typ ✅**
- [x] Módulo bank (imágenes): controller, service, repository, e2e, visibilidad por tenant
- [x] Web: auth shell (login, guards, interceptor, JWT util)
- [x] Deploy: Dockerfile web + config Dokploy

---

## WAVE A — cerrar el backend del MVP (4 carriles en paralelo)

### Lane A1 — `exams` capa HTTP (EL HUECO CENTRAL)
Dominio + adapters ya existen; falta ensamblar.
- [x] `exams.module.ts` + application layer (use cases)
- [x] CreateExam (título + gradeLevel) → endpoint
- [x] DefineBlueprint (filas curso/tema?/dificultad?/count) → endpoint
- [x] GenerateSelection (usa BlueprintSelector; pool pre-filtrado por tenant + approved + exam.gradeLevel) → endpoint
- [x] ReplaceQuestion (re-draw / pick manual, sin duplicar) → endpoint
- [x] ConfirmExam (status → ready) → endpoint
- [x] Error stock insuficiente → 422 nombrando la fila
- [x] Tests service + e2e por endpoint
- ⚠️ COLISIÓN: `app.module.ts` (registrar ExamsModule) → vía integrador

### Lane A2 — módulo `tenants` (NO EXISTE)
- [x] `tenants.module.ts` + service + repository + controller
- [x] CRUD tenant + SetTenantLogo (usa StoragePort)
- [x] Tests + e2e
- ⚠️ COLISIÓN: `app.module.ts` (registrar TenantsModule)

### Lane A3 — completar `auth`
Hay token service + jwt guard; falta el resto.
- [x] Endpoint login (emite JWT con role + tenant_id)
- [x] RolesGuard + TenantGuard backend
- [x] Tests: login OK/inválido, guard rechaza rol/tenant equivocado
- ⚠️ COLISIÓN: `app.module.ts`

### Lane A4 — seed-bank import (trabajo en curso, rama seed-bank-sample)
- [x] Finalizar parser + import de `bank-questions/{biologia,COMUNICACION}` (nombre `1d.PNG` → Q1 resp. D)
- [x] Registrar como preguntas-imagen en banco central (tenant_id NULL) + asset por imagen
- [x] Test parser + idempotencia
- ⚠️ COLISIÓN leve: `seed.ts` (coordinar con A2 si toca demo tenant)

---

## WAVE B — orquestación, gate de seguridad y primeras UIs

### Lane B1 — orquestación de PDF (depende de A1)
- [x] Use case GenerateVersions: examen → VersionShuffler → por versión compilar exam.typ + answer-sheet.typ → subir a MinIO → URLs
- [x] Endpoint POST /exams/:id/versions (K versiones, códigos A/B/C)
- [x] Header con logo tenant + nombre + título + código forma
- [x] Hoja de claves separada por versión
- [x] e2e: K versiones, orden barajado, answer_key correcto, PDFs descargables

### Lane B2 — [GATE] tenant-isolation e2e (depende de A1, A2; bank ya está) — SEGURIDAD
- [x] e2e: tenant A NUNCA ve privadas de tenant B (list, selección, por ID directo)
- [x] e2e: tenant A no puede fetch/replace preguntas de examen de B (authorization)
- [x] Banco central (tenant_id NULL) visible a todos
- [x] **Bloquea merge de cualquier feature multi-tenant hasta verde**

### Lane B3 — web banco (bank API ya existe → arranca ya, paralelo a Wave A)
- [x] Componente lista + filtros (curso/tema/dificultad/grado)
- [x] Form subida de pregunta-imagen + clave + taxonomía
- [x] Tests de componente

---

## WAVE C — flujos web restantes (dependen de su backend)

### Lane C1 — web armado de examen (depende de A1)
- [x] Blueprint builder (agregar/quitar filas, validación)
- [x] Pantalla de revisión + reemplazo de pregunta

### Lane C2 — web versiones/descarga (depende de B1)
- [x] Panel de versiones + links de descarga de PDFs y hojas de clave

---

## WAVE D — Fase 2: IA + preguntas estructuradas (el objetivo final)

Puede arrancar el diseño en paralelo a Wave A/B, pero integra al final.

### Lane D1 — módulo `ai` + puerto (independiente)
- [x] `QuestionGeneratorPort` + `OpenRouterAdapter` (structured output, modelo por env `AI_MODEL`, ver ref web-research `openrouter/free-models`)
- [x] Genera JSON validado: enunciado (Typst), alternativas, clave, código figura CeTZ opcional
- [x] Reintento 1x si JSON inválido; nunca guarda sin validar schema
- [x] Adapters alternos detrás del puerto (Gemini/Claude) — opcional
- [x] Tests con respuestas mockeadas (válida, inválida, 429)

### Lane D2 — tipo `structured` (schema + banco) ⚠️ COLISIÓN schema
- [x] Extender `questions`: `body_typst`, `alternatives jsonb`, `figure_code`, `type` incluye 'structured'
- [x] Migración (vía integrador)
- [x] Bank soporta crear/listar structured
- [x] Render Typst de structured en el PDF (mismo estilo que imágenes)

### Lane D3 — workflow draft→revisión→approve (depende de D1)
- [x] Preguntas IA entran como `draft`
- [x] Humano revisa/corrige/aprueba → `approved`
- [x] Vista previa Typst compila ANTES de guardar (bloquea marcado inválido)
- [x] **IA nunca publica directo al banco**

### Lane D4 — barajar alternativas de structured (depende de D2)
- [x] Extender VersionShuffler: structured SÍ baraja alternativas (imagen NO)
- [x] Recalcular answer_key tras permutar alternativas
- [x] Property test: clave correcta tras barajar preguntas Y alternativas

### Lane D5 — web IA (depende de D1, D3)
- [x] Form generación por tema (curso/tema/dificultad/grado/cantidad/con-figura)
- [x] Editor structured con vista previa Typst
- [x] Cola de revisión de borradores

---

## Gates finales antes de "producto listo"

- [x] **[GATE]** answer_key post-shuffle (imagen) ✅ ya
- [x] **[GATE]** golden .typ ✅ ya
- [x] **[GATE]** tenant-isolation e2e (Lane B2) — pendiente, crítico
- [x] **[GATE]** answer_key tras barajar alternativas structured (Lane D4)
- [x] Smoke e2e completo: login → banco → blueprint → versiones → PDF descargable, con tenant real + logo
- [x] IA: generar → revisar → aprobar → aparece en examen, end-to-end

---

## Ruta crítica (lo que desbloquea todo)

`A1 (exams wiring)` → `B1 (PDF orchestration)` + `B2 (tenant gate)` → smoke completo.
Sin A1 no hay producto. Es el primer carril a tomar. Todo lo demás (tenants, auth, UIs, IA) cuelga o corre en paralelo alrededor de esa espina.
