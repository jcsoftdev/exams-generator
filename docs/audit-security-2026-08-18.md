# Auditoría de seguridad y privacidad (2026-08-18)

Primera pasada sobre el módulo que nunca se corrió (el propio audit de producto lo advirtió:
"que no reporte hallazgos NO significa que no los haya"). App multi-tenant con datos de
menores. Todo lo de abajo está verificado contra la app corriendo o el código, no deducido.

## 🔴 P0 — Secreto JWT forjable (ARREGLADO, `5ec9375`)

`resolveJwtSecret()` caía a `"change-me-in-every-environment"` si `JWT_SECRET` no estaba, y ese
default está en el repo público (`env.example`). **Reproducido**: firmé un token
`platform_admin` con el default y `GET /tenants` respondió 200 — la lista de todos los
colegios. El compose de prod guarda el valor con `${JWT_SECRET:?...}`, pero eso solo cubre el
arranque por compose; un `node dist/main` suelto lo saltea. **Fix**: en producción un secreto
ausente/débil/corto aborta el arranque en vez de firmar.

## 🟠 P1 — id malformado → 500 (ARREGLADO, `78694d9`)

`GET /exams/not-a-uuid` daba 500 (Postgres rechazando el cast a `uuid`); un UUID inexistente da
404. No es SQLi (drizzle parametriza). `ParseUUIDPipe` en los 29 params uuid → 400 en el borde.

## 🟡 MITIGADO — Desactivar un usuario no corta su token vigente

**Verificado**: `JwtAuthGuard` solo valida firma + expiración; nunca consulta `active` en la DB.
El login SÍ bloquea a un desactivado (`auth.service.ts:36`), así que un desactivado no obtiene
un token NUEVO — pero el token que ya tenía sigue sirviendo hasta expirar (**TTL = 24h**, sin
revocación).

**Impacto**: moderado. Un docente despedido o una cuenta comprometida conserva acceso completo
a SU tenant hasta 24h. Acotado por: login ya bloqueado, scope de tenant, y que requiere tener
un token vigente en el momento de la desactivación.

**Por qué no se arregló en esta pasada** (se intentó y se revirtió, a conciencia):
El fix natural — que el guard revalide `active` en cada request — es un lookup por PK sub-ms,
PERO:
1. Es un cambio en el hot-path de CADA request autenticado (latencia + una dependencia de DB
   nueva en el guard, que hoy es stateless a propósito).
2. Al aplicarlo, 11 tests e2e rompieron: unos porque firmaban tokens de usuarios que nunca
   insertan (`taxonomy.e2e` usa `sub: randomUUID()`) — justo el agujero que el fix cierra — y
   otros (`bank.e2e`) que **pasan aislados pero fallan bajo `--maxWorkers=4`**: el lookup
   por-request interactúa mal con el paralelismo recién habilitado.
3. Arregla un hallazgo moderado, no un P0.

Es una decisión de arquitectura con costo por request — **del dueño del producto, no del
auditor**. Opciones, de menor a mayor cambio:
- **Bajar el TTL** — ✅ HECHO (`token.service.ts` `TOKEN_TTL` 24h → **8h**, `<commit>`). Acota
  la ventana a una jornada sin tocar el hot-path. El 401 redirige limpio a `/login?expired=1` y
  el builder persiste el trabajo en curso, así que expirar a media sesión es recuperable. 8h y
  no 1h para no expulsar al docente cada hora. Un test ancla el techo (`token.service.spec.ts`).
- **Guard revalida `active`** con un cache de TTL corto (p.ej. 60s en memoria/Redis): revocación
  casi-inmediata sin un DB hit por request. Más código, requiere sembrar usuarios reales en los
  ~11 e2e que hoy toman atajos.
- **Lista de revocación / versión de token**: revocación exacta, el cambio más grande.

Estado: **ventana bajada de 24h a 8h** (hecho). Si se quiere corte inmediato (mismo minuto),
queda el cache de `active` con TTL corto en el guard — más código y sembrar usuarios reales en
los ~11 e2e que hoy toman atajos; decisión de producto por el costo por request.

## 🟡 HALLAZGO ABIERTO — Password temporal sin cambio obligatorio

`resetPassword` (admin-only, tenant-scoped) genera una temporal fuerte (`randomBytes(9)`,
72 bits) y la devuelve al admin. **Pero no hay flag de "cambiar en el próximo login"**: el
docente puede quedarse con la temporal indefinidamente. `users.schema.ts` no tiene
`must_change_password` ni `password_changed_at`. Fix: columna + chequeo en login que fuerce el
cambio. Producto decide si vale la fricción.

## ✅ Verificado y sano

- **Aislamiento cross-tenant**: 54 e2e (`2988c76`), cada endpoint con id incluidos assets
  (PDFs, hojas de claves), con control positivo. Verde.
- **Fuerza bruta al login**: `@Throttle` 5/min, corta con 429 al 6º intento (medido).
- **CORS**: regex anclado, dots escapados; `evil.com` y `evilcreaexamen.com` NO reciben ACAO,
  un subdominio de tenant legítimo sí (medido). `credentials: false` (Bearer header, sin
  cookies → sin CSRF).
- **Helmet/HSTS/CSP/X-Content-Type-Options**: presentes en respuestas reales.
- **Passwords en reposo**: bcrypt, 10 rounds, salt automático. El `passwordHash` nunca sale del
  repositorio (se selecciona explícito para comparar, el DTO de usuario lo descarta).
- **Passwords en logs**: pino no loguea body; `authorization` redactado. Verificado en un log
  de login real: sin fuga.
- **Errores 500**: `AllExceptionsFilter` devuelve `"Internal server error"` genérico, nunca el
  stack (verificado con un body de 5.3mb y un cast de uuid fallido).

## 🔴 HALLAZGO ABIERTO — Borrar un colegio está roto, y no hay borrado real de datos

**Verificado en la DB de producción-local**: `DELETE /tenants/:id` (endpoint vivo,
`platform_admin`) ejecuta `db.delete(tenants).where(id)` **pelado, sin cascada**. Las 8 tablas
que referencian `tenants` (users, assets, questions, exams, generation_jobs,
exam_blueprint_templates, cycles, exam_version_jobs) tienen FK **restrict** (`ON DELETE NO
ACTION`). Reproducido: crear un tenant con UN user y borrarlo →
`violates foreign key constraint "users_tenant_id_tenants_id_fk"`. En la app eso sale como
**500**.

**Falsa confianza del test**: el e2e "allows platform_admin to delete a tenant" pasa porque
usa `createTenantFixture()` — un tenant VACÍO. El endpoint nunca se ejerció contra un colegio
con datos. Verde ≠ funciona.

**Doble impacto**:
- **Funcional**: no se puede dar de baja un colegio que tenga cualquier dato.
- **Privacidad / derecho al olvido**: no existe NINGUNA vía para borrar los datos de un colegio.
  (Atenuante real: la app **no guarda PII de alumnos** — solo cuentas de docentes/admin
  (email+name) y el nombre del colegio; los exámenes son documentos, los alumnos rinden en
  papel. El riesgo legal es bajo, pero el borrado sigue sin existir.)

**Por qué no se arregló acá**: el fix es una cascada destructiva sobre ~12 tablas (el grafo es
profundo: exams→versions/questions/blueprint_rows, questions→alternative_images,
templates→syllabus/rows…) MÁS purgar los objetos de MinIO del tenant (las filas de `assets` se
van con la cascada, pero los objetos S3 quedan huérfanos si no se recogen sus `storage_key`
ANTES de borrar). Y la SEMÁNTICA es decisión de producto: ¿hard-delete inmediato?
¿soft-delete con período de gracia? ¿export obligatorio antes? Eso no lo decide el auditor.

**Opciones de implementación** (cuando se decida la semántica):
1. **FK `ON DELETE CASCADE`** vía migración: Postgres ordena el borrado. Menos código,
   imposible equivocar el orden. Contra: la cascada queda "encendida" para siempre.
2. **Transacción con deletes ordenados** en el service: explícito y auditable, sin cambio de
   schema. Contra: hay que enumerar las ~12 tablas hijas en orden de FK y mantenerlo al día.
   Ambas necesitan: recoger los `storage_key` del tenant ANTES, borrar, purgar MinIO después,
   y un e2e que borre un tenant CON datos (user+exam+asset) y verifique 200 + que los datos de
   OTRO tenant sobreviven.

## No auditado todavía

- Retención de datos / borrado de PII de menores (¿qué pasa con las preguntas y exámenes de un
  tenant borrado? ¿hay derecho al olvido?).
- Rate-limiting de los endpoints de IA (costo — se cruza con el módulo Cost).
- Contenido de los assets subidos (¿se valida que un "png" sea un png? ¿tamaño?).
