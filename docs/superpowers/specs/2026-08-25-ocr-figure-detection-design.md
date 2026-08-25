# Diseño — Detectar la figura por OCR en vez de pedírsela a la IA

**Fecha:** 2026-08-25
**Reemplaza:** partes de `2026-08-24-ai-question-image-crop-design.md` (§3 y §6)

## 1. Propósito

La extracción por foto le pide hoy al modelo de visión dos cosas a la vez:
transcribir la pregunta y reportar las coordenadas de sus gráficos. Lo primero lo
hace razonablemente; lo segundo, mal. Un modelo de visión no ubica un circuito ni
una mnemotecnia con precisión de píxel — devuelve recuadros flojos que después el
profesor tiene que corregir a mano, y en el proveedor que estamos evaluando la
imagen se tokeniza a un techo de 384 tokens, que es una representación demasiado
pobre para acertar coordenadas.

La figura sale de la geometría, no de un modelo. OCR marca dónde hay texto; lo que
queda con tinta y no es texto **es** la figura.

## 2. Alcance

Dentro:

- Un puerto nuevo que detecta regiones de texto en la foto, con adaptador Tesseract.
- El recorte de figuras por resta: tinta menos texto.
- La atribución de una figura a su alternativa, por posición respecto de las letras
  `A)`, `B)`, `C)` que el propio OCR ubica.
- Sacar `figureBox`/`alternativeBoxes` del contrato del modelo y sus reglas del prompt.

Fuera:

- **OCR NO lee texto ni fórmulas.** La transcripción sigue siendo del modelo de
  visión, sobre la foto completa. Este diseño no cambia esa mitad ni resuelve la
  cuestión abierta de qué proveedor la sirve.
- Rotación, deskew, o corrección de perspectiva de la foto.
- Reconocimiento de qué ES la figura (un circuito, un triángulo). Solo dónde está.

## 3. La idea que sostiene el diseño

**No necesitamos precisión de OCR, necesitamos geometría.**

Que Tesseract transcriba `1 2` donde la hoja dice `1/2` no importa: esa
transcripción se descarta. Lo único que se usa de cada palabra es su recuadro. Y
las cajas de palabra son confiables aun cuando los caracteres salen mal, porque
detectar "acá hay tinta con forma de renglón" es un problema mucho más fácil que
decidir qué carácter es.

Eso desarma la objeción obvia — "OCR destroza la matemática" — porque la matemática
nunca pasa por OCR.

Hay UNA excepción donde sí se usa la transcripción: las letras de alternativa.
`A)`, `B)`, `C)` son glifos aislados y grandes, el caso más fácil que existe para
un OCR. Sus posiciones son lo que permite atribuir una figura a su alternativa.

## 4. Puerto nuevo

`apps/api/src/modules/ai/domain/ports/text-region-detector.port.ts`

```ts
/** Una palabra que el OCR ubicó, con su recuadro en coordenadas normalizadas. */
export interface TextWord {
  /** La transcripción. Se usa SOLO para reconocer letras de alternativa; nunca para el enunciado. */
  readonly text: string;
  readonly box: NormalizedBox;
  /** 0..100, como la reporta Tesseract. Por debajo de un piso la palabra se ignora. */
  readonly confidence: number;
}

export interface TextRegionDetectorPort {
  detect(image: Buffer, mimeType: string): Promise<readonly TextWord[]>;
}
```

Adaptador `TesseractCliAdapter`, con el mismo patrón que `TypstCliAdapter`: un
`OcrRunner` inyectable (`(args: string[]) => Promise<{ stdout, stderr, exitCode }>`)
para que el adaptador se teste sin el binario instalado.

Invocación: `tesseract <img> stdout -l spa --psm 3 tsv`. El formato TSV trae una
fila por palabra con `level page block par line word left top width height conf text`.
Se descartan las filas cuyo `level` no es palabra, las de `conf` negativa, y las de
texto vacío.

`tesseract` y `tesseract-ocr-spa` se instalan en `infra/Dockerfile.api`, junto al
`typst` que ya está ahí, y el stage de runtime gana un `RUN tesseract --version`
como gate de build — el mismo que agregamos para `sharp` después de que su chequeo
no pudiera correr.

## 5. El algoritmo, por resta

Función pura en `apps/api/src/modules/ai/domain/find-figure-regions.ts`:

```ts
export function findFigureRegions(
  raster: ImageRaster,
  words: readonly TextWord[],
): readonly NormalizedBox[];
```

1. **Borrar el texto.** Cada caja de palabra se pinta de blanco sobre una copia del
   raster en gris, con un margen pequeño para llevarse acentos y colas que Tesseract
   deja fuera de su caja.
2. **Agrupar lo que queda.** Componentes conexos sobre la tinta restante, en 4-vecindad.
3. **Descartar lo chico.** Un componente pasa solo si supera un mínimo de ancho Y de
   alto — no de área: una línea horizontal larga y finísima (un subrayado, el borde
   de la hoja) tiene área suficiente y no es una figura.
4. **Ajustar.** Cada componente sobreviviente pasa por `snapBoxToInk`, que ya existe.

Constantes nombradas, no números sueltos:

```ts
/** Margen alrededor de cada caja de palabra al borrarla: Tesseract deja fuera tildes y colas. */
const TEXT_ERASE_PADDING_PX = 3;
/** Piso de tamaño de un componente para contar como figura, en fracción de la imagen. */
const MIN_FIGURE_WIDTH = 0.03;
const MIN_FIGURE_HEIGHT = 0.02;
/** Por debajo de esta confianza la palabra se ignora: una caja fantasma borraría figura. */
const MIN_WORD_CONFIDENCE = 30;
```

El piso de confianza corta en la dirección segura: **ante la duda, no borrar**. Una
caja de texto fantasma sobre la figura la mutila; una palabra real que no se borra
solo agranda un poco el recorte, y el profesor lo ajusta.

## 6. Atribución a la alternativa

`apps/api/src/modules/ai/domain/attribute-figure-to-alternative.ts`, también pura.

1. Entre las palabras, se buscan las que son marca de alternativa: una letra `a`–`e`
   seguida de `)`, `.` o `:`, sola en su caja. Se toma la primera ocurrencia de cada
   letra, en orden vertical.
2. Esas marcas parten la imagen en bandas: la banda de `C)` va desde su tope hasta el
   tope de `D)`.
3. Una figura cuyo centro cae en la banda de `C)` es la figura de la alternativa 2.
4. Una figura que queda **arriba** de la primera marca es la figura de complemento
   del enunciado.

Si no se reconoce ninguna marca de alternativa —foto torcida, OCR pobre— toda figura
detectada se trata como complemento. Es la degradación correcta: el complemento es
el caso común, y el profesor ve el recorte antes de guardar.

## 7. Lo que se elimina

Del contrato del modelo (`question-generator.port.ts`): `figureBox` y
`alternativeBoxes`, con su validación en `openrouter-response-validator.ts` y sus
tests.

Del prompt: `CROP_BOX_RULES` entero, y la regla que pide fracciones de imagen. El
modelo de visión vuelve a tener un solo trabajo.

Esto revierte la Task 4 y parte de la 5 del plan del recorte. Es trabajo hecho que
esta decisión deja sin propósito, y se dice explícitamente para que nadie lo
reintroduzca creyendo que falta.

## 8. Lo que NO cambia

`ImageCropperPort` y su adaptador `sharp`, `snapBoxToInk`, `NormalizedBox`, el cache
de extracción en Redis, el endpoint de re-recorte, `<app-crop-review>`, y toda la
cadena de subida al guardar. El profesor arrastra y reajusta igual que hoy.

Lo único que cambia es **quién propone** las cajas: antes el modelo, ahora la
geometría.

## 9. Errores

Ninguna falla de OCR tumba la extracción. Si el binario no está, si revienta, o si
devuelve un TSV que no se puede parsear, se loguea y la pregunta vuelve sin figura —
exactamente el camino que `buildCrops` ya sigue para un fallo de recorte, y por la
misma razón: el texto es la mitad valiosa del endpoint.

## 10. Pruebas

- `text-region-detector.port` — el adaptador Tesseract contra un `OcrRunner` falso que
  devuelve TSV fijo: parsea las cajas, descarta filas que no son palabra, descarta
  confianza baja, y no revienta con un TSV vacío o truncado.
- `find-figure-regions.spec.ts` — matrices 8×8 a mano, como `snap-box-to-ink.spec.ts`:
  una figura sola se detecta; una figura junto a texto sobrevive al borrado; una mota
  bajo el umbral se descarta; un subrayado ancho y finísimo se descarta; sin tinta
  sobrante devuelve vacío.
- `attribute-figure-to-alternative.spec.ts` — cajas de palabra de entrada: una figura
  en la banda de `C)` da índice 2; una figura arriba de `A)` es complemento; sin
  marcas reconocidas todo es complemento.
- `extract-question.service.spec.ts` — se extiende: sin figuras detectadas no se llama
  al cropper; un fallo del detector devuelve la transcripción sin figura.
- Golden e2e con una foto real de una pregunta con circuito, contra el Tesseract
  instalado, afirmando que se detecta exactamente una figura y que su recuadro no
  se solapa con el texto.

## 11. Orden de implementación

1. Tesseract en el Dockerfile con su gate de build, el puerto y el adaptador CLI.
2. `findFigureRegions` (dominio puro).
3. `attributeFigureToAlternative` (dominio puro).
4. `ExtractQuestionService` cambia de fuente de cajas: del modelo al detector.
5. Sacar `figureBox`/`alternativeBoxes` del puerto, el validador y el prompt.
6. Golden e2e.
