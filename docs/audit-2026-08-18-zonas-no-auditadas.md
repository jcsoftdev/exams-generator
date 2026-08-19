# Auditoría — Las zonas que ninguna auditoría había tocado

> Generada 2026-08-18. Cierra tres de las "Zonas no auditadas" que arrastraban
> [`docs/audit-frontend-exams-2026-08-15.md`](./audit-frontend-exams-2026-08-15.md) y
> [`docs/audit-2026-08-14.md`](./audit-2026-08-14.md): **visibilidad cross-tenant**,
> **cola de revisión IA + historial IA**, y **modo oscuro**. El rol `teacher` se cerró aparte,
> en [`docs/audit-teacher-role-2026-08-18.md`](./audit-teacher-role-2026-08-18.md).
>
> Tres agentes en paralelo, uno por zona. Cada hallazgo lleva su evidencia y dice si se probó
> con un request/medición o si solo se leyó el código.
>
> Prioridades: **P0** = roto, engaña o bloquea · **P1** = no profesional o frágil · **P2** = pulido.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## P0 — Cualquier usuario autenticado podía tumbar la API entera

- [x] **Abrir un job que no existe mataba el proceso.** Las dos rutas SSE hechas a mano
      llamaban `res.flushHeaders()` —poniendo un `200 OK` irreversible en el cable— **antes**
      de buscar el job. Un id desconocido o de otro colegio hacía que `service.get()` lanzara
      `NotFoundException`, y `AllExceptionsFilter` intentaba escribir el 404 sobre una
      respuesta ya empezada: `ERR_HTTP_HEADERS_SENT`, sin capturar, proceso abajo.

      **Reproducido en vivo antes de tocar nada** (no deducido):
      ```
      health 200                                        ← antes
      GET /ai/questions/jobs/0000…0000/stream → 200 OK   ← miente: el job no existe
      health 000                                        ← 2 segundos después: conexión rechazada
      ```
      No es "esta pantalla falla": es el colegio entero sin API hasta que alguien la reinicie a
      mano, y el docente que lo gatilla ni se entera — su pantalla solo se queda cargando. Basta
      un bookmark viejo o un id mal tipeado en `/app/ai/jobs/:id`.

      **HECHO**, dos rutas, no una — eran copia byte a byte:
      - `GET /ai/questions/jobs/:id/stream` (`ai-jobs.controller.ts`)
      - `GET /exams/:examId/versions/jobs/:jobId/stream` (`exams.controller.ts`)

      La búsqueda del job subió por encima del bloque de headers, así que el `NotFoundException`
      vuelve a viajar por el camino normal de Nest y el cliente recibe un 404 de verdad. Los dos
      llevan un comentario **`ORDERING IS LOAD-BEARING`**: sin él, el próximo que pase "ordena"
      el bloque de headers de vuelta arriba y revive el P0.

      **La tercera ruta SSE se dejó intacta a propósito.** `AiController.generateStream()` es
      segura por estructura, no por casualidad: todo lo que corre después del flush vive dentro
      de un `new Observable(...)` cuyo cuerpo async está íntegramente en try/catch, y reporta
      cualquier fallo como evento `done`, sin lanzar. Agregarle un chequeo redundante habría
      sido ruido.

      **Segunda línea de defensa** (`common/all-exceptions.filter.ts`): el filtro ahora chequea
      `response.headersSent` antes que nada — loguea y destruye el socket, nunca `res.json()`.
      Una ruta SSE mal ordenada en el futuro cuesta **una conexión caída, no el proceso**. Las
      dos ramas existentes quedaron byte a byte iguales: ningún `HttpException` cambió de forma.

      Verificado en vivo tras el fix: `404` en la ruta, `200` en `/health`. 16 tests nuevos
      (6 e2e que cubren ambas rutas + cross-tenant + controles positivos, 6 del filtro —3 de
      ellos fijando el comportamiento normal preexistente—, y los de los dos controllers).

---

## Cross-tenant: sin fugas

Se probaron **más de 40 rutas** con requests reales (no lectura de código): un usuario del
colegio A estirando la mano hacia filas del colegio B, en exámenes (leer, listar, renombrar,
duplicar, confirmar, reemplazar pregunta, formas, ZIP, borrar), banco (leer, editar, archivar,
borrar, aprobar, rechazar, imagen, preview), jobs de IA (leer, cancelar, encadenar), assets,
usuarios, tenants y dashboard.

**Ninguna ruta devolvió 2xx con datos de otro colegio.** Confianza 95%: cada línea es un status
observado. El 5% restante son las rutas sin id de recurso (creates, `preview`,
`blueprint/resolve`, taxonomía), juzgadas leyendo el código, y no se fuzzearon params
malformados ni con valores de arreglo.

Quedó como **`apps/api/src/modules/auth/cross-tenant.e2e.spec.ts`, 54 tests**. Dos decisiones
que valen para quien lo lea después:
- Cada bloque abre con un **control positivo**, para que un 404 verde no pueda ser un id mal
  tipeado que "pasa" por accidente.
- Las preguntas del **banco central** se afirman en **200 a propósito**: son compartidas por
  diseño, así que un futuro filtro por tenant demasiado entusiasta tiene que romper ruidosamente.

**Hallazgo de método**: `TenantGuard` solo es utilizable en `/tenants/*`, porque compara el
token contra un route param que tiene que ser **un id de tenant**. En todas las demás rutas el
filtro del repositorio es lo único que separa a un colegio de otro — no hay guard que lo
respalde. Vale saberlo antes de agregar una ruta nueva con id.

---

## Modo oscuro

- [x] **P0 — Tres títulos de pantalla eran invisibles.** `text-primary-900` (`#072034`) usado
      como color de **texto** sobre fondos igual de oscuros: **1.02:1** contra `bg-surface`
      (`#1c2127`), o sea el mismo color que el fondo. En `ai-generate`, `generation-history` y
      el contador grande `N/M` de `generation-job-detail`.
      **HECHO**: `text-n900`, que es lo que ya usaba toda otra pantalla (`exam-list`,
      `bank-list`, `admin-tenants`). Oscuro **1.02:1 → 14.34:1**; claro 13.01:1 → 15.59:1, los
      dos casi negro, sin cambio perceptible.

- [x] **P0 — Los gráficos del Panel se quedaban con la paleta del tema anterior.** `PALETTE`
      era una constante de **módulo** resuelta con `getComputedStyle` una sola vez, al cargar el
      chunk; el toggle solo cambia `data-theme`. Entrar en claro y cambiar a oscuro sin recargar
      dejaba la barra pintando `#fef3c7` sobre una UI ya oscura. Recargar lo tapaba — por eso
      sobrevivió tanto. Es el primer screen que ve cualquiera y se dispara con el botón más
      obvio del topbar.
      **HECHO**: la paleta es un `computed()` que depende del signal del tema, resuelto en
      render. Verificado en vivo: la barra pasa de `#fef3c7` a `#78350f` al tocar el toggle, sin
      recargar.

- [x] **P1 — Contraste bajo AA en modo oscuro, cuatro sitios.** El peor por alcance: la variante
      `ghost` de `ui-button`, **3.08:1**, en **49 usos de 10 archivos** — casi toda acción
      secundaria de la app ("Abrir", "Cancelar", "Editar", "Rechazar", "Renombrar"). Más los
      links del Panel (2.21:1), dos contadores de fila con `text-n400` (2.12:1) y el chip de OCR
      (2.15:1).
      **HECHO**, reusando tokens en vez de redefinirlos: `ghost` pasó a `--color-tint-text`, que
      ya es el token de "texto de marca sobre superficie" y cuyo valor **claro es idéntico** al
      de `primary-500` — así el modo claro queda pixel por pixel igual y el oscuro sube a
      7.58:1. Redefinir `--color-primary-500` habría reencendido los `bg-primary-500` (botón
      sólido, barra de progreso) que ese mismo token maneja.
      El chip de OCR resultó no ser un problema de color de texto sino del `/40` de opacidad,
      que lo diluía contra la superficie oscura hasta que ningún texto pasaba en ambos temas:
      se quitó la opacidad (2.15:1 → 9.08:1).

      **Efecto colateral declarado**: los links del Panel sí cambian de tono en modo claro
      (`#4a5aa8` → `#5a6acf`, 6.33:1 → 4.78:1). Sigue pasando AA, pero es un cambio visible en
      claro — se revierte solo ese si molesta.

- [x] **P2 — Sin `color-scheme` declarado.** Los controles nativos del navegador (el file picker
      de Configuración, scrollbars) seguían la preferencia del **sistema operativo**, no el
      toggle de la app. Agregado. **No verificado visualmente**: hace falta un SO en modo oscuro
      real, que este entorno headless no tiene.

**Lo sano, para que nadie lo vuelva a auditar**: cero fugas de la paleta Tailwind por defecto en
todo `apps/web`. `text-n500`, que a ojo parecía sospechoso, mide **4.96:1** y pasa. El `bg-white`
de los `iframe` de vista previa es intencional en ambos temas (papel de impresión) y ya estaba
documentado.

---

## Cola de revisión IA e Historial IA

- [ ] **P1 — `approve()` y `confirmReject()` no tienen guard de doble click.**
      `ai-review-queue.component.ts:491-516` dispara el POST sin ningún signal de "en vuelo".
      Son las **únicas** dos acciones mutantes de estas pantallas sin ese guard: `saveEdit()`
      chequea `editSaving()`, `reviseWithAi()` chequea `revising()`, y en la pantalla hermana
      `cancel()` y `retry()` chequean el suyo. Dos clicks mandan dos `POST .../approve`.
      Lectura de código, confianza 90% — no se pudo reproducir en pantalla porque la API se cayó
      (por el P0 de arriba) antes de llegar a esa prueba.

- [ ] **P1 — Editar un borrador y navegar pierde todo, sin aviso.** El formulario de edición
      (cuerpo Typst, alternativas, figura CeTZ, instrucción de IA) vive solo en signals del
      componente. `rg 'CanDeactivate|beforeunload'` sobre todo `apps/web/src`: **cero
      resultados**. Es el mismo bug que ya se cerró en el builder de exámenes con
      `sessionStorage`; la cola de revisión no recibió ese parche. Lectura de código, 95%.

- [ ] **P2 — Empty state duplicado.** Con la cola vacía, la columna izquierda dice "No hay
      borradores por revisar." y el panel derecho, al mismo tiempo, "La cola está vacía."
      (`ai-review-queue.component.html:147-149`). Ninguno miente; es ruido.

**Premisa vieja que resultó muerta**: el ítem que arrastraba `docs/audit-2026-08-14.md` sobre
`listDrafts()` devolviendo el arreglo completo sin paginar **ya no aplica**. Ese método no
existe: hoy son `listDraftsPaged(page, pageSize)` + `countDrafts()`, con `ui-pagination` y el
badge del sidebar sembrado del `total` del servidor, nunca de `drafts().length`. Se arregló en
un commit anterior a esta sesión. No hay riesgo de truncado silencioso a 100 filas.

---

## Zonas que siguen sin auditar

- Estados de red caída / API caída en el flujo de generación.
- Viewport móvil (390×844) en modo oscuro — solo se probó desktop 1440×900.
- Generación IA real end-to-end (gasta cuota de OpenRouter).
- El detalle de una pregunta abierta en el banco, y la tabla real de `/app/admin/tenants`
  (requiere un `platform_admin` con contraseña utilizable; el sembrado no tiene una).
- Fuzzing de params malformados o con valores de arreglo en las rutas con id.

---

## Nota de proceso, para la próxima tanda

Dos de los tres agentes trabajaron sobre la **misma zona de la API** en paralelo y se pisaron:
uno editó los mismos controllers mientras el otro corría sus suites, y llegó a matarle dos
corridas de jest. Es exactamente lo que ya advertía la tanda 3 de `docs/audit-2026-08-14.md`, y
se repitió. Los agentes de web y de API no chocaron entre sí.

Regla que salió de acá: **dos agentes en paralelo sí, pero nunca sobre el mismo módulo** —
o van con `isolation: "worktree"`, o van en serie. Lo mismo con el directorio de capturas: dos
agentes compartiendo scratchpad se sobreescribieron los screenshots con los mismos nombres, y
uno perdió toda su evidencia visual.
