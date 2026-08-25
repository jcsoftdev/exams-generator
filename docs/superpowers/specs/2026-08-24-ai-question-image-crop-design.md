# Diseño — Recorte de gráficos al extraer una pregunta por foto con IA

**Fecha:** 2026-08-24

## 1. Propósito

El flujo de extracción por foto (`POST /ai/questions/extract`, diseñado en
`2026-07-20-bank-new-photo-ai-extract-design.md`) devuelve hoy solo texto: enunciado en
Typst, alternativas y clave. Cuando la pregunta trae un gráfico — un circuito, una
figura geométrica, un diagrama de barras — ese gráfico se pierde, y el profesor no
tiene más salida que guardar la pregunta como tipo `image` (foto cruda), perdiendo
todo lo bueno del tipo `structured`: alternativas barajables, búsqueda por texto,
reutilización del enunciado.

Este diseño cierra ese hueco: la IA localiza el gráfico dentro de la foto, el API lo
recorta, y el recorte entra como imagen de complemento de una pregunta `structured`.
Lo mismo para las alternativas que son dibujos en vez de texto.

El renderizado ya existe y no se toca: `typst-template.ts` imprime la imagen de
complemento (`questions.image_asset_id`) junto al `figureCode`, y las imágenes por
alternativa (`question_alternative_images`) en su slot correspondiente.

## 2. Alcance

Dentro:

- La IA devuelve bounding boxes normalizados del gráfico de complemento y de las
  alternativas que sean gráficas.
- El API recorta esos boxes y devuelve los recortes junto al borrador.
- El profesor puede ajustar cualquier recorte, o descartarlo.
- Al guardar, los recortes se persisten como assets vía los endpoints existentes.

Fuera (YAGNI):

- Rotación/deskew de la foto. Si la foto está torcida, el recorte sale torcido.
- Más de un gráfico de complemento por pregunta.
- OCR del contenido de la figura (leer los rótulos del diagrama y transcribirlos).
- Reemplazar el flujo tipo `image`: la foto cruda sigue siendo la salida válida para
  todo lo que la IA no reproduce bien.

## 3. Contrato del puerto de IA

`apps/api/src/modules/ai/domain/ports/question-generator.port.ts`:

```ts
/** Rectángulo en coordenadas normalizadas 0..1, relativas al ancho/alto de la imagen. */
export interface NormalizedBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
```

`GeneratedQuestion` suma dos campos opcionales:

```ts
/** `extractFromImage` únicamente — recuadro del gráfico de complemento. Ausente
 *  cuando la pregunta es solo texto y fórmulas. */
readonly figureBox?: NormalizedBox;

/** `extractFromImage` únicamente — un slot por alternativa; `null` = esa
 *  alternativa es puro texto. Ausente = ninguna alternativa es gráfica. */
readonly alternativeBoxes?: readonly (NormalizedBox | null)[];
```

Se eligen coordenadas normalizadas y no píxeles porque el modelo de visión ve la
imagen ya reescalada por el proveedor: un box en píxeles del modelo no corresponde a
píxeles del original. Normalizado sobrevive cualquier resize.

`generate()` y `reviseQuestion()` nunca pueblan estos campos — misma convención que
`suggestedCourseName`/`suggestedTopicName`.

Validación en el adapter (`openrouter-response-validator.ts`): un box con cualquier
componente fuera de `0..1`, con `w <= 0` o `h <= 0`, o que se salga del lienzo
(`x + w > 1`), se descarta silenciosamente — la extracción de texto NO falla por un
box malo. Un `alternativeBoxes` cuya longitud no coincida con `alternatives` se
descarta entero.

## 4. Puerto de recorte

Puerto nuevo, mismo patrón hexagonal que `StoragePort` y `PdfCompilerPort`:

`apps/api/src/modules/ai/domain/ports/image-cropper.port.ts`

```ts
export interface ImageRaster {
  /** Un byte de luminancia por píxel, fila por fila. */
  readonly gray: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface ImageCropperPort {
  /** Decodifica la imagen a escala de grises para el análisis de tinta. */
  raster(image: Buffer, mimeType: string): Promise<ImageRaster>;

  /** Recorta el rectángulo normalizado y devuelve un PNG, reescalado a
   *  `maxWidthPx` si el recorte fuera más ancho (ver §6, acote del payload). */
  crop(
    image: Buffer,
    mimeType: string,
    box: NormalizedBox,
    maxWidthPx: number,
  ): Promise<Buffer>;
}
```

Adaptadores:

- `SharpImageCropperAdapter` — producción. **`sharp` es la única dependencia nueva del
  proyecto.** Es un módulo nativo: hay que agregarlo al stage de build de
  `infra/Dockerfile.api` y verificar que la imagen base tenga las libs que necesita
  (`sharp` publica binarios precompilados para linux-x64/arm64 glibc; si la imagen es
  Alpine hace falta el paquete `vips`). Este es el único riesgo de infraestructura del
  plan y hay que resolverlo en la primera tarea, no al final.
- `InMemoryImageCropperAdapter` — tests. Devuelve un raster sintético y un buffer
  determinista.

Ambos corren el mismo contract test (`image-cropper.port.spec.ts`), igual que
`storage.port.spec.ts`.

## 5. Ajuste a tinta

Función de dominio pura, sin dependencia de `sharp`:

`apps/api/src/modules/ai/domain/snap-box-to-ink.ts`

```ts
export function snapBoxToInk(
  raster: ImageRaster,
  box: NormalizedBox,
  paddingPx: number,
): NormalizedBox;
```

Los modelos de visión dan coordenadas flojas: cortan medio trazo o dejan tres
centímetros de blanco. La función toma el box aproximado, lo expande y contrae hasta
los límites reales de tinta (primera y última fila/columna del recorte que contengan
píxeles por debajo del umbral de luminancia), y aplica un padding fijo sin salirse del
lienzo. Es el mismo algoritmo que ya usa `tools/harvest/figure_bounds.py` en el
pipeline offline de cosecha, portado a TypeScript.

Detalles que el port debe respetar:

- Umbral de tinta relativo, no absoluto: se calcula sobre el histograma del recorte,
  para que una foto con papel gris no se lea como "toda tinta".
- Si el recorte no tiene tinta alguna, se devuelve el box original intacto (el crop
  vacío es problema del profesor, no del algoritmo).
- El ajuste solo puede crecer hasta los bordes del box original más un margen de
  expansión acotado, para que un box mal puesto sobre un párrafo no termine
  tragándose la página entera.

Se testea con matrices de 8×8 escritas a mano: cero I/O, cero `sharp`.

## 6. Flujo de extracción

`ExtractQuestionService.extract()` se extiende:

```
POST /ai/questions/extract          (multipart, firma sin cambios)

  1. requireImageMime(file)                        (ya existe)
  2. generator.extractFromImage(...)               (ya existe, ahora puede traer boxes)
  3. correctAnswerLetterToIndex + validate         (ya existe)
  4. si hay boxes:
       raster = cropper.raster(file.buffer, mime)
       por cada box: snapBoxToInk -> cropper.crop
  5. cachea la foto original: Redis `ai:extract:<extractionId>` TTL 30 min
  6. responde
```

Respuesta:

```ts
{
  extractionId: string;          // uuid; ausente si no hubo ningún recorte
  bodyTypst: string;
  alternatives: string[];
  correctAnswer: number;
  suggestedCourseName?: string;
  suggestedTopicName?: string;
  figureCrop?: { dataUrl: string; box: NormalizedBox };
  alternativeCrops?: { alternativeIndex: number; dataUrl: string; box: NormalizedBox }[];
}
```

`alternativeCrops` es **esparso**: solo trae entradas para las alternativas que
realmente son gráficas. Una pregunta con alternativas a) y c) gráficas devuelve dos
entradas, con `alternativeIndex` 0 y 2.

Cuando no hay ningún recorte, `figureCrop`, `alternativeCrops` y `extractionId` están
ausentes, y la interfaz web no muestra nada de recorte. Ese es el caso normal de una
pregunta de puro texto y fórmulas.

Los recortes viajan como `data:` URL en el JSON, no como assets. Nada se persiste
hasta que el profesor guarda: si descarta el borrador, no queda ningún asset huérfano
que limpiar.

Costo del payload: cada recorte es un PNG en base64. Se acota re-escalando cada
recorte a un ancho máximo de 1200 px antes de codificarlo — suficiente para revisar en
pantalla y para imprimir, ya que el asset final se genera del mismo recorte.

## 7. Re-recorte manual

```
POST /ai/questions/extract/:extractionId/crop
Body: { box: NormalizedBox, target: 'figure' | { alternativeIndex: number } }
  -> 200 { dataUrl, box }
  -> 410 Gone si el TTL del cache venció
  -> 400 si el box es inválido
```

Lee la foto original del cache de Redis y recorta el box **exacto**: el ajuste manual
NO se pasa por `snapBoxToInk`. El snap sirve para arreglar la puntería floja del
modelo; cuando el humano marca el rectángulo a mano, hay que respetar lo que marcó.

El `410` es un estado esperado, no un error de sistema: la web lo traduce a "la
sesión de recorte expiró, vuelve a extraer".

`extractionId` se guarda en el cache junto a `userId`; una petición de otro usuario
recibe `404`, no `403` (no se confirma la existencia del recurso ajeno).

**Throttling:** `AiController` está bajo `AccountThrottlerGuard` con
`AI_PER_ACCOUNT_THROTTLE`, un límite pensado para llamadas a modelo, que son caras y
lentas. El re-recorte no llama a ningún modelo y el profesor puede dispararlo varias
veces mientras encuadra. Este endpoint necesita su propio `@Throttle` con un límite
bastante más alto; heredar el de IA haría que ajustar tres recortes agote la cuota de
generación del profesor.

## 8. Guardado

El web encadena endpoints que ya existen:

```
POST /bank/questions/structured                → { id }
si hay figureCrop:      POST /bank/questions/:id/image
si hay alternativeCrops: POST /bank/questions/:id/alternative-images
```

**Cambio necesario en `alternative-images`:** hoy `BankService.setAlternativeImages`
exige `files.length === alternatives.length` — o subes imagen para las cinco
alternativas, o para ninguna. Con alternativas gráficas dinámicas eso no sirve. Se
agrega un campo multipart opcional `indexes` (lista de enteros 0-based, misma
cardinalidad y orden que `images`):

- Sin `indexes`: comportamiento actual intacto, `images[i]` va a `alternatives[i]` y se
  sigue exigiendo la coincidencia exacta de longitudes. Ningún llamador existente se
  rompe.
- Con `indexes`: `images[k]` va a `alternatives[indexes[k]]`. Se valida que cada índice
  esté en rango, que no haya repetidos, y que `indexes.length === images.length`; 400
  en cualquier otro caso.

El índice único `question_alternative_images_question_id_alternative_index_idx` ya
garantiza un asset por slot, y `setAlternativeImages` ya reemplaza en transacción, así
que no hace falta migración de base de datos.

**Fallo parcial:** si el `POST` de una imagen falla después de que la pregunta ya se
creó, la pregunta queda guardada sin su figura. No se borra la pregunta: se muestra un
error accionable ("La pregunta se guardó, pero la figura no se pudo subir — adjúntala
desde editar") y el profesor la completa desde la pantalla de edición, que ya permite
reemplazar la imagen.

## 9. Interfaz web

Pantalla: `bank-new`, tab "Foto". El flujo actual no cambia — extraer sigue
precargando el tab "Estructurada". Se agrega un bloque que se renderiza **solo si la
respuesta trajo recortes**.

**Componente nuevo `<app-crop-review>`** — presentacional puro, sin `HttpClient`,
siguiendo el patrón container-presentational del resto del proyecto:

- Entradas: `photo: File`, `slots: CropSlot[]`.
- Salidas: `(recrop)` con `{ target, box }`, `(discard)` con `{ target }`.
- El contenedor (`bank-new`) es quien llama al API y actualiza los slots.

Cada slot muestra la foto original de fondo con un rectángulo arrastrable y
redimensionable encima (ocho tiradores), y al costado el recorte actual. "Re-recortar"
llama al endpoint y reemplaza el recorte. "Quitar" descarta el slot: la IA a veces
marca un gráfico donde no lo hay, y el profesor tiene que poder decir que no.

Los slots de alternativa se rotulan con su letra (a, b, c…) y **solo aparecen los que
la IA marcó como gráficos**.

## 10. Pruebas

El proyecto corre en Strict TDD: cada punto de esta lista se escribe antes que su
implementación.

Dominio (Jest, API):

- `snap-box-to-ink.spec.ts` — matrices 8×8: box flojo se ajusta a la tinta; box sin
  tinta se devuelve intacto; el padding nunca se sale del lienzo; el umbral relativo
  no se traga un fondo gris uniforme.
- `normalized-box.spec.ts` — validación: componentes fuera de `0..1`, ancho/alto no
  positivos, box que se sale del lienzo.

Puertos y servicios (Jest, API):

- `image-cropper.port.spec.ts` — contract test corrido contra el adaptador `sharp` y
  contra el fake.
- `extract-question.service.spec.ts` — se extiende: con `figureBox` produce recorte;
  sin box no produce nada ni consulta el cropper; box inválido se descarta sin romper
  la extracción de texto; `alternativeBoxes` con nulls produce `alternativeCrops`
  esparso.
- `bank.service.spec.ts` — `setAlternativeImages` con `indexes`: mapeo esparso
  correcto, índice fuera de rango 400, índices repetidos 400, sin `indexes` se
  conserva el comportamiento actual.

E2E (Jest, API):

- `POST /ai/questions/extract` con `InMemoryQuestionGeneratorAdapter` devolviendo
  boxes: la respuesta trae `extractionId` y recortes.
- `POST /ai/questions/extract/:id/crop`: recorte feliz, `410` con cache vencido, `404`
  con `extractionId` de otro usuario.
- `POST /bank/questions/:id/alternative-images` con `indexes` esparso.

Web (Vitest):

- `crop-review.component.spec.ts` — no renderiza nada sin slots; emite `recrop` al
  soltar el rectángulo; emite `discard` al quitar un slot. `vitest-canvas-mock` ya está
  instalado en el proyecto.
- `bank-new.component.spec.ts` — se extiende: la cadena de guardado dispara los POST de
  imagen solo cuando hay recortes; un fallo en el POST de imagen deja la pregunta
  creada y muestra el error accionable.

## 11. Orden de implementación

1. `sharp` en `package.json` y en `infra/Dockerfile.api`, con el adaptador y su
   contract test. Si la imagen base pelea, se resuelve aquí y no después.
2. `NormalizedBox` + validación + `snapBoxToInk` (dominio puro).
3. Contrato del puerto de IA y validación en el adaptador de OpenRouter, más el prompt
   de visión que pide los boxes.
4. `ExtractQuestionService` con recorte y cache en Redis.
5. Endpoint de re-recorte con su throttle propio.
6. `setAlternativeImages` con `indexes`.
7. `<app-crop-review>` y la cadena de guardado en `bank-new`.
