# Pipeline de recolección de preguntas (fuentes de internet)

> Runbook para correr el pipeline de punta a punta de forma autónoma: buscar preguntas reales
> en la web, producir los JSON de seed y las imágenes complemento recortadas SOLO al gráfico.
> Referencias vivas: commits `7961bdd` (86 JSON web-sourced), `38c7844` (complement image),
> `f344f62` (alternative images).

## Objetivo

Poblar el banco con preguntas reales de exámenes publicados. Cada corrida produce:

1. Un JSON en `apps/api/src/db/data/` con las preguntas transcritas.
2. Un directorio hermano con PNGs recortados que contienen **únicamente el gráfico/diagrama/tabla**
   que no se puede expresar en Typst — nunca el enunciado ni las alternativas (eso va en texto).

## Regla de oro del recorte

- El texto SIEMPRE va en `bodyTypst` + `alternatives`. La imagen es solo el complemento visual
  (pictograma, esquema anatómico, figura geométrica, circuito, tabla dibujada).
- Si el recorte contiene texto de enunciado o alternativas → recorte mal hecho, rehacer.
- Excepción: si la pregunta completa solo existe como scan y transcribirla pierde información
  (figuras en las alternativas mismas, layouts imposibles), usar el formato `image` (ver abajo),
  donde TODO el enunciado + alternativas van baked en un solo PNG.

## Política de fuentes (no negociable)

- Solo preguntas con **clave de respuesta explícita en la fuente**: solucionarios oficiales de
  admisión (UNMSM, UNI, UNCP), cuadernillos MINEDU (umc.minedu.gob.pe), bancos publicados
  (Editora Delta, Rubiños, GoConqr, grammarbank).
- NUNCA auto-determinar la respuesta correcta. Sin clave publicada → se descarta la pregunta.
- Nada de contenido paywalled ni de academias privadas sin publicación abierta.
- `sourceUrl` = URL exacta del documento; `sourceName` = descripción legible con examen/año/pregunta
  (ej. `"Editora Delta — Examen de Admisión UNMSM 2008-I, Biología, pregunta 6"`).

## Formatos de salida

### A. Structured + imagen complemento — `seed-gap-topic-with-image.ts`

```json
{ "entries": [ {
  "courseName": "Matemática",
  "topicName": "Gráficos, tablas, estadística y probabilidad",
  "gradeLevel": "primaria_4",
  "difficulty": "easy",
  "bodyTypst": "Enunciado transcrito (puede referirse a la imagen: 'ver gráfico').",
  "alternatives": ["15 libros.", "9 libros.", "5 libros.", "3 libros."],
  "correctAnswer": "0",
  "imagePath": "mi-lote-figures/mat-00.png",
  "sourceUrl": "http://...",
  "sourceName": "MINEDU - Cuadernillo modelo Matemática 4to primaria"
} ] }
```

- `correctAnswer` es **índice 0-based** (string) sobre `alternatives`.
- `imagePath` relativo al directorio del propio JSON.
- Ejemplos reales: `escolar-matematica-primaria-figures.json`, `preuni-*-sweep-images.json`.

### B. Pregunta-imagen completa — `seed-image-question.ts`

```json
{ "entries": [ {
  "courseName": "Matemática", "topicName": "Figuras y cuerpos geométricos",
  "gradeLevel": "primaria_4", "difficulty": "medium",
  "correctAnswer": "c",
  "imagePath": "mi-lote-image/mat-06.png",
  "sourceUrl": "http://...", "sourceName": "..."
} ] }
```

- `correctAnswer` es **letra minúscula a-e** que matchea las alternativas impresas en la imagen
  (NO índice — convención distinta a la del formato A).
- Ejemplo real: `escolar-matematica-primaria-figures-image.json`.

## Taxonomía (resolución obligatoria antes de escribir el JSON)

- `courseName` + `gradeLevel` + `topicName` deben existir EXACTOS en la DB. Un curso existe una
  vez por etapa (escuela/colegio/preuniversitario); los scripts ya resuelven eso, pero el
  `topicName` debe matchear byte a byte el nombre del topic para ese `gradeLevel`.
- `gradeLevel` valores: `pre`, `primaria_1..6`, `secundaria_1..5`.
- Referencia canónica: `apps/api/src/db/data/canonical-taxonomy.json` (campo `mapsFrom` lista los
  alias). Ante duda, consultar la tabla `topics` directamente antes de inventar un nombre.
- `difficulty`: `easy` | `medium` | `hard`.

## Recorte de imágenes (herramientas)

1. Descargar el PDF/página fuente (`curl`).
2. Rasterizar la página: `pdftoppm -png -r 200 fuente.pdf pagina` (o screenshot con Playwright
   para fuentes HTML).
3. Recortar SOLO el gráfico: `magick pagina-N.png -crop WxH+X+Y +repage salida.png`
   (en macOS también sirve `sips --cropOffset`).
4. Verificar visualmente cada recorte (Read del PNG): sin texto de enunciado, sin letras de
   alternativas, sin bordes de página.
5. Nombrar `<curso>-<nn>-<descriptor>.png`, guardar en el directorio hermano del JSON.

## Ejecución del seed

Prerequisitos: Postgres/Redis/MinIO arriba, API corriendo en `localhost:3012`
(override con `API_BASE_URL`), y el usuario seeder creado:

```bash
pnpm --filter api db:seed   # crea bank-sample-seeder@exams-generator.internal
```

Luego, desde `apps/api/`:

```bash
# Formato A (structured + complemento)
DOTENV_CONFIG_PATH=../../.env ts-node -r dotenv/config -r tsconfig-paths/register \
  src/scripts/seed-gap-topic-with-image.ts src/db/data/<lote>.json

# Formato B (pregunta-imagen)
DOTENV_CONFIG_PATH=../../.env ts-node -r dotenv/config -r tsconfig-paths/register \
  src/scripts/seed-image-question.ts src/db/data/<lote>-image.json
```

- Ambos scripts son idempotentes por duplicado de contenido: un 409 (hash de contenido repetido)
  se reporta como `SKIP`, no como fallo.
- Salida esperada: `OK` por entrada, resumen `N/M seeded`. Cualquier `FAIL` es casi siempre
  `topicName` que no matchea la taxonomía — corregir el JSON, no la DB.

## Checklist de una corrida autónoma

1. Elegir curso + gradeLevel objetivo (priorizar topics con 0 preguntas).
2. Buscar fuente abierta CON solucionario.
3. Transcribir enunciado/alternativas → formato A; scans intranscribibles → formato B.
4. Descargar, rasterizar y recortar los gráficos (solo gráfico, verificación visual).
5. Resolver `topicName` contra la taxonomía real.
6. Escribir JSON + PNGs en `apps/api/src/db/data/`.
7. Correr el script de seed correspondiente; iterar sobre los `FAIL`.
8. Commit con `feat(api): seed ...` describiendo lote y fuentes.
