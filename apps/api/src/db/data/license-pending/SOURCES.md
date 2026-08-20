# Lotes en espera de licencia

Los lotes de este directorio están **listos para sembrar pero no sembrados**. Provienen de
libros de problemas cuya licencia todavía se está gestionando; el material se prepara por
adelantado para que el día que la licencia llegue, sembrar sea un solo comando.

El seeder de arranque solo lee `db/data/collected/`, así que nada de aquí entra a producción
por sí solo. Para sembrar un lote una vez autorizado, desde `apps/api/`:

```bash
DOTENV_CONFIG_PATH=../../.env ts-node -r dotenv/config -r tsconfig-paths/register \
  src/scripts/seed-gap-topic-with-image.ts src/db/data/license-pending/<lote>.json
DOTENV_CONFIG_PATH=../../.env ts-node -r dotenv/config -r tsconfig-paths/register \
  src/scripts/seed-image-question.ts src/db/data/license-pending/<lote>-image.json
```

Reglas que se respetan igual, sin importar la licencia:

- La clave sale siempre de la obra misma. Ninguna respuesta se deduce.
- Nada generado por IA: se descarta por fiabilidad, no por licencia.

| Lote | Libro | Repo | URL | Licencia (citada) | Preguntas | Extraído |
| --- | --- | --- | --- | --- | --- | --- |
| `lot-24-picuino-electricidad` | Test Picuino — bancos `es-electric-*` (circuito eléctrico, ley de Ohm, serie/paralelo, unidades y magnitudes) | `picuino/test` | https://github.com/picuino/test | «Creative Commons Attribution-ShareAlike 4.0» (cabecera de cada `.yaml`; `Copyright: 2021/2023 por Carlos Félix Pardo Martín`). El repo declara `cc-by-sa-4.0` y `Credits.md` confirma: *"El texto de los cuestionarios en los archivos .yaml (preguntas y opciones de respuesta) se distribuyen bajo licencia Creative Commons Attribution-ShareAlike 4.0"* | 230 (144 con figura) | 2026-08-20 |
| `lot-25-bancostecno-circuitos` | Banco de preguntas de tecnoloxía — `bancoTecno_es.csv`, bloque «circuitos» | `procastino/bancosTecno` | https://github.com/procastino/bancosTecno | «Creative Commons Legal Code — CC0 1.0 Universal» (primeras líneas del archivo `LICENSE` del repo, dedicación al dominio público; GitHub reporta `cc0-1.0`) | 76 (66 con figura) | 2026-08-20 |
| `lot-27-cepre-unmsm-2019-i` | *UNMSM Centro Preuniversitario — Boletines del Ciclo 2019-I*, semanas 1-18 (cursos de texto) | `gitbookarch/CepreSanMarcos` | https://github.com/gitbookarch/CepreSanMarcos | **El repo no tiene archivo `LICENSE`** y GitHub no le reconoce licencia; el `README.md` completo es una sola línea: «`# CepreSanMarcos`». La única declaración de derechos está impresa en la obra: el pie de **cada página** de cada boletín dice «**(Prohibida su reproducción y venta)**» (112 apariciones en el boletín de la semana 1). Los metadatos del PDF dan `Title: UNIVERSIDAD NACIONAL MAYOR DE SAN MARCOS`, `Author: Dangeldesign` | 466 (sin figuras) | 2026-08-20 |
| `lot-26-unmsm-historia-mcq` | «Recopilación de preguntas de Historia de exámenes de admisión a la Universidad Nacional Mayor de San Marcos» (~1970–2020), 36 capítulos temáticos | `davidquicast/Corpus-Historia-Peru-ExamenAdmisionUNMSM-MultipleChoice` | https://github.com/davidquicast/Corpus-Historia-Peru-ExamenAdmisionUNMSM-MultipleChoice | El repo **no tiene archivo `LICENSE`** y GitHub no reporta licencia. Lo único que dice sobre licencia, citado literal: el front matter de `README.md` declara `license: apache-2.0`, y **cada registro** de `cuestionario.json` lleva `"license": "Desconocida"`. El mismo registro cita como origen `"source": "https://www.slideshare.net/slideshow/historia-del-per-recopilacin-ex-adm-unmsm/251464302"` | 439 (sin figura) | 2026-08-20 |

## Nota sobre estos dos lotes

**No están esperando la licencia en trámite.** Son los únicos candidatos que aparecieron con
licencia abierta ya concedida, así que su bloqueo es distinto y hay que decidirlo aparte:

- `lot-25` es **CC0**: dominio público, sin obligaciones. Se puede mover a `collected/` cuando se
  quiera.
- `lot-24` es **CC BY-SA 4.0**: exige (a) atribuir a Carlos Félix Pardo Martín y (b) *share-alike*.
  La cláusula share-alike es la que hay que mirar antes de sembrar: obliga a redistribuir las obras
  derivadas bajo la misma licencia. Conviene que lo revise quien lleve el tema legal, porque afecta
  a cómo se publica el banco, no solo a este lote.

Ambos vienen del currículo de Tecnología de la ESO española, no de un examen de admisión peruano.
Por eso van etiquetados `difficulty: "easy"` y no `"hard"`: son ejercicios de circuitos de
secundaria, correctos y con figura limpia, pero por debajo del nivel UNI/UNCP. Sirven para dar
volumen al tramo fácil de Electrodinámica, no para simular un examen de admisión.

La clave de ambos es **posicional y está documentada en la propia obra** (la primera alternativa es
la correcta). Verificado, no deducido: **648/651** en `picuino` contra su propia exportación Moodle
(`fraction="100"`), y **120/120** en `bancosTecno` sobre los pares *inequívocos* (una fila del CSV y
una sola pregunta del XML con el mismo juego de opciones); otros 12 pares se descartan por ambiguos
—mismo enunciado y mismas opciones, distinta figura— en vez de contarlos como coincidencia. Al
construir el lote las alternativas se barajan con semilla fija por pregunta para que la respuesta no
caiga siempre en el índice 0; la clave viaja con su opción (round-trip 306/306).

### Revisión del 2026-08-20 sobre `lot-25` (+2 preguntas, 74 → 76)

Al reprocesar el CSV aparecieron 5 filas del bloque «circuitos» que el primer barrido había
descartado. Revisadas una a una:

- **Recuperadas (2).** Filas 64 y 142: la ruta de la figura que trae el CSV lleva espacios sueltos
  (`images/duasPilasSerie. png`, `images/3 ledParal4IntAcenden.png`) y el normalizador anterior solo
  quitaba el espacio *inmediatamente anterior* a la extensión, así que no resolvía ninguno de los dos
  casos. Los ficheros existen en el repo; ahora se resuelven probando la ruta tal cual, luego sin el
  espacio previo a la extensión y por último sin espacios. Ambas figuras verificadas a ojo.
- **Descartadas por figura ausente (2).** Filas 100 y 101 apuntan a `images/2receptoresSerie.png` y
  `images/2resisSerie.png`, que **no existen** en el repo. Las dos preguntas son «¿Cuál es falsa,
  para el circuito de la figura?»: sin la figura no se pueden responder.
- **Descartada por defecto de la obra (1).** Fila 65 pide la resistencia equivalente de «dos
  resistencias de 4Ω» en paralelo y publica como clave 2Ω (correcto para 4‖4), pero la figura que
  referencia (`images/2ResisParalelo.png`) dibuja una de 2Ω y otra de 4Ω: **la figura contradice al
  enunciado y a la clave**. El repo sí contiene el dibujo que corresponde
  (`circuits_2ResisParalelo44.png`, el que usa `bancoTecno_gal.csv` fila 109), pero sustituirlo sería
  reparar la obra en vez de reproducirla, así que la fila se descarta y queda anotada en el script.

Comprobado además que las otras figuras numéricas del lote sí concuerdan con su clave: los nombres
de fichero codifican los valores (`3ResisSerie223` → 7Ω, `3ResisParalelo666` → 2Ω,
`3ResisParalelo422` → 4/5Ω, `2ResisParalelo36` → 2Ω, `3ResisMixto436` → 6Ω…). La fila 65 era la
única del grupo con un nombre genérico y sin valores, y la única inconsistente.

Detalle de la comprobación de `picuino` (re-verificada el 2026-08-20, barrido completo de los 18
bancos `es-electric-*`, no una muestra): cada pregunta del `.yaml` se empareja con su pregunta del
XML por la terna *enunciado + juego de opciones + bytes de la figura*. La figura es imprescindible
en el emparejamiento: en `series-parallel-identify` las 40 preguntas comparten enunciado y opciones
literales y solo se distinguen por el dibujo, así que emparejar solo por texto deja 65 preguntas
ambiguas en el conjunto. Con la figura incluida: **648 confirmadas, 0 discrepancias, 0 ambiguas**;
las 3 restantes son preguntas de `es-electric-digital.yaml` que aún no están en el XML exportado
(banco no sembrado, así que no afectan a ningún lote). De las 230 de `lot-24`, las 230 quedan
confirmadas una a una, y sus 144 figuras son copias byte a byte de los PNG del repo.

### `picuino/test` ya está agotado — no volver a cosecharlo

El 2026-08-20 se pidió una segunda extracción del mismo libro con el slug `book-0-*`. **No se
escribió**: habría duplicado las mismas 230 preguntas y los mismos 144 PNG dentro de este mismo
directorio. Los 18 bancos `es-electric-*` suman 651 preguntas; `lot-24` ya se llevó las 230 útiles
(8 ficheros: `circuits`, `circuits-2`, `ohms-law`, `ohms-law-2`, `series-parallel-calc`,
`series-parallel-calc-2`, `series-parallel-identify`, `units-magnitudes`).

Las 421 restantes se dejaron fuera a propósito, por contenido y no por licencia: `color-code-1/2`
(168) son consultas de la tabla de colores de resistencias, `components-name` (35) y
`components-type` (34) piden nombrar el símbolo de un componente, `breadboard` (13) es cableado de
protoboard y `digital` (32) son puertas lógicas — nada de eso existe en el temario preuniversitario
y solo encajaría en `Electrodinámica` a la fuerza. `introduction` (35) es historia de la
electricidad (Tales, el ámbar, la lámpara del XIX) y `energy-4/5/6` (104) son preguntas
cualitativas de cultura energética, sin cálculo. Si algún día se quieren, la clave de las 421 ya
está verificada por el mismo barrido; lo que falta es la decisión de temario, no la comprobación.

## `lot-26-unmsm-historia-mcq` — el único libro de la cosecha de olimpiadas que encajó

Es el único hallazgo de la búsqueda de «libros de problemas de nivel olimpiada/ingreso» que llega
con las tres cosas a la vez: **opción múltiple de cinco alternativas**, **clave publicada por la
propia obra** y **castellano de examen de admisión peruano**. Los demás candidatos (Irodov,
Bukhovtsev, Krotov, Tiwari, olimpiadas iberoamericanas de física, fisicoquímica olímpica hondureña)
son de respuesta abierta: traen la respuesta al final, pero no hay alternativas que copiar, así que
no caben en el contrato `alternatives[5]` sin inventárselas. Quedan documentados como descartados,
no como pendientes.

**La clave está verificada contra la tabla de claves del propio libro, no deducida.** El repo
publica esa tabla aparte en `files/data_clean/claves.txt`, con la forma
`| 1 | A | 46 | E | 91 | D | …` — número de pregunta y letra impresa. Se reparseó esa tabla y se
comparó con el índice 0-based que trae `cuestionario.json`: **449/449 coinciden, 0 discrepancias,
0 preguntas sin clave**. El script está en el scratchpad de la sesión
(`books/unmsm/build_unmsm_lot.py`); la comprobación se hizo antes de construir el lote.

**No es contenido generado por IA**, y se comprobó en vez de suponerlo. El pipeline del repo usa
Mistral OCR para *transcribir* un PDF real (`files/data_ocr/cuestionario.pdf`, 62 MB, el
solucionario escaneado), y tanto los enunciados como las claves salen de ese escaneo — el texto
intermedio queda visible en `files/data_clean/cuestionario.txt` con el formato original
`50. …  A) … B) … C) … D) … E)`. La IA transcribe, no responde: la señal de alarma habitual (la
clave contradice su propia explicación) no aplica porque aquí no hay explicación generada, solo la
letra que la tabla imprime.

Se dejaron fuera **10 de las 449** por defecto de la obra escaneada: nueve imprimen 4 alternativas
y una imprime 2 (preguntas 49, 66, 108, 147, 179, 287, 296, 325, 419, 438). Se descartan en vez de
rellenarlas.

Dos preguntas conservan un distractor repetido tal como está impreso (la 1, por ejemplo, repite
«La tradición oral española.» en C y D). Se comprobó que **en ningún caso el texto repetido es el de
la alternativa correcta**, así que la clave sigue siendo inequívoca. Se reproduce el defecto en vez
de corregirlo.

Mapa de los 36 capítulos del libro a la taxonomía canónica: los capítulos de horizontes y culturas
preincas (Chavín, Paracas, Nazca, Moche, Tiahuanaco, Wari, Chimú, Chancas, y también Mayas/Aztecas)
caen en «Poblamiento americano y culturas preincaicas»; invasión, resistencia, guerras civiles y los
dos de virreinato en «Conquista y Virreinato del Perú»; reformas borbónicas, precursores y las dos
corrientes libertadoras en «Independencia del Perú y emancipación americana»; del primer militarismo
a la República Aristocrática, pasando por la Guerra con Chile, en «República del Perú (siglo XIX) y
dependencia inglesa». El script valida contra `canonical-taxonomy.json` y aborta si algún nombre no
existe literalmente.

## Corrección del 2026-08-20 sobre `lot-26-unmsm-historia-mcq` (2 claves equivocadas)

El lote se construyó desde el array `options` de `cuestionario.json`. Ese array **no es
fiable**: donde el libro imprime las alternativas en tres columnas, el OCR de origen las
aplanó en orden *visual* (`A) … D) … B) … E) … C)`) pero dejó el índice `answer` apuntando a
una posición *alfabética*. Resultado: la opción marcada como correcta es el texto
equivocado, aunque la letra de la tabla de claves sea la correcta.

Se verificaron las 439 preguntas contra la letra que el libro imprime realmente
(`files/data_clean/cuestionario.txt`, donde cada alternativa lleva su rótulo `A)`…`E)`)
cruzada con la tabla de claves del propio libro (`files/data_clean/claves.txt`). Dos
discrepancias, ambas corregidas reordenando las alternativas al orden impreso:

| Pregunta | Clave del libro | Marcaba | Imprime el libro |
| --- | --- | --- | --- |
| 154 (RESISTENCIA ANDINA) | B | «Torote» | «**Taki Onkoy**» |
| 447 (MAYAS, AZTECAS, CHOROTECAS) | E | «La marca» | «**El calpulli**» |

Las dos correcciones son históricamente las esperadas —el movimiento de Huamanga de 1564 es
el Taki Onqoy, y el equivalente azteca del ayllu es el calpulli— pero **no se dedujeron**:
salen de cruzar el rótulo impreso con la tabla de claves. Tras la corrección: **438 de 439
coinciden con la letra impresa, 0 discrepancias**; la restante no es verificable porque el
texto del libro no rinde las cinco alternativas para esa pregunta.

Lección para el resto del directorio: **cuando la obra imprime el rótulo (`A)`…`E)`), las
alternativas se leen por rótulo, nunca por posición en un array ya aplanado.** Cualquier
libro maquetado a dos o tres columnas tiene este fallo latente.

No se escribió un segundo lote del mismo libro: se detectó a tiempo que
`lot-26-unmsm-historia-mcq` ya cubría estas 439 preguntas y habría duplicado el banco.

## `lot-27-cepre-unmsm-2019-i` — boletines oficiales del CEPRE-UNMSM

`gitbookarch/CepreSanMarcos` archiva los boletines semanales del Centro Preuniversitario de
la UNMSM: **20 ciclos completos (2010-I a 2019-II), ~19 boletines por ciclo**, PDFs con capa
de texto real (no escaneados). Cada boletín trae, por curso, los ejercicios con su
`Solución:` desarrollada y la clave impresa como `Rpta.: X`. La clave sale siempre de ahí.

De este lote sale solo el ciclo **2019-I, semanas 1-18**, y solo los cursos cuyo enunciado
sobrevive al texto plano: Biología, Psicología, Economía, Filosofía, Educación Cívica,
Lenguaje, Literatura, Historia y Geografía. **466 preguntas**, verificadas una a una: la
alternativa marcada correcta aparece en el boletín bajo la misma letra que el boletín
publica como `Rpta.` (466/466, 0 discrepancias).

Lo que se dejó fuera, y por qué:

- **Matemática, Física y Química.** Sus enunciados llevan fórmulas y figuras que
  `pdftotext` corrompe en silencio. Necesitan la ruta de imagen (`crop_pdf_figures.py`), no
  la de texto. Es trabajo pendiente, no material descartado: son ~8 cursos × 18 semanas ×
  20 ciclos.
- **Habilidad Verbal.** Casi toda la sección son preguntas colgadas de un TEXTO de
  comprensión lectora; sin el pasaje no se pueden responder.
- **La semana 19 de cada ciclo.** Es el repaso acumulado: su bloque de Biología recorre en
  54 preguntas desde bioelementos hasta ecología, así que «un bloque, un tema del temario»
  deja de valer y la etiqueta sería falsa para casi todo el bloque. Se excluye por número de
  semana y, por si acaso, por tamaño (>20 preguntas).
- **86 secciones más** cuyo tema no quedó claro. El tema se decide por votación de todo el
  bloque contra el vocabulario de `canonical-taxonomy.json` (nombre del tema, sus
  `mapsFrom` y sus subtemas); si el ganador no supera un mínimo absoluto y un margen sobre
  el segundo, la sección se descarta entera en vez de repartir etiquetas dudosas.

Aviso sobre el tema (no sobre la clave): la votación por bloque acierta el temario de la
semana, pero dentro de un bloque puede haber preguntas que encajen mejor en un tema vecino
—se vio una de epistemología etiquetada como «Ética social y problemas contemporáneos»—. La
clave está verificada; la etiqueta de tema es una clasificación y admite revisión.

### Lo que este repo todavía tiene sin tocar

Los 19 ciclos restantes (2010-I … 2018-II) son el mismo formato y el mismo pie de página.
A ~466 preguntas de texto por ciclo, el repo rinde del orden de **9 000 preguntas de texto**
más las de ciencias exactas por la ruta de imagen. Es, con diferencia, la mayor fuente
preuniversitaria peruana encontrada en GitHub.
