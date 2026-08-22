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
{
  "entries": [
    {
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
    }
  ]
}
```

- `correctAnswer` es **índice 0-based** (string) sobre `alternatives`.
- `imagePath` relativo al directorio del propio JSON.
- Ejemplos reales: `escolar-matematica-primaria-figures.json`, `preuni-*-sweep-images.json`.

### B. Pregunta-imagen completa — `seed-image-question.ts`

```json
{
  "entries": [
    {
      "courseName": "Matemática",
      "topicName": "Figuras y cuerpos geométricos",
      "gradeLevel": "primaria_4",
      "difficulty": "medium",
      "correctAnswer": "c",
      "imagePath": "mi-lote-image/mat-06.png",
      "sourceUrl": "http://...",
      "sourceName": "..."
    }
  ]
}
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

## Pipeline automatizado para PDFs con clave (`tools/harvest/`)

Para exámenes publicados como PDF con solucionario, el recorte manual ya no hace falta:

| Herramienta                                                                                                                                  | Qué hace                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pdf_lines.py`                                                                                                                               | Texto del PDF en orden de lectura; detecta páginas a dos columnas y emite la columna izquierda completa antes de la derecha.                                                                                                           |
| `parse_uni_solucionario.py <pdf> [--columns] --out p.json`                                                                                   | Enunciados + clave por pregunta. Entiende dos layouts: secciones `x.y Título` y capítulos que abren el curso con un título EN MAYÚSCULAS.                                                                                              |
| `crop_pdf_figures.py <pdf> --anchor "<frase>" --out f.png`                                                                                   | Recorta **solo** la figura (banda entre el último renglón del enunciado y las alternativas).                                                                                                                                           |
| `crop_pdf_figures.py <pdf> --mode numbered --section-anchor <"2.1"\|"FÍSICA"> --question N --out q.png --dpi 300`                            | Recorta la pregunta completa (enunciado + alternativas) como un PNG.                                                                                                                                                                   |
| `classify_topics.py`                                                                                                                         | Sugiere curso/tema canónico a partir del vocabulario del enunciado. Es sugerencia: se revisa antes de sembrar.                                                                                                                         |
| `validate_lots.py <taxonomy.json> <dir>...`                                                                                                  | Revisa un directorio de lotes contra todo lo que exige el seeder: taxonomía byte a byte, respuesta dentro del rango, imágenes que existan, procedencia presente, colisiones de hash y PNGs huérfanos. Correr SIEMPRE antes de sembrar. |
| `check_source_url.py <lots-dir> [lote...]`                                                                                                   | Prueba que el `sourceUrl` del lote contenga de verdad sus preguntas: OCR del recorte, frase distintiva, y búsqueda dentro del PDF declarado.                                                                                           |
| `build_lot.py --parsed p.json --pdf x.pdf --lot <slug> --data-dir <data> --source-url <url> --exam-label "<...>" [--all-images] [--dry-run]` | Escribe `<slug>.json`, `<slug>-image.json` y sus directorios de PNGs.                                                                                                                                                                  |

Cuándo usar `--all-images`: cuando `pdftotext` transcribe mal los símbolos del PDF
(fórmulas rotas, `µ` que sale como `P`, radicales perdidos). Un PNG horneado vale más que
un texto en el que no se puede confiar.

Verificación obligatoria antes de sembrar un lote:

1. `validate_lots.py` en verde.
2. Abrir varios PNGs con `Read`: ninguno debe traer una segunda pregunta ni quedar cortado.
3. **Resolver preguntas y contrastar la clave.** Es el único test que detecta un emparejamiento
   falso entre examen y clavijero. Comparar portadas NO basta: la UNAC publica cuadernillos donde
   el nombre del archivo, la portada y el cuerpo dicen tres bloques distintos. Sobre 5
   alternativas, el azar acierta ~20%: por debajo del 90% de aciertos, el lote se descarta.
4. `check_source_url.py` para probar la procedencia. De 12 lotes de la UNAC con la clave ya
   verificada, 5 declaraban un `sourceUrl` que no contiene sus propias preguntas.
5. Comparar las secuencias de claves entre lotes: dos lotes con la misma secuencia son el mismo
   examen cosechado dos veces. Así aparecieron dos pares duplicados que la deduplicación por
   `source_name` no habría atrapado, porque sus etiquetas de procedencia diferían.

## Regla de idioma: el banco se muestra en español

La app arma exámenes para estudiantes que rinden en castellano, así que un enunciado en inglés
o francés no les sirve. **Única excepción**: los cursos de inglés, donde el enunciado en inglés
ES la pregunta (`Inglés`, `Inglés como Lengua Extranjera`).

**El arreglo es traducir o re-clasificar, no esconder.** Un enunciado en otro idioma tiene dos
salidas según lo que la pregunta evalúe:

- **Su materia ES el inglés** (ejercicio de gramática, vocabulario, comprensión de un texto en
  inglés): va al curso de Inglés, donde el enunciado en inglés es justamente el punto.
  Traducirlo lo destruiría — «Complete the text with prepositions» no tiene versión española
  cuya respuesta siga siendo `on - in - at`.
- **Es una pregunta española que alguien publicó traducida**: se traduce de vuelta. Con
  `check_translation.py` para que la traducción no mueva la clave.

Eso se hizo con las 5 que había en el banco (`fix-non-spanish-questions.ts`): 4 ejercicios de
inglés que un blog había archivado bajo Razonamiento Verbal, Filosofía y Economía pasaron al
curso de Inglés, y un problema de cronometría publicado en inglés se tradujo al castellano. De
paso, uno de ellos traía la clave filtrada dentro de una alternativa («…applauded. Key : … Rpta
. A»), que regalaba la respuesta; se recortó.

Los dos controles que quedan puestos:

- Antes de sembrar: `validate_lots.py` marca cada entrada cuyo enunciado no lee como español,
  fuera de los cursos de inglés. Así se evita sembrar por error los originales en francés e
  inglés que conviven con sus traducciones `-es` en `license-pending/`.
- Después de sembrar: `archive-non-spanish-questions.ts` corre en cada arranque. Es la **última**
  línea, no el arreglo: lo que archive es un pendiente — traducirlo o re-clasificarlo — y lo dice
  en el log con el id.

La heurística mira palabras funcionales cortas (`the`, `which`, `les`, `soit`), que es lo que
de verdad separa los idiomas; los sustantivos técnicos viajan entre ellos. Hace falta que
aparezcan dos o más marcas extranjeras Y que superen a las españolas, para que un préstamo
suelto («software») no archive una pregunta buena.

## Licencias: qué fuente sí y cuál no

Antes de cosechar, revisar el aviso de derechos del PDF:

```bash
pdftotext -layout fuente.pdf - | grep -ci "derechos reservados\|prohibida .*reproducci"
```

- **Sí**: UNI `solucionario2019.pdf`, `solucionario20192.pdf`, `solucionario2020.pdf`,
  `solucionario2021.pdf` y el simulacro IEN 2023 (`admision.uni.edu.pe`, sin aviso de
  derechos; el sitio sirve un certificado TLS vencido, usar `curl -k`), UNCP vía Academia
  Ingeniería, cuadernillos MINEDU.
- **No**: los solucionarios UNI 2013–2018, que sí llevan "Derechos reservados. Prohibida la
  reproducción"; y **DEMRE (Chile)**, cuyos folletos PAES/PSU dicen "Derechos reservados.
  Prohibida su reproducción total o parcial" — quedan fuera aunque el clavijero sea público.
- **No**: bancos de preguntas de GitHub generados con IA (revisados: uno traía la clave
  contradiciendo su propia explicación) y repos con licencia no comercial.

## Recorte de imágenes (a mano, para fuentes HTML o escaneadas)

1. Descargar el PDF/página fuente (`curl`).
2. Rasterizar la página: `pdftoppm -png -r 200 fuente.pdf pagina` (o screenshot con Playwright
   para fuentes HTML).
3. Recortar SOLO el gráfico: `magick pagina-N.png -crop WxH+X+Y +repage salida.png`
   (en macOS también sirve `sips --cropOffset`).
4. Verificar visualmente cada recorte (Read del PNG): sin texto de enunciado, sin letras de
   alternativas, sin bordes de página.
5. Nombrar `<curso>-<nn>-<descriptor>.png`, guardar en el directorio hermano del JSON.

## Dónde viven los lotes y cómo llegan a producción

- `apps/api/src/db/data/collected/` — corpus web original (~64k preguntas de texto). Lo
  siembra `seed-collected-questions.ts` en cada arranque.
- `apps/api/src/db/data/lots/` — lotes cosechados de exámenes oficiales, con sus PNGs
  hermanos. Los siembra `seed-lot-questions.ts` en cada arranque: **sube cada imagen al
  object store antes de escribir la fila**, para que ninguna pregunta apunte a un asset
  que no existe.
- `apps/api/src/db/data/license-pending/` — material con licencia en trámite. **Ningún
  seeder lo lee**; se siembra a mano cuando la licencia llega (ver `SOURCES.md` ahí).

Deduplicación al resembrar: las estructuradas por `body_hash`, que ahora incluye la
huella de la figura — un banco de circuitos repite el mismo enunciado sobre doce dibujos
distintos, y sin eso el índice único se quedaba con uno solo. Las de imagen, por
`source_name`, que el cosechador llena con examen, curso y número de pregunta.

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
