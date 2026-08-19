# Auditoría — Rol `teacher`

> Generada 2026-08-18. Cierra la primera de las "Zonas no auditadas" de
> [`docs/audit-frontend-exams-2026-08-15.md`](./audit-frontend-exams-2026-08-15.md):
> las tres auditorías anteriores corrieron **enteras** como `school_admin`, así que el rol
> que usa el producto todos los días nunca se había ejercitado.
>
> **Método**: se creó un profesor real (`POST /users` como `school_admin`, que es el flujo por
> el que nace un profesor en producción), se hizo login con la contraseña temporal que devuelve
> ese endpoint, y se probó cada endpoint que la web pide en las pantallas a las que el rol
> llega. Evidencia = código de estado real contra la API corriendo, no lectura de código.
>
> Prioridades: **P0** = roto, engaña o bloquea · **P1** = claramente no profesional o frágil ·
> **P2** = pulido.

Legend: `[ ]` todo · `[~]` in progress · `[x]` done

---

## Superficie del rol (medida)

Un `teacher` llega a: Panel, Banco (+ Nueva pregunta), Exámenes (lista, armar, revisar,
formas) y todo el grupo Inteligencia (Generar con IA, Cola de revisión, Historial IA).
No llega a Configuración (`school_admin`) ni a Colegios (`platform_admin`) — las rutas tienen
`roleGuard` y el sidebar oculta el grupo entero. Coherente en las dos capas.

Endpoints que la web pide desde esas pantallas, con token de profesor:

```
200  GET /dashboard/stats            200  GET /exams
200  GET /bank/questions             200  GET /bank/questions/summary
200  GET /courses                    200  GET /topics
200  GET /universities               200  GET /exam-types
200  GET /exams/stock/grades         200  GET /ai/questions/jobs
403  GET /tenants/:suyo              ← el único hallazgo
403  GET /users                      403  GET /tenants     ← correctos: pantallas que no ve
```

---

## P1

- [x] **El profesor ve "GeneraExamen" donde debería decir el nombre de su colegio.**
      `ShellComponent` pide el nombre del colegio para **cualquier** rol logueado (es el título
      del topbar, `shell.component.html:22`), y lo hace vía `GET /tenants/:id`, que estaba
      `@Roles(PlatformAdmin, SchoolAdmin)`. Un profesor recibía **403**, y el shell traga el
      error (`error: () => {}`, puesto a propósito para que `platform_admin` no crashee) →
      cae al fallback `'GeneraExamen'`. Sin error visible, sin log, sin pista: el profesor
      simplemente ve el nombre del producto en vez del de su colegio, en todas las pantallas.

      Es el mismo patrón que el P0 ya cerrado de esta serie ("decirle al profesor lo mismo del
      examen en cada pantalla"): la UI no miente a propósito, se queda callada.

      **HECHO** (`apps/api/src/modules/tenants/tenants.controller.ts`): `GET /tenants/:id` ahora
      acepta también `Role.Teacher`. Decisiones:
      - **Solo la lectura.** `PATCH`, `DELETE` y `POST /:id/logo` siguen sin el rol: leer el
        nombre del colegio no es permiso para renombrarlo.
      - **No hace falta más guard.** `TenantGuard` ya fija la fila al tenant del token, así que
        un profesor solo puede leer el suyo — se agregó el test que lo prueba (403 contra otro).
      - **La fila no lleva nada privado**: `id`, `name`, `slug`, `city`, `logoAssetId`, `active`.
      - **Sin cambio en el front**: el shell ya hacía la llamada para todos los roles; lo que
        fallaba era el permiso.

      3 tests nuevos en `tenants.e2e.spec.ts` (lee el suyo → 200, lee otro → 403, `PATCH` del
      suyo → 403). Rojo antes, verde después. Suite `tenants` e2e **17/17**, API non-e2e
      **859/859**. Verificado contra la API corriendo con token de profesor real:
      `{"name":"Colegio Demo", …}` con **HTTP 200**.

## P2

- [x] **El menú de usuario no dice quién eres.** `shell.component.html:37-60`: un ícono
      genérico de persona y un solo ítem, "Cerrar sesión". Ni nombre, ni email, ni rol, ni
      colegio. En un producto multi-rol y multi-colegio, donde el único indicio de en qué
      cuenta estás es el título del topbar, no hay forma de distinguir una sesión de profesor
      de una de administrador salvo por qué ítems faltan en el sidebar.

      **HECHO** — el menú ahora muestra nombre, email y un chip de rol, alimentados por un
      `GET /auth/me` nuevo. Decisiones:
      - **Endpoint nuevo, no engordar el JWT.** Un token no se refresca cuando el usuario cambia
        de nombre; una fetch sí.
      - **Vive en `AuthController`, no en `UsersController`.** Ese último es
        `@Roles(SchoolAdmin)` a nivel de clase y saca el tenant del token con `requireTenant()`,
        que lanza para el staff de plataforma sin tenant. Un `me` colgado ahí habría dado 403 a
        todos los demás roles y roto a `platform_admin`/`content_editor`. "Quién soy" es
        identidad, no gestión de usuarios del colegio.
      - **Lee la fila por el `sub` del JWT**, nunca por un id que mande el cliente, y selecciona
        columnas explícitas para que el hash de contraseña no pueda filtrarse.
      - `name` es nullable en la base, así que la línea principal cae al email cuando no hay
        nombre.
      - El `roleLabel()` de dos roles que vivía dentro de `tenant-settings` pasó a un util
        compartido con los cuatro roles; las dos pantallas usan el mismo mapeo.

      API non-e2e **860/860**, API e2e **204/204**, web **777/777**. Verificado en la app
      corriendo como profesor real: `Profesora QA · profe.qa@colegio-demo.test · Profesor`.

## Hallazgo de la pasada visual

- [x] **"Mis exámenes" no son sus exámenes.** El nav y el `h1` dicen **"Mis exámenes"**, y la
      lista trae **todos los exámenes del colegio**: `listExams()` filtra por `tenantId`, nunca
      por `createdBy` (`apps/api/src/modules/exams/exams.repository.ts:247-252`), aunque la
      columna `created_by` existe (`exams.schema.ts:39`). Medido: el profesor recién creado, que
      no ha armado nada, abre el panel y ve **10 exámenes** que hizo el administrador — y el
      controller es `@Roles(Teacher, SchoolAdmin)` a nivel de clase, así que además puede
      renombrarlos, duplicarlos y **borrarlos**.

      La propia app ya se contradice: el `<title>` de esa ruta dice **"Exámenes"**, el `h1` dice
      **"Mis exámenes"**.

      **No se tocó: es una decisión de producto, no un bug de una línea.** Hay dos lecturas y
      dan trabajo distinto:
      1. Los exámenes son del **colegio** (espacio compartido) → lo que miente es la etiqueta;
         se renombra a "Exámenes" en el nav, el `h1` y los 3 specs de `shell.component.spec.ts`
         que hoy fijan el string.
      2. Los exámenes son **personales** → lo que miente es la consulta; hay que filtrar por
         `createdBy`, decidir qué ve el `school_admin` (¿todo el colegio?) y qué pasa con los
         exámenes ya creados.

      **RESUELTO el 2026-08-18 por la lectura 1** (los exámenes son del colegio): se renombró la
      etiqueta a "Exámenes" en el nav, el `h1`, los 3 specs y 4 comentarios/docstrings que la
      nombraban. Los datos, la consulta y los guards quedaron intactos. Web **773/773** en ese
      commit. Si la lectura correcta era la 2, se revierte en un commit y el trabajo real
      (filtrar por `createdBy`) sigue pendiente.

---

## Pendiente de esta auditoría

- [x] **Pasada visual en vivo con el rol** — hecha el 2026-08-18 con Playwright headless sobre
      la app corriendo (1440×900), login real como `profe.qa@colegio-demo.test`. Resultado:
      - El fix del nombre del colegio se ve: topbar dice **"Colegio Demo"** en las 6 pantallas
        del rol (el fallback "GeneraExamen" solo aparece <300 ms mientras resuelve la fetch,
        igual que para `school_admin`).
      - Sidebar del profesor: Panel · Banco de preguntas · Mis exámenes · Generar con IA ·
        Cola de revisión · Historial IA. Sin grupo Colegio ni Administración.
      - `/app/settings` y `/app/admin/tenants` tecleadas a mano → **`/forbidden`** con
        "No tienes acceso a esta página". El guard no depende del nav.
      - **Cero errores de consola y cero requests ≥400** en todo el recorrido.
      - Panel, banco, armado de examen, generar con IA, cola de revisión e historial cargan y
        renderizan datos reales.

---

## No son hallazgos (verificados y sanos)

- **El gateo del banco no depende del rol, y está bien así.** `bank-list` esconde
  editar/archivar/borrar cuando la pregunta es central (`origin === 'central'` o
  `tenantId === null`), espejando `canManageQuestionTenant` del back. `school_admin` y
  `teacher` son ambos `TENANT_ROLES`: ven y pueden lo mismo sobre las preguntas de su colegio,
  y ninguno toca las 64,257 centrales. Sin botones muertos.
- **El sidebar no muestra rutas que terminarían en 403.** El único link condicionado por rol
  dentro de un grupo visible es `/app/exams` (`EXAMS_ROLES`), y `teacher` está adentro.
- **`GET /users` y `GET /tenants` en 403 son correctos**, no hallazgos: son las pantallas de
  Configuración y Colegios, que el rol no ve.
