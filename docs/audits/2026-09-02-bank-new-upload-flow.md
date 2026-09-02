# Auditoría — Subida de preguntas por foto (`/app/bank/new`)

**Fecha:** 2026-09-02
**Alcance:** pantalla "Nueva pregunta", tab "Foto de la pregunta": subir imagen → "Extraer con IA" → revisión de recortes → guardar (tipo `structured` o `image` cruda). No se auditó el resto del producto.
**Pregunta del usuario:** ¿la UI es intuitiva y se cumple el flujo correcto?

## Resumen ejecutivo

El flujo de guardado crudo funciona de punta a punta (verificado en browser: `POST /bank/questions/image` → 201 → la pregunta aparece en el banco). El flujo con IA **no pudo ejecutarse**: el `.env` local no tiene `OPENROUTER_API_KEY` ni `AI_API_KEY`, y esa ausencia expuso el hallazgo más grave: el API responde 500 y la UI le dice al profesor "Inténtalo de nuevo" ante un error de configuración que ningún reintento arregla.

En intuitividad, el patrón que se repite es **silencio**: guardar no confirma nada, extraer cambia de tab sin avisar, el botón de IA está deshabilitado sin decir qué falta, "arrastra una imagen" no arrastra nada, y ninguno de esos estados se anuncia a un lector de pantalla. El editor de recortes es solo-mouse con handles de 8 px.

**Refutación:** modo cross-model. Finder `claude-fable-5-1`, refutadores `claude-opus-5` (uno por hallazgo, contexto limpio). 20 hallazgos elegibles (Medium o más): 16 sobreviven intactos, 2 debilitados a Low, 1 indeterminado (tope Medium), 1 refutado. 8 hallazgos Low/Info quedaron sin refutar por umbral.

| Severidad | Hallazgos que sobreviven |
|---|---|
| High | 3 |
| Medium | 13 |
| Low | 10 |
| Info | 2 |

## Descubrimiento

- Monorepo pnpm/Turborepo. Web: Angular standalone + signals. API: NestJS. Infra local: postgres 5439, minio 9030/9003, redis 6390, api 3012, web 4201.
- project-brain estaba con 14 chunks (índice vacío en la práctica); se lanzó `sync_project` y el descubrimiento se hizo con `rg`/lectura directa.
- Specs que el flujo declara implementar: `docs/superpowers/specs/2026-07-20-bank-new-photo-ai-extract-design.md`, `2026-08-24-ai-question-image-crop-design.md`, `2026-08-25-ocr-figure-detection-design.md`. Se leyeron **después** del código y se trataron como afirmaciones bajo prueba, no como evidencia.

## Mapa del flujo (probado)

**Guardado crudo (ejecutado, OK):** `bank-new.component.html:114` "Guardar pregunta" → `submitPhoto()` (`bank-new.component.ts:386`) → `BankService.uploadImageQuestion` → `POST /bank/questions/image` (`bank.controller.ts:148`) → 201 → `router.navigate(['/app/bank'])` (`:402`). Terminal, sin feedback.

**Extracción con IA (ejecutado hasta el error):** `bank-new.component.html:118` → `extractWithAi()` (`:413`) → `POST /ai/questions/extract` (`ai.controller.ts:183`) → `ExtractQuestionService.extract` → `LazyQuestionGeneratorAdapter.resolve()` → `resolveAiProviderConfig` lanza `Error("No API key set…")` → `mapAiProviderError` rethrow → `AllExceptionsFilter` 500 → web `extractErrorMessage` fallback "No se pudo leer la pregunta desde la imagen. Inténtalo de nuevo."

**Crop-review → guardado structured (solo estático):** `onRecrop`/`onDiscard` (`:517-571`) → `submitStructured()` (`:606`) → create → `attachStructuredImageAndFinish` → `attachAlternativeImagesAndFinish` → navigate. Falla parcial tras crear: `failAfterCreate()` conserva `sCreatedQuestionId` y el reintento solo repite las subidas. Correcto.

## Módulos corridos

| Módulo | Estado |
|---|---|
| Flow Integrity | corrido |
| Functional | corrido |
| Frontend | corrido |
| Accessibility | corrido |
| Runtime (browser, Playwright MCP) | corrido con autorización explícita; comandos: `pnpm --filter @exams-generator/api dev` (declarado), web y docker ya estaban arriba |
| Resto | fuera de alcance por decisión del usuario |

## Hallazgos por severidad

Formato: severidad · tier de evidencia · confianza · refutación.

### High

**H1. Extraer con IA sin API key configurada → 500 y mensaje "Inténtalo de nuevo"**
executed · 95 · unrefuted (cross-model)
`resolve-ai-provider-config.ts:45-50` lanza un `Error` plano; `ai.controller.ts:71-82` solo mapea `AiRateLimitError`/`AiInvalidResponseError`/`AiGenerationError` y rethrow el resto; `all-exceptions.filter.ts:57-61` responde 500 genérico; `extract-error-message.ts:40-45` manda todo `status >= 500` al fallback y `bank-new.component.ts:469` pone el texto de reintento. No hay validación al arrancar (`rg AI_API_KEY|OPENROUTER_API_KEY` solo toca el resolver).
Impacto: en cualquier despliegue sin key, cada profesor ve un error "reintentable" que nunca se resuelve; soporte no tiene pista.
Recomendación: (1) fallar al boot con `ConfigModule` validation o al menos loguear WARN; (2) tipar el error como `AiNotConfiguredError` → 503 con `code: "ai_not_configured"`; (3) en web, mensaje "La extracción con IA no está habilitada en este colegio. Escribe la pregunta o guarda la foto." y ocultar el botón si el backend expone la capacidad.

**H2. Ajustar un recorte no tiene camino por teclado**
read · 92 · unrefuted
`crop-review.component.html:9-33` solo `(pointerdown|move|up|cancel)`; sin `tabindex`, `role` ni `(keydown)` en `crop-review.component.ts` (232 líneas). No existe `@Directive` en toda la web que sintetice punteros. "Aplicar recorte" con teclado reenvía la caja sin modificar: no-op garantizado.
Recomendación: contenedor focusable con flechas (mover) y Shift+flechas (redimensionar), o inputs numéricos x/y/w/h que alimenten `applyBox()`.

**H3. Handles de redimensión de 8×8 px**
read · 90 · unrefuted
`crop-review.component.html:27` `h-2 w-2` sin padding ni pseudo-elemento; no hay `tailwind.config` ni `--spacing` en `styles.css` que lo cambie. Con `MIN = 0.02` (`crop-review.component.ts:194`) en un contenedor de 256 px, la caja mínima mide 5 px y los handles opuestos se superponen. WCAG 2.2 SC 2.5.8 pide 24×24; el copy dice "arrastra", así que el objetivo real es 44×44.
Recomendación: mantener el punto visual y ampliar el hit-area invisible (`before:` de 24-44 px), o permitir arrastrar el borde completo.

### Medium

**M1. Guardar no da ningún feedback de éxito** — executed · 90 · unrefuted
`bank-new.component.ts:402, 690, 697` navegan sin extras; no existe toast/snackbar/aria-live en la app (13 archivos con `role="alert"`, todos de error); `bank-list` no inyecta `ActivatedRoute`, no puede resaltar nada. Observado: tras 201, el banco aparece colapsado con "Selecciona una pregunta para ver el detalle."
Recomendación: navegar con `state: { createdId }`, expandir curso/tema y resaltar la fila; o un toast "Pregunta guardada" con link.

**M2. "Arrastra una imagen" no arrastra nada** — executed · 92 · unrefuted
`bank-new.component.html:63-92` y `:198-236` (dos veces): input `sr-only` de 1×1 px dentro de un label; cero bindings `(drop|dragover|dragenter)` en toda la web. Un drop sintético dejó `input.files` en 0. En un browser real, soltar un archivo sobre el label dispara la acción por defecto (abrir la imagen), perdiendo el formulario.
Recomendación: `(dragover)` con `preventDefault` + `(drop)` que llame a `setImage(file)`, o quitar la palabra "arrastra".

**M3. Foco de teclado invisible en el control de subida** — executed · 90 · unrefuted
Tab llega al input 1×1 (outline auto 1px sobre 1 px); el label no tiene `focus-within`; `styles.css` no define ninguna regla de foco. Duplicado en el tab "Escribir pregunta".
Recomendación: `focus-within:ring-2 focus-within:ring-primary-500` en el label.

**M4. "Extraer con IA" deshabilitado sin decir qué falta** — executed · 88 · unrefuted
`bank-new.component.html:118-131` gated por `photoTaxonomyValid()` = grado + imagen (`:382-384`); el único hint (`:103-107`) lista seis campos "para poder guardar". El botón es `ghost`, va último, después de todos los campos manuales. Los selects Curso/Tema ya usan el patrón "Primero elige un grado"; el botón no.
Recomendación: reordenar: imagen y grado arriba, "Extraer con IA" como acción primaria inmediatamente debajo con helper "Necesita grado e imagen"; el resto de campos después, precargados por la IA.

**M5. Recrop en vuelo puede pisar un slot de una extracción nueva** — read · 70 · unrefuted
`onRecrop` (`:517-561`) captura `extractionId` pero aplica la respuesta por `sameTarget` contra `cropSlots()` actual; `setImage` (`:322-345`) resetea sin cancelar; ni el file input ni el botón de extraer se deshabilitan mientras hay un recrop `busy`.
Recomendación: comparar `extractionId` capturado con `this.extractionId` en `next` y descartar si difiere.

**M6. Sin timeout cliente en extract/recrop** — read · 65 · unrefuted
`ai.service.ts:233-244` `http.post` desnudo; los dos streams sí usan `timeout({ each: AI_STREAM_WATCHDOG_MS })` (`:91`, `:274`). `extracting` solo se limpia en `next`/`error` (`:453`, `:457`); un drop silencioso deja el botón girando hasta recargar. Nginx `proxy_read_timeout 120s` no cubre browser↔edge.
Recomendación: aplicar el mismo `timeout` que los streams.

**M7. Sin guard de recarga ni aviso al salir** — read · 85 · unrefuted
Cero `beforeunload`/`CanDeactivate`/`sessionStorage` en `bank-new` y `crop-review`; `app.routes.ts:50-54` sin `canDeactivate`. Contraste: `exam-builder` y `ai-review-queue` sí persisten en `sessionStorage`.
Recomendación: `canDeactivate` que pregunte cuando `cropSlots().length > 0 || extracting() || saving()`.

**M8. Object URLs de previsualización nunca se revocan al destruir** — read · 90 · unrefuted
`bank-new.component.ts:322-345`, `:355-362` revocan solo la anterior; sin `DestroyRef`/`OnDestroy`. `bank-list.component.ts:429-435` sí lo hace.
Recomendación: `inject(DestroyRef).onDestroy(() => revocar ambas)`.

**M9. Selects dependientes con race (sin `switchMap`)** — read · 80 · unrefuted
Cuatro `effect()` (`:258-308`) hacen `subscribe` sin cancelar; `taxonomy.service.ts` no cachea; dos cambios rápidos de grado pueden dejar cursos del grado anterior.
Recomendación: `toObservable(sGradeLevel).pipe(switchMap(...))` o comparar el valor pedido con el actual antes de `set`.

**M10. Componente de 791 líneas con cuatro responsabilidades** — read · 90 · unrefuted
526 líneas de código ejecutable; matching de taxonomía, construcción de crop slots, `reresolveAlternativeIndex` y la cadena de guardado viven en el archivo, no en servicios.
Recomendación: extraer `QuestionSaveChainService` y `TaxonomyMatcher`; separar el tab structured en componente hijo.

**M11. Botón deshabilitado sin vínculo a la razón; ningún campo marca `required`** — read · 80 · unrefuted
Hints sin `id`; `ButtonComponent` no expone `aria-describedby`; `aria-required` no existe en toda la librería `ui/`; `ui-select` renderiza el error sin `aria-invalid`.
Recomendación: `required` input en `ui-input`/`ui-select` → `aria-required`; `aria-describedby` passthrough en `ui-button`.

**M12. Carga y éxito no se anuncian; solo los errores tienen `role="alert"`** — read · 78 · unrefuted
`button.component.ts:15-23` sin `aria-busy` ni texto de carga; el label proyectado no cambia; `setTab('structured')` (`:454`) silencioso. El botón además se deshabilita al cargar, así que el foco se pierde.
Recomendación: región `aria-live="polite"` visualmente oculta con "Extrayendo…" / "Pregunta extraída, revisa el texto y los recortes".

**M13. Sin gestión de foco al cambiar de tab ni tras guardar** — read · 70 · unrefuted
Cero `.focus()` en `bank-new`; `tabs.component.ts` sin `aria-controls` ni roving tabindex; `provideRouter` solo con scroll restoration.
Recomendación: al extraer, enfocar el h2 del tab structured; tras guardar, enfocar el h1 del banco.

**M14. Nombre accesible del select excluye el valor** — read · 68 · **undetermined** (tope Medium; no se puede resolver sin lector de pantalla)
`select.component.ts:59` `aria-labelledby` solo al label; el `<span>{{ triggerLabel() }}</span>` (`:65`) queda fuera del nombre. Si `<button role="combobox">` expone su contenido como valor, no hay defecto. Verificar con VoiceOver antes de tocar.

### Low

- **L1.** Fila de pregunta tipo imagen sin título: `questionSnippet` (`bank-list.component.ts:705-716`) cae a `sourceName`, que el web nunca envía → la fila muestra solo "Clave: d". Sí hay thumbnail/placeholder de imagen. (weakened desde Medium; executed)
- **L2.** Reemplazar la foto tras extraer conserva `sBody`/`sAlternatives`/`sCorrectAnswer` (`:322-345` no los resetea). La foto B nunca se adjunta a la pregunta structured, así que el daño es texto viejo guardado solo. (weakened desde Medium)
- **L3.** El alert de error de extracción persiste después de completar el formulario (observado en runtime).
- **L4.** El árbol del banco repite el mismo tema por grado sin mostrar el grado ("Genética y herencia · 5" y "· 4"): el profesor no sabe dónde cayó su pregunta.
- **L5.** Markup del control de subida duplicado entre tabs (`html:63-92` vs `:198-236`).
- **L6.** `crop-review.component.html:17` `<img>` sin `aspect-ratio`/`min-height`: layout shift al cargar.
- **L7.** Cadena de guardado secuencial donde imagen y alternativas podrían ir en `forkJoin`.
- **L8.** Dos `<h1>` en la página (`topbar.component.ts:33` + `bank-new.component.html:2`).

### Info

- **I1.** El spec de crop define `RecropQuestionBody.target`; el API solo recibe `{ box }` y recorta por coordenadas. Deriva inofensiva.
- **I2.** El overlay del dev server mostró "TS1185: Merge conflict marker" en `environment.production.ts:8`; el archivo en disco está limpio y sin marcadores. Overlay obsoleto de una sesión anterior, no hallazgo del repo.

## Cableado y alcance

Sin UI huérfana, sin endpoints sin caller en el flujo, sin submit sin request. `pendingStructuredCourseId/TopicId` existe y lo consumen los effects (`:246-247`, `:271-280`, `:296-308`). El guardado crudo tipo `image` sigue intacto. El interceptor global de 401 cubre este flujo.

## Coverage gaps

- **Extracción real con IA y crop-review en vivo no ejecutados**: `.env` sin key. Todo lo relativo a `crop-review` es tier `read`.
- Orden real de respuestas en M9 y frecuencia real de M5: dependen de red.
- Anuncio real de lectores de pantalla (M12, M13, M14).
- Los screenshots de Playwright no quedaron en disco; la evidencia runtime es el árbol de accesibilidad y los estilos computados citados.

## Refutation ledger (no son hallazgos)

| Hallazgo | Ubicación | Sev. reclamada | Ground | Por qué murió |
|---|---|---|---|---|
| Segunda extracción del mismo grado no vuelve a autocompletar Curso/Tema | `bank-new.component.ts:494-500` | High | INTENDED | El `if (this.sGradeLevel() !== gradeLevel)` es un guard deliberado contra fugas de preselección; `bank-new.component.spec.ts:699-727` asegura exactamente ese comportamiento y fallaría con la "corrección" propuesta. |

## Deuda técnica

M8, M9, M10, L5, L6, L7.

## Riesgos de seguridad

Ninguno dentro del alcance. H1 es de configuración y disponibilidad, no de exposición.

## Funcionalidad faltante

- Confirmación de guardado con navegación a la pregunta (M1).
- Drag-and-drop real (M2) o quitar la promesa.
- Aviso antes de perder una revisión de recortes (M7).
- Estado "IA no disponible" como capacidad del tenant/entorno (H1).

## Riesgos de arquitectura

- Error de configuración modelado como excepción genérica que atraviesa tres capas sin tipo (H1).
- Estado de flujo multi-paso enteramente en signals de un componente de 791 líneas (M10 + M7).

## Recomendaciones

1. H1 primero: tipo de error + 503 + mensaje honesto + validación al boot.
2. Reordenar el tab foto alrededor de "Extraer con IA" como acción principal (M4) y confirmar el guardado (M1).
3. Editor de recortes: hit-area de 44 px y flechas de teclado (H2, H3).
4. Higiene: guard de salida (M7), timeout (M6), `extractionId` check (M5), revoke (M8), `switchMap` (M9).
5. Accesibilidad transversal en `ui/`: `aria-required`, `aria-busy`, `aria-describedby` passthrough (M11, M12); verificar M14 con VoiceOver.

## Quick wins (menos de una hora cada uno)

- `focus-within` ring en los dos labels de subida (M3).
- Helper text bajo "Extraer con IA": "Necesita grado e imagen" (M4, parcial).
- `timeout()` en `extractQuestionFromImage`/`recropExtraction` (M6).
- `DestroyRef` revoke (M8).
- Guard de `extractionId` en `onRecrop.next` (M5).
- Quitar "Arrastra" del copy hasta implementar drop (M2, parcial).
- Demote del `<h1>` local a `<h2>` (L8).

## Mejoras de largo plazo

- Dividir `bank-new` en `photo-tab`, `structured-tab` y un servicio de guardado (M10).
- Región `aria-live` global + gestión de foco en cambios de ruta (M12, M13).
- Persistir la revisión de recortes (al menos texto y cajas) en `sessionStorage` como hace `exam-builder` (M7).

## Estado dejado en la máquina

- Pregunta de prueba creada en la DB local: tipo imagen, `1d.PNG`, Ciencia y Tecnología / Genética y herencia, 5° secundaria, clave d, nivel Media, id `1060ee58-e576-48bc-b274-208cf0cddd63`. No se borró.
- El API dev server que levantó la auditoría se detuvo al terminar. Web (:4201) y docker quedan como estaban.

## Addendum — corrida end-to-end con DeepSeek V4 (2026-09-02, tarde)

Con `AI_BASE_URL=https://api.deepseek.com/chat/completions`, `AI_MODEL=deepseek-v4-flash`, `AI_VISION_MODEL=deepseek-v4-flash-vision-exp`, `AI_RESPONSE_FORMAT=json_object` y `AI_THINKING=disabled`, el flujo completo se ejecutó en browser:

| Paso | Resultado |
|---|---|
| Foto de texto (`biologia/5b.PNG`) → Extraer con IA | 200 en ~25 s. Enunciado, 5 alternativas y clave `b` correctos. `suggestedCourseName: "Biología"` no existe en la taxonomía del colegio, así que Curso/Tema quedaron vacíos sin avisar. |
| Guardar structured | `POST /bank/questions/structured` 201 → banco. |
| Foto con figura (`__fixtures__/question-with-circuit.png`) → Extraer con IA, thinking por defecto | **422** tras 52 s y 2 intentos: `finish_reason=length`, mensaje con `reasoning_content` y `content` vacío. El modelo de visión razona por defecto y agotó `max_tokens=3000` pensando. |
| Misma foto con `AI_THINKING=disabled` | 200. Enunciado del circuito correcto, figura recortada y adjuntada como `figura.png`, editor de recorte visible. **Las 5 alternativas y la clave son inventadas**: el fixture no tiene alternativas (ver H6). Dos corridas dieron alternativas distintas (`0.5 A…4 A` clave `b`; `2 A…12 A` clave `a`). |
| Mover la caja de recorte y "Aplicar recorte" | `POST /ai/questions/extract/:id/crop` 200, preview actualizada. |
| Guardar | `POST /bank/questions/structured` 201 + `POST /bank/questions/:id/image` 201 → detalle en el banco con imagen, enunciado, alternativas, clave y grado. |

### Hallazgos nuevos de esta corrida

- **H6 (executed). La extracción inventa alternativas y clave cuando la foto no las trae.** `question-with-circuit.png` contiene solo el enunciado y un rectángulo; el modelo devolvió 5 alternativas y una clave en las dos corridas, distintas entre sí. Causa estructural: `EXTRACT_RESPONSE_JSON_SCHEMA` exige `alternatives` con `minItems: 5` y `correctAnswer` obligatorio (`openrouter-request-builder.ts`), y el validador rechaza menos de 5, así que el modelo no tiene forma de decir "no hay alternativas" y rellena. El prompt dice "TRANSCRIBES, NO RESUELVES" pero el contrato lo obliga a resolver. Un profesor que confíe en el resultado guarda una pregunta con opciones falsas. Recomendación: permitir `alternatives: []` (o `null`) y `correctAnswer: null` en el schema de extracción, mostrar en la UI "La foto no trae alternativas, escríbelas", y nunca precargar una clave que la imagen no muestre.

- **H4 (executed, corregido en esta rama).** El adapter enviaba siempre `response_format: json_schema`; la API de DeepSeek solo acepta `json_object`. Fix: `AI_RESPONSE_FORMAT` (`resolve-ai-provider-config.ts`, `openrouter-request-builder.ts`), schema embebido en el prompt en ese modo.
- **H5 (executed, corregido en esta rama).** DeepSeek V4 razona por defecto y la extracción por foto vuelve vacía. Fix: `AI_THINKING` → `thinking: { type }` en el body, solo cuando está configurado.
- **M15 (executed, corregido en esta rama).** Un 4xx/5xx del proveedor llegaba al log como "status 400" sin el cuerpo; y una respuesta sin `content` no decía por qué. Ahora el mensaje incluye el cuerpo truncado y `finish_reason` + keys del mensaje.
- **M16 (executed).** `deepseek-chat` quedó duplicado arriba en el `.env` local junto a `deepseek-v4-flash` abajo; dotenv toma la última línea. Borrar las líneas viejas.
- **L9 (executed).** Cuando el curso/tema sugerido por la IA no matchea la taxonomía, la sugerencia se descarta en silencio. Mostrarla como texto ("La IA sugiere: Biología / Irritabilidad y taxia") costaría una línea y evita que el profesor la reescriba de memoria.
- **L10 (executed).** Label "Clave (a/b/c/d)" en el tab structured con 5 alternativas visibles (a–e).

### Estado dejado

- Dos preguntas nuevas en la DB local: `Genética y herencia` (biología, texto) y `Electricidad y magnetismo` id `ce72935a-8875-4ccd-be9b-a905537ad2aa` (circuito, con imagen). Ambas 5° secundaria, nivel Media.
- El API que quedó corriendo en :3012 lo levantó la auditoría con `AI_THINKING=disabled` exportado en el shell, no desde el `.env`. Al agregar `AI_THINKING=disabled` al `.env` conviene reiniciarlo.
