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

`--all-images` produce una forma **de paso, no de destino**. Un PNG de la hoja entera
arrastra lo que la hoja traía y que no es la pregunta: su numeración de origen (`17.`,
`06.`), sus alternativas en minúscula `a)`-`e)` chocando con las `A)`-`E)` que imprime
`typst-template.ts`, marcas de agua (`Prohibida su venta`) y a veces un pedazo de la
pregunta vecina. Eso contradice la regla de oro de arriba, y así se vieron 12 de las 70
preguntas del examen del 2026-08-23.

### Recuperar un lote horneado (sin proveedor de visión)

Quien lee los PNG es la sesión de agente que trabaja en este repo. No hace falta pagar un
endpoint para que describa una imagen que el propio lector puede abrir, así que el trabajo
se parte en dos y queda reanudable:

```bash
# 1. qué recortes faltan, con la ruta que hay que abrir
pnpm --filter @exams-generator/api restructure-image-lot -- --status
pnpm --filter @exams-generator/api restructure-image-lot -- --lot <slug> --export --limit 12

# 2. medir las cajas en vez de calcularlas a ojo
python3 tools/harvest/figure_bounds.py <crop>.png --band 0.60 0.99   # fila de alternativas
python3 tools/harvest/figure_bounds.py <crop>.png --band 0.17 0.60   # figura del enunciado

# 3. escribir db/data/lots/transcriptions/<slug>.json y comprobar que compila
pnpm --filter @exams-generator/api restructure-image-lot -- --verify <archivo>.json

# 4. aplicar, y mirar cómo IMPRIME antes de sembrar
pnpm --filter @exams-generator/api restructure-image-lot -- --lot <slug> --apply <archivo>.json
pnpm --filter @exams-generator/api preview-lot -- <slug> "pregunta 43"
```

Una transcripción es un objeto por recorte, unido por `imagePath`:

| campo | para qué |
| --- | --- |
| `bodyTypst` / `alternatives` | el enunciado y las opciones, ya en Typst |
| `figureCode` | CeTZ, cuando la figura se puede redibujar; entonces no se recorta nada |
| `figureCrop` | la caja de la figura dentro del recorte, en fracciones 0..1 |
| `alternativeCrops` | una caja por alternativa, `null` donde la opción es texto |
| `unreadable` | por qué este recorte NO puede volverse texto; se queda como imagen |

Reglas que no se negocian:

- **La clave publicada del lote gana siempre.** El lector la adivinaría desde una foto, y una
  clave mal puesta es el único defecto que un profesor no detecta a simple vista.
- **Cinco alternativas**, más estricto que el piso de 2 del banco: una opción perdida es el
  síntoma que hizo hornear el PNG, y aceptar cuatro lavaría esa pérdida.
- **Nunca se reutiliza el recorte de pregunta entera como complemento** — reimprimiría el
  enunciado junto con la numeración y las letras del original. El complemento es la figura
  sola, recortada.
- **Medir, no estimar.** `figure_bounds.py` imprime las cajas listas para copiar; una caja un
  pelo angosta amputa el borde derecho de un dibujo y una un pelo ancha se traga el `c)` del
  vecino. Las dos sobreviven al compile y solo salen en el examen impreso.
- **Verificar el compile y la impresión.** `--verify` compila con el binario Typst pineado
  (0.15.1) y `--apply` se niega a aplicar un lote que no compile. `preview-lot` renderiza con
  la plantilla real: es lo único que muestra los defectos de layout, que no fallan el compile.

Al terminar un lote, `validate_lots.py` avisa de los PNG de pregunta entera que ya no
referencia nadie; `--apply --prune` los borra.

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

## Receta de restructuración de un lote-imagen

Cómo se transcribe un lote entero de `<lote>-image.json` a texto. El agente que
lee los PNG es la sesión de este repositorio: puede abrir la imagen, así que
pagarle a un endpoint de visión sería gastar en una capacidad que ya está aquí.

1. `restructure-image-lot --lot <slug> --export --out <archivo>` lista lo pendiente.
2. Abrir CADA PNG con `Read`. Nada de deducir un enunciado por su nombre de archivo.
3. Escribir un script de Python que arme `{ "transcriptions": [...] }`. Genera el
   JSON con `json.dump`, nunca a mano: el escapado de `\n` y de las comillas
   dentro de `$...$` es donde se rompe todo.
4. `restructure-image-lot --verify <archivo>` compila las 21/25/70 con el binario
   Typst pineado. `--apply` se niega a aplicar un lote que no compile.
5. **Revisar los recortes ANTES de aplicar.** Armar una hoja de contactos con PIL
   (una miniatura por caja, en una sola imagen) y abrirla con `Read`. Una caja un
   pelo angosta amputa un rótulo; una un pelo ancha se traga la letra `c)` del
   vecino. Las dos compilan y solo salen en el examen impreso.
6. `restructure-image-lot --lot <slug> --apply <archivo>`, luego `validate_lots.py`.

### Lo que muerde

- **El recorte del vecino.** Varias capturas traen la cola de la pregunta
  siguiente. En `uni-2019-2`, el recorte de Física 8 contiene la constante y las
  cinco alternativas de Física 13, cuyo propio recorte no trae ninguna. Antes de
  marcar una pregunta como incompleta, mirar el recorte de al lado.
- **Alternativas que son dibujos.** Van en `alternativeCrops` (una caja por ranura,
  `null` donde la opción es texto) y el texto de esas ranuras queda en `""`.
  `validateStructuredContent` lo acepta gracias a `alternativeHasImage`.
- **Nombres de símbolo en Typst 0.15.1.** La intersección es `inter`, NO `sect`.
  Los corchetes angulares son `chevron.l` / `chevron.r`, NO `angle.l`. No existe
  el ⊙ punteado; para notación de operador inventado, recortar la figura.
- **Química.** La convención real del repo es texto vertical entrecomillado dentro
  de matemática: `$"Ca"_3("PO"_4)_2$`. Pegar los tramos (`"CH"_3"COOH"`) o la
  fórmula imprime con un hueco. Vale aunque `TYPST_MATH_RULES` se lo prohíba al
  modelo: esa regla existe por el escapado del JSON, no porque a Typst le moleste.
- **Comas decimales dentro de matemática.** `$0","81$`, si no Typst las espacia
  como separador.
- **Una barra literal** es `slash` o `\/`; `/` a secas arma una fracción.
- **Las abreviaturas españolas de trigonometría no son operadores.** `sen` y `tg`
  hay que entrecomillarlos (`$"sen" x$`), a diferencia de `sec`, `arccos` o
  `arcsin`, que Typst sí reconoce y compone derechos solos.
- **El conjunto vacío es `emptyset`**, no `diameter`.
- **Un lote por nombre de archivo.** Cuando corren varios agentes a la vez sobre
  lotes distintos comparten el directorio de scratchpad, y un `build_batch.py`
  genérico se pisa entre sesiones. El nombre del lote va en cada archivo
  temporal.

### Erratas del examen original

Dos lotes las trataron al revés el mismo día, así que la regla queda escrita:

- **Una falta de ortografía se corrige.** "ORACIÓN ELIMINDA", "¿Cuántros
  triángulos", "los cincos años", "mueren rapidamente". No cambian nada de la
  pregunta y, impresas, parecen un defecto NUESTRO, no de la UNCP.
- **Todo lo demás va literal.** Un número, un símbolo, una fórmula, un nombre
  propio, una unidad, la redacción del enunciado. Si al arreglarlo cambia lo que
  se pregunta o lo que se responde, no se toca: eso es resolver, no transcribir.

La duda se resuelve por consecuencia, no por cuántas letras cambian. Si al que
rinde el examen le cambia la respuesta, va literal aunque parezca un error.

Dos casos reales del borde, los dos correctos:

- "Si el **reporte** se hiciera proporcionalmente" en un problema de reparto
  proporcional. Con "reporte" la frase no significa nada y solo hay una lectura
  posible, así que se arregla — pero se avisa, porque ya no es una letra.
- "ZnS → Sulfato de zinc", que debería decir sulfuro, se queda literal: la
  pregunta puede estar pidiendo justamente detectar el nombre incorrecto, y
  arreglarlo la destruye.

### La captura de página entera, después de transcribir

Una vez que el lote es texto, su PNG de página entera no lo lee nadie: ni el
sembrador, ni el API, ni la web. Solo sobreviven los pocos que una entrada
sigue nombrando, o sea las preguntas que se quedan como imagen a propósito.

Los demás se borran. El 2026-09-08 se fueron 1462 archivos, 114 MB, y el
directorio de lotes bajó de 128 MB a 16 MB. Importa porque el `Dockerfile.api`
hace `COPY . .` y el build copia `src/db/data` entera al runtime, así que cada
uno de esos megas viajaba dentro de la imagen del API en cada deploy.

**Dónde queda el original.** En git. Están committeados desde la cosecha, así
que para revisar una transcripción se saca el PNG de cualquier commit anterior
al borrado. Borrarlos NO adelgaza el repositorio: los blobs se quedan en el
pack. Lo que adelgaza es el checkout y la imagen.

**Consecuencia.** `check_source_url.py` verifica la procedencia haciendo OCR del
recorte de página entera, así que para un lote ya transcrito se queda sin nada
que leer. Es la herramienta que se usa cuando el lote llega, no después.

Para podar durante la transcripción está `--apply --prune`, que borra solo lo
que ninguna entrada referencia. Para un lote ya aplicado, el criterio es el
mismo: fuera todo PNG bajo `<lote>-image/` que ningún `imagePath`,
`figureSourceImagePath` ni `alternativeImagePaths` nombre. `validate_lots.py`
los lista como `ORPH` antes, y después no debe quedar ninguna línea `ORPH`.

### Llegar a producción

No hay paso manual. `seed()` corre `seedLotQuestions` y enseguida
`retireSupersededImageQuestions`, que borra la fila-imagen que el texto reemplazó
y le pasa sus referencias de examen a la fila de texto. Es idempotente, así que
en régimen son dos selects y ninguna escritura. Un lote restructurado llega a
producción con un deploy común.

### Re-archivar mientras se transcribe

La cosecha nunca leyó estas preguntas: de una imagen horneada solo conocía el
encabezado de sección del examen ("Álgebra"), así que el tema debajo es una
adivinanza. Por eso Álgebra > Polinomios terminó guardando un problema de
mercado, una esperanza matemática y una circunferencia inscrita.

El que transcribe SÍ tiene el enunciado delante, así que es el único momento
barato para corregirlo. Una transcripción puede traer `courseName` y `topicName`
propios y la entrada se archiva ahí:

```json
{
  "imagePath": "lot-6-...-image/alg-2026-2-a2-alg-66.png",
  "bodyTypst": "Una ama de casa va al mercado y observa que...",
  "alternatives": ["12", "11", "16", "10", "14"],
  "courseName": "Razonamiento Matemático",
  "topicName": "Planteo de Ecuaciones"
}
```

Reglas:

- **Los dos o ninguno.** Un curso con el tema del otro es un par que el seeder
  no puede resolver, y `planImageLotRestructure` lo rechaza.
- **El par tiene que existir en `canonical-taxonomy.json`.** `validate_lots.py`
  lo comprueba después de aplicar, pero llegar ahí con un par inventado obliga a
  rehacer el lote.
- **Omitirlos deja el archivado del lote como está.** Solo hay que moverla
  cuando el tema es claramente otro, no para afinar entre dos temas defendibles.
