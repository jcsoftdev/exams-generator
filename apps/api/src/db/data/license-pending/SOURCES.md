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
| `lot-26-unmsm-historia-mcq` | «Recopilación de preguntas de Historia de exámenes de admisión a la Universidad Nacional Mayor de San Marcos» (~1970–2020), 36 capítulos temáticos | `davidquicast/Corpus-Historia-Peru-ExamenAdmisionUNMSM-MultipleChoice` | https://github.com/davidquicast/Corpus-Historia-Peru-ExamenAdmisionUNMSM-MultipleChoice | El repo **no tiene archivo `LICENSE`** y GitHub no reporta licencia. Lo único que dice sobre licencia, citado literal: el front matter de `README.md` declara `license: apache-2.0`, y **cada registro** de `cuestionario.json` lleva `"license": "Desconocida"`. El mismo registro cita como origen `"source": "https://www.slideshare.net/slideshow/historia-del-per-recopilacin-ex-adm-unmsm/251464302"` | 439 (2 con figura) | 2026-08-20 |
| `book-4-qcm-exo7` | *QCM de mathématiques* — Exo7 / Unisciel / Université de Lille (L1), 25 capítulos en `questions-*/format-yaml/` + el QCM de probabilidades L2 de Julien Worms (`questions-worms.tex`) | `exo7math/qcm-exo7` | https://github.com/exo7math/qcm-exo7 | **El repo no tiene archivo `LICENSE`** y la GitHub API reporta `license=null`. La única declaración está en prosa, en el `README.md`, citada literal: «*Les documents sont diffusés sous la licence **Creative Commons -- BY-NC-SA -- 4.0 FR**.*» | 170 (1 con figura) | 2026-08-20 |

| `book-5-jamb-myschool-lwp` | Preguntas pasadas de JAMB/UTME (Nigeria), scrapeadas de myschool.ng y publicadas como JSON por curso y año | `Emmanuelprime/LearnWithPrime` | https://github.com/Emmanuelprime/LearnWithPrime | **El repo no tiene archivo `LICENSE`**, GitHub reporta `license=null` y el `README.md` está vacío (0 bytes): no hay ninguna declaración de términos. El contenido es scrapeado de `myschool.ng`, un sitio comercial de terceros | 1259 (sin figuras) | 2026-08-20 |

## `unverified-unac/` — lotes de la UNAC que NO se pueden sembrar

Los exámenes escaneados de la Universidad Nacional del Callao se cosecharon bien (los recortes
están limpios y las claves se verificaron resolviendo preguntas), pero la UNAC publica el mismo
cuadernillo bajo varios nombres de archivo, y nombre, portada y cuerpo del PDF se contradicen
entre sí. Eso rompe la procedencia, que es justo lo que hace falta para responder «de dónde salió
esta pregunta».

`tools/harvest/check_source_url.py` lo comprueba en vez de confiar: pasa OCR al recorte de una
pregunta, saca una frase distintiva y la busca dentro del PDF que el lote declara como fuente.
De los 12 lotes que superaron la verificación de clave, **7 tienen la procedencia probada y 5 no**.

Aquí quedan, con el trabajo del recorte intacto y sin riesgo de que nadie los siembre:

| Lote | Preguntas | Por qué no entra |
| --- | --- | --- |
| `scan-3-unac-2021-i` | 40 | Emparejamiento examen/clavijero falso (verificación de clave). |
| `scan-10-unac-2022-i` | 70 | Emparejamiento falso. |
| `scan-12-unac-2022-i` | 70 | Emparejamiento falso: 0 de 14 preguntas resolubles coincidían con la clave. |
| `scan-21-unac-2022-ii` | 70 | Emparejamiento falso. |
| `scan-1-unac-2021-i` | 69 | Claves correctas, pero su `sourceUrl` no contiene estas preguntas. |
| `scan-4-unac-2021-1` | 35 | Claves correctas (20/20), pero **ninguno** de los dos PDFs candidatos contiene la pregunta 35. |
| `scan-11-unac-2021-i` | 35 | Duplicado exacto de `scan-4` (35/35 claves iguales) y misma procedencia sin probar. |
| `scan-8-unac-2021-ii` | 70 | Duplicado exacto de `scan-6` (70/70 claves iguales); su `sourceUrl` apunta a otro examen. |
| `scan-20-unac-2022-ii` | 40 | Claves correctas, procedencia sin probar. |

Para rescatar cualquiera de los cinco últimos basta con encontrar el PDF que de verdad los
contiene entre los ~95 que publica la UNAC, y corregir su `sourceUrl`. El contenido ya está
verificado.

## Traducciones al español (2026-08-20)

Los dos lotes que no venían en castellano ya están traducidos. **Sembrar la versión `-es`, no
el original**: el original se conserva solo para poder auditar la traducción contra su fuente.

| Original (no sembrar) | Versión a sembrar | Preguntas |
| --- | --- | --- |
| `book-4-qcm-exo7.json` (francés) | `book-4-qcm-exo7-es.json` | 170 |
| `book-5-jamb-myschool-lwp.json` (inglés) | `book-5-jamb-myschool-lwp-es.json` | 1259 |

Qué se conservó intacto, comprobado con `tools/harvest/check_translation.py` sobre las 1429:
`correctAnswer`, el orden y el número de alternativas, la taxonomía, `sourceUrl`, todos los
números y todos los tramos de matemática `$...$`. Cero enunciados idénticos al original, que es
la señal de una tanda que se saltó. Cada `sourceName` lleva el sufijo `[traducción al español]`.

Los importes en naira **no se convirtieron**: la aritmética de la pregunta depende de esas cifras
y su respuesta ya está fijada por la clave impresa. Solo se les puso el símbolo correcto y la coma
decimal del castellano (`N225.00` → `₦225,00`).

Dos cosas quedaron señaladas y sin tocar, a propósito:

- El separador decimal fuera de la moneda es mixto (123 con punto, 82 con coma). Homogenizarlo a
  ciegas corrompería notación que no es decimal: hidratos como `CuSO4.5H2O`, iniciales como
  `J.J. Thomson`. Necesita una pasada con reglas por curso.
- Los defectos del impreso original se tradujeron fielmente en vez de arreglarse: un distractor mal
  redactado en la fuente sigue mal redactado en español.

## Qué le falta a cada lote para poder sembrarse

La licencia no es lo único que bloquea. Estado real, lote por lote:

| Lote | Idioma | Nivel | Bloqueo para sembrar |
| --- | --- | --- | --- |
| `lot-24-picuino-electricidad` | Español | ESO (`easy`) | Solo la licencia. El contenido está listo. |
| `lot-25-bancostecno-circuitos` | Español | ESO (`easy`) | Nada: CC0 es dominio público. Sembrable ya si se quiere material de circuitos por debajo de nivel UNI. |
| `lot-26-unmsm-historia-mcq` | Español | Admisión UNMSM (`hard`) | Licencia sin declarar (el README dice `apache-2.0`, cada registro dice «Desconocida»). Contenido verificado pregunta a pregunta. |
| `lot-27-cepre-unmsm-2019-i` | Español | Preuniversitario (`hard`) | **La obra prohíbe expresamente su reproducción** («Prohibida su reproducción y venta», en cada página). Necesita permiso escrito de la UNMSM, no solo que caduque una gestión. |
| `book-4-qcm-exo7-es` | Español (traducido del francés) | Universitario L1 | Solo la licencia: **BY-NC-SA** prohíbe el uso comercial de forma explícita. La traducción ya está hecha y verificada. |
| `book-5-jamb-myschool-lwp-es` | Español (traducido del inglés) | JAMB/UTME (`hard`) | Solo la licencia: el repo no declara ninguna y el contenido está scrapeado de un sitio comercial de terceros. Traducción hecha y verificada; los importes siguen en naira, a propósito. |

Traducir no es cosmético: una pregunta de examen en francés o en inglés no le sirve
a un estudiante que rinde en castellano, y el enunciado traducido tiene que conservar
la correspondencia con sus alternativas y con la clave impresa.

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

### Tercer intento sobre el mismo libro (`book-2-*`) — tampoco se escribió

El 2026-08-20 se volvió a pedir la extracción de este libro, ahora con el slug
`book-2-unmsm-historia`. **No se escribió ningún lote.** `lot-26-unmsm-historia-mcq` ya trae
las mismas 439 preguntas, con el mismo `sourceUrl`
(`…/blob/main/cuestionario.json`), el mismo mapa de capítulos a la taxonomía y las mismas 10
exclusiones (49, 66, 108, 147, 179, 287, 296, 325, 419, 438). Un `book-2-*` habría sido una
copia byte a byte del banco dentro de este mismo directorio. Es el mismo desenlace que el
`book-0-*` de `picuino/test`: **este libro está agotado, no volver a cosecharlo.**

Lo que sí aportó el intento fue una **re-verificación independiente de `lot-26`**, hecha desde
cero y sin mirar cómo se construyó:

- La tabla de claves se leyó **del PDF escaneado, no del `.txt`**: es la página 91 del libro
  (página 90 del PDF), rasterizada a 200 dpi y abierta a ojo. Las 449 filas impresas coinciden
  con `files/data_clean/claves.txt`; comprobadas fila a fila las diez columnas de cabecera
  (1 A, 46 E, 91 D, 136 A, 181 D, 226 D, 271 C, 316 A, 361 B, 406 D) y la última fila completa
  (45 D, 90 C, 135 E, 180 B, 225 B, 270 C, 315 A, 360 B, 405 C, 449 D).
- El reparseo independiente de la tabla da **449 claves, 0 discrepancias** contra el índice
  `answer` de `cuestionario.json`, 0 fuera de rango, 0 sin clave.
- La comprobación que de verdad importa —la del bug de las tres columnas— también se rehízo:
  se cruzó el **rótulo impreso** (`A)`…`E)` de `files/data_clean/cuestionario.txt`) con la
  tabla de claves y con el texto que `lot-26` marca como correcto. **438 de 438 verificables
  coinciden, 0 discrepancias.** La única no verificable es la 8, cuyo texto del libro no rinde
  las cinco alternativas rotuladas (el OCR dejó `O) Groenlandia` con la letra corrompida); su
  clave impresa es C y el lote marca «La Antártida», que es la hipótesis de Méndez Correa.

#### Cuatro preguntas de `lot-26` que hay que quitar antes de sembrar

> **OBSOLETO — resuelto el 2026-08-20.** Las cuatro ya están reparadas en el lote (ver
> «Verificación adversarial» al final de este archivo): las listas I–IV de 13, 357, 427 y 428
> se recuperaron **verbatim** de `files/data_clean/cuestionario.txt` del mismo repo, y la 65
> ya lleva `imagePath`. El filtro «alternativas romanas sin lista I–IV en el cuerpo» hoy
> devuelve **0 coincidencias** sobre las 439. Se conserva la tabla por trazabilidad.

No se tocó el lote —queda a criterio de quien lo siembre—, pero están localizadas y son
**defecto de la obra escaneada, no de la clave**:

| Pregunta | Capítulo | Problema |
| --- | --- | --- |
| 13 | POBLAMIENTO DE AMÉRICA | Las alternativas son `I y IV`, `I y III`… pero el OCR **nunca capturó la lista de enunciados I–IV**. Incontestable. |
| 357 | GUERRA CON CHILE | Pide «la secuencia correcta»; alternativas `II, I, III, IV`… y **la lista I–IV no está en el cuerpo**. Incontestable. |
| 427 | OCHENIO DE MANUEL A. ODRÍA | Igual: alternativas `II y IV`, `II y III`… **sin la lista I–IV**. Incontestable. |
| 65 | HORIZONTE MEDIO: TIAHUANACO | «Observe y analice la imagen representada en este vaso ceremonial…» — **depende de una figura que el lote no adjunta** (entra como pregunta de texto, sin `imagePath`). |

Es exactamente el mismo criterio con el que ya se descartaron las diez de 4 y 2 alternativas:
la obra no rinde la pregunta completa, así que se quita en vez de rellenarla. El filtro que las
detecta es «dos o más alternativas que son solo números romanos y ningún `I.`/`II.` en el
cuerpo», más las menciones a imagen/caricatura/gráfico. Bien sembradas serían 435, no 439.

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

## Re-cosecha del 2026-08-20 sobre `davidquicast/Corpus-Historia-Peru-…` — no se escribió lote nuevo

Se volvió a pedir la extracción de este mismo libro («Solucionario de Historia del Perú —
EL CACHIMBO», recopilación UNMSM ~1970-2020) con destino a un lote `book-1-*`. **No se
escribió**: `lot-26-unmsm-historia-mcq` ya cubre las 439 preguntas utilizables y un segundo
lote habría duplicado el banco. En su lugar se reverificó el lote existente desde cero y se
le corrigieron tres defectos reales.

Reverificación independiente (no se dio por buena la nota anterior):

- `files/data_clean/claves.txt` reparseada: **449/449 claves presentes**, ninguna ausente.
- Cruce clave impresa ↔ índice `answer` de `cuestionario.json`: **0 discrepancias en 449**.
- Cruce clave impresa ↔ alternativa marcada en el lote, leyendo las alternativas **por
  rótulo** (`A)`…`E)`) en `files/data_clean/cuestionario.txt`: **438/439 coinciden**; la
  restante (pregunta 8) no es verificable porque el texto solo rinde cuatro rótulos.
- Las 10 preguntas descartadas (49, 66, 108, 147, 179, 287, 296, 325, 419, 438) se
  comprobaron una a una: el libro imprime cuatro alternativas en nueve de ellas y dos en la
  66. El descarte era correcto.

Correcciones aplicadas al lote:

1. **9 enunciados venían truncados en origen.** `cuestionario.json` cortó el enunciado en la
   primera frase y perdió las listas de ítems romanos y las frases finales. Cuatro de ellas
   (13, 357, 427, 428) son del tipo «identifique la secuencia / establezca relaciones» y sin
   la lista de ítems **no se pueden responder**. Enunciados restaurados desde el texto
   impreso del propio libro (`cuestionario.txt`, tramo entre el número y el primer `A)`):
   preguntas **13, 48, 80, 130, 178, 215, 357, 427, 428**.
2. **2 preguntas dependen de una figura que el lote no traía** (quedaban como texto
   irresoluble). Recortadas del escaneo original `files/data_ocr/cuestionario.pdf` a 200 dpi
   y adjuntas como `imagePath`:
   - pregunta **65** (vaso ceremonial, HORIZONTE MEDIO: TIAHUANACO, pág. 7) →
     `lot-26-unmsm-historia-mcq-figures/q065-vaso-ceremonial.png`
   - pregunta **80** (orfebrería Lambayeque, pág. 9) →
     `lot-26-unmsm-historia-mcq-figures/q080-orfebreria-lambayeque.png`

   Ambos recortes contienen **solo la figura** —sin enunciado ni alternativas— comprobado
   abriendo los PNG. Las claves de ambas (B y C) salen de la tabla del libro y coinciden con
   el rótulo impreso en el escaneo.

Detalle del escaneo, por si alguien lo vuelve a tocar: **`cuestionario.pdf` NO tiene capa de
texto** (91 páginas, 2048×2908 pt, `pdftotext` devuelve 3 bytes). La capa de texto que sí
existe es la del OCR ya hecho por el repo (`files/data_clean/cuestionario.txt`). Para
localizar preguntas en el PDF hay que rasterizar a **200 dpi como mínimo**: a 100 dpi
tesseract falla en silencio en la mayoría de páginas. El libro está maquetado a dos columnas.

Queda sin corregir, y a la vista: la pregunta 13 imprime «aldeas primige**f**ías», errata del
OCR de origen. Se deja tal cual en vez de enmendarla a ojo.

| Lote | Libro | Repo | URL | Licencia citada literalmente | Preguntas | Fecha |
| --- | --- | --- | --- | --- | --- | --- |
| `lot-26-unmsm-historia-mcq` (revisión 2026-08-20, **sin lote nuevo**) | «Solucionario de Historia del Perú» / EL CACHIMBO — recopilación de exámenes de admisión UNMSM ~1970-2020 | `davidquicast/Corpus-Historia-Peru-ExamenAdmisionUNMSM-MultipleChoice` | https://raw.githubusercontent.com/davidquicast/Corpus-Historia-Peru-ExamenAdmisionUNMSM-MultipleChoice/main/cuestionario.json | El repo **no tiene archivo `LICENSE`** (la API `/license` responde 404). El front matter de `README.md` declara `license: apache-2.0`; **cada uno de los 449 registros** de `cuestionario.json` declara `"license": "Desconocida"` junto a `"source": "https://www.slideshare.net/slideshow/historia-del-per-recopilacin-ex-adm-unmsm/251464302"` | 439 (2 con figura) | 2026-08-20 |


## `book-4-qcm-exo7` — el QCM de Exo7, y por qué de 883 preguntas solo salen 170

`exo7math/qcm-exo7` es el banco de QCM que Exo7, Unisciel y la Université de Lille usan en
L1. No es material generado por IA: cada pregunta va firmada (`author: Arnaud Bodin, Abdellah
Hanani, Mohamed Mzari`, `Barnabé Croizat, Christine Sacré`, `Julien Worms`) y enlaza al
curso, al vídeo y a la hoja de ejercicios de Exo7 de los que sale.

**Formato y clave.** 25 archivos YAML en `questions-*/format-yaml/`, un documento por
pregunta. La clave viene publicada *dentro* de la pregunta: cada alternativa es un ítem con
`value:` y una bandera `correct: True|False` explícita, más `explanations:`. No hay tabla de
claves al final ni hace falta: no se dedujo ninguna respuesta. Los mismos contenidos existen
también en LaTeX y en `latex-moodle`; se leyó el YAML por ser la fuente estructurada.

**Conteo propio sobre los 25 YAML: 883 preguntas.** De ahí a 170 hay tres filtros, y los tres
descartan en vez de adivinar:

1. **644 son de respuesta múltiple** (dos, tres o cuatro `correct: True`). La tabla
   `questions` guarda **un** `correct_answer` y `validate-structured-content.ts` lo valida
   como índice único, así que una pregunta de respuesta múltiple no se puede representar sin
   inventarle una clave. Se descartan enteras. Quedan **239 con exactamente una correcta** —
   el mismo número que traía el descubrimiento.
2. **8 capítulos no tienen tema canónico de nivel preuniversitario**: ecuaciones
   diferenciales (×2), primitivas, integrales, desarrollos limitados, curvas paramétricas,
   espacios vectoriales y aplicaciones lineales, más la sección «Variables continues» del QCM
   de Worms. Meterlos a la fuerza en «Funciones» o «Matrices y Determinantes» envenenaría el
   filtro por tema de todos los exámenes que se generen después, así que se quedan fuera.
3. **El LaTeX se linealiza o se descarta.** El enunciado viene en LaTeX (`\(...\)`,
   `\frac`, `\Rr`, `\vec`…) y la columna `body_typst` guarda texto que el seeder escapa
   literal: dejar el LaTeX crudo imprimiría `\(d=3\)` en el examen. El conversor
   (`latex_text.py`, en el scratchpad) pasa a Unicode legible — `\frac{a}{b}` → `(a)/(b)`,
   `\sqrt{x}` → `√(x)`, `\Rr` → `ℝ`, `x^{p-1}` → `xᵖ⁻¹` — y **falla a propósito** ante
   cualquier macro que no conozca o ante cualquier construcción cuyo sentido viva en dos
   dimensiones (matrices, integrales, sumatorios, `array`, listas). 36 preguntas caen ahí y
   se descartan: un enunciado mal linealizado es peor que uno ausente.

Además se descartan 3 preguntas del QCM de Worms que se apoyan en una pregunta hermana
(«la question précédente»), 3 con alternativas que quedan idénticas tras convertir, y 8 cuyo
enunciado repite uno ya presente en el lote — son las del tipo «Quelles sont les assertions
vraies ?», con todo el contenido en las alternativas: el seeder deduplica por hash del
enunciado, así que esas 8 no llegarían a sembrarse igualmente y el recuento del lote sería
mentira.

**Dos cosas que hay que saber antes de sembrar esto:**

- **Las preguntas están en francés.** No se tradujeron: traducir el enunciado obligaría a
  reescribir la notación matemática y ahí es donde se corrompe. El texto es el de la obra,
  verbatim. Un banco preuniversitario peruano en castellano tiene que decidir aparte si esto
  le sirve tal cual o si pide traducción humana.
- **Es material de L1 (primer año de universidad), no de academia preuniversitaria.** Los
  capítulos que sí encajan —lógica, conjuntos, aritmética, complejos, polinomios, sucesiones,
  geometría analítica, matrices, probabilidades— encajan de verdad; pero el nivel es el de
  entrada a universidad francesa. Van todas con `difficulty: "hard"`.

**Reparto por curso y tema canónico** (170 entradas):

| Curso | Tema | N |
| --- | --- | --- |
| Álgebra | Lógica Proposicional y Teoría de Conjuntos | 56 |
| Álgebra | Funciones | 26 |
| Estadística y Probabilidades | Probabilidades | 20 |
| Aritmética | Números Primos, MCD y MCM | 15 |
| Trigonometría | Geometría Analítica: La Recta | 11 |
| Álgebra | Progresiones y Límites de Sucesiones | 9 |
| Álgebra | Números Complejos | 5 |
| Álgebra | Polinomios | 5 |
| Álgebra | Inecuaciones y Valor Absoluto | 5 |
| Geometría | Geometría del Espacio (Poliedros) | 5 |
| Álgebra | Matrices y Determinantes | 5 |
| Aritmética | Divisibilidad | 4 |
| Álgebra | Sistemas de Ecuaciones | 3 |
| Álgebra | Teoría de Exponentes y Logaritmos | 1 |

Dos asignaciones son un estiramiento y conviene revisarlas si alguien afina la taxonomía:
«Géométrie dans l'espace» (planos, distancias, producto vectorial) va a **Geometría del
Espacio (Poliedros)** porque es el único tema tridimensional del árbol, y el capítulo
«Ensembles, applications» aporta preguntas de composición de funciones que viven bajo
**Lógica Proposicional y Teoría de Conjuntos**.

**Imágenes: una sola.** Este libro es un corpus de texto —no hay PDF escaneado que recortar,
y los YAML no referencian ninguna figura. Las dos únicas figuras del repo (`\qimage`) están
en el QCM de Worms: `img-proba-02` cae en «Variables continues», descartada; `img-proba-01`
sí entra, en la pregunta 35 de «Variables discrètes» («¿cuál de estos es el grafo de la
función de repartición?»), y se copió a
`book-4-qcm-exo7-figures/img-proba-01.png`. Comprobado abriéndolo: contiene **solo los tres
grafos candidatos**, sin enunciado ni alternativas, que es exactamente lo que las
alternativas («Le premier / Le second / Le troisième») necesitan para tener sentido.

**Cómo se numeran las preguntas en `sourceName`.** El número es el **ordinal del documento
dentro del YAML de su capítulo** (o del `\begin{question}` dentro del `.tex`), no el
`Question N` correlativo que imprime el PDF compilado: ese corre seguido a lo largo de todo
el fascículo. Por eso «Géométrie du plan, pregunta 1» es la *Question 121* del
`qcm-lille-1-correc.pdf`. En el QCM de Worms sí coinciden, porque su `.tex` es un solo
fascículo. El capítulo va siempre en el `sourceName`, así que la referencia no es ambigua.

**Claves verificadas contra la obra** (se abrió el documento YAML/LaTeX crudo y se comparó
con lo cosechado; además se rasterizaron las páginas de los PDF `*-correc.pdf` que compila el
propio repo, donde cada alternativa lleva impreso `[Vrai]` o `[Faux]`, y coinciden una a
una):

| Capítulo, pregunta | Marcado `correct: True` / `\good{}` en la fuente | Clave cosechada | ¿Coincide? |
| --- | --- | --- | --- |
| Arithmétique, 48 (Fermat) | alternativa 2ª, `\(x^p \equiv x \;[p]\)` | índice `1` (clave B) | sí |
| Ensembles applications, 1 | alternativa 4ª, `\(A=\{1,-17\}\)` | índice `3` (clave D) | sí |
| Géométrie du plan, 1 | alternativa 3ª, `\(d=5\)` | índice `2` (clave C) | sí |
| Nombres complexes, 3 | alternativa 2ª, `\(z= \sqrt 2+i\sqrt 2\)` | índice `1` (clave B) | sí |
| Worms · Variables discrètes, 34 | 3ª, `\good{Toutes les valeurs de $]0,1/2[$.}` | índice `2` (clave C) | sí |
| Worms · Variables discrètes, 35 (figura) | 2ª, `\good{Le second.}` | índice `1` (clave B) | sí |

Un último detalle del conversor, por si alguien lo reutiliza: las llaves **literales** de la
notación de conjuntos (`\{1,2\}`) van aparcadas en dos codepoints privados durante toda la
conversión y se restauran al final. Sin eso, el paso que quita las llaves de *agrupación* de
LaTeX se llevaba también las de los conjuntos por delante y `{0,1,2}` se sembraba como
`0,1,2` — 669 apariciones en el corpus.

| Lote | Libro | Repo | URL | Licencia citada literalmente | Preguntas | Fecha |
| --- | --- | --- | --- | --- | --- | --- |
| `book-4-qcm-exo7` | *QCM de mathématiques* — Exo7 / Unisciel / Université de Lille (L1) | `exo7math/qcm-exo7` (commit `abbf5ca`) | https://github.com/exo7math/qcm-exo7 | Sin archivo `LICENSE`; GitHub API `license=null`. `README.md`, literal: «Les documents sont diffusés sous la licence *Creative Commons -- BY-NC-SA -- 4.0 FR*.» | 170 (1 con figura) | 2026-08-20 |

## Verificación adversarial del 2026-08-20 sobre `lot-26-unmsm-historia-mcq`

Revisión hecha intentando **refutar** el lote, no confirmarlo. Fuente de verdad: los archivos
del propio repo `files/data_clean/cuestionario.txt` (enunciados con rótulo `A)`…`E)` impreso)
y `files/data_clean/claves.txt` (tabla de claves del libro, 449 filas, 0 huecos). **No se usó
`cuestionario.json` como referencia**: ese array `options` es justamente el que arrastra el
bug de columnas ya documentado arriba.

**Resultado: el lote sobrevive. 439 entradas, 0 bajas.**

- **Claves: 439/439 correctas.** Para cada entrada se cruzó `correctAnswer` (índice 0-based)
  contra el texto que lleva la letra que imprime `claves.txt`. Cero discrepancias. Se verificó
  además que el índice `answer` de `cuestionario.json` coincide con la clave impresa en las 449.
- **Alternativas: 439/439 idénticas y en el orden impreso** (leídas por rótulo, no por posición).
- **Reordenamientos 154 y 447: confirmados correctos.** Se sospechó deducción de la respuesta;
  no lo es. El libro imprime esas dos en columnas (`A) D) B) E) C)`) y el lote las devuelve al
  orden alfabético impreso. Un barrido completo encontró **solo esas dos** con ese patrón.
- **Textos añadidos a 9 enunciados: confirmados verbatim.** Las listas I–IV y las coletillas que
  el lote tiene de más frente a `cuestionario.json` (13, 48, 80, 130, 178, 215, 357, 427, 428)
  están palabra por palabra en `files/data_clean/cuestionario.txt`, erratas de OCR incluidas
  («aldeas primigefías»). No hay texto inventado.
- **Imágenes: 2/2 correctas.** Abiertas y comparadas con las originales extraídas de
  `files/data_ocr/response.json`. `q065-vaso-ceremonial.png` = `img-4.jpeg` (kero wari,
  pregunta 65); `q080-orfebreria-lambayeque.png` = `img-5.jpeg` (tumi de oro, pregunta 80).
  Ambos recortes traen **solo la figura**: sin enunciado, sin alternativas, sin segunda pregunta.
- **Taxonomía: 0 violaciones.** Los 10 `topicName` usados existen literales bajo `Historia` en
  `canonical-taxonomy.json`. `gradeLevel: "pre"` y `difficulty: "hard"` en las 439.
- **0 enunciados vacíos, 0 alternativas vacías, 439 entradas con exactamente 5 alternativas.**
- **Origen: no es un banco sintético.** Es OCR de un impreso real (`cuestionario.pdf`, 62 MB)
  con tabla de claves impresa y etiquetas de examen (`UNMSM 2019-II`, `SM 2018-II`).

### Cuatro defectos encontrados y reparados

| Pregunta | Defecto | Reparación |
| --- | --- | --- |
| 11 | El cuerpo cortaba en «…son la de procedencia» y **perdía los tres nombres** (Hrdlicka, Rivet, Mendes Correia) a los que apuntan las alternativas. Incontestable. | Cuerpo restaurado verbatim desde `cuestionario.txt`. |
| 38 | Cortaba a media frase en «…al mando de». Faltaba «…, quien ordenó la destrucción de sus … para lograr sometería». | Restaurado; los dos `$\qquad$` del OCR se rinden como `______`. |
| 187 | Faltaba **la pregunta misma**: «El pago en trabajo recibía el nombre de:». Incontestable. | Restaurado verbatim. |
| 8 | La alternativa D llevaba pegado un rótulo corrupto: `"O) Groenlandia"`. | Normalizada a `"Groenlandia"`. La clave impresa (C, «La Antártida») no se toca. |

Las tres restauraciones salen del mismo repo y del mismo archivo canónico; **ninguna respuesta
fue deducida**.

### Dos defectos de la obra que se dejan tal cual

- **Pregunta 1**: el libro imprime dos alternativas byte a byte idénticas (`C)` y `D)` = «La
  tradición oral española.»). Es defecto del impreso/OCR, se transcribe fiel. No afecta la
  clave: A, «Los cronistas», es única.
- **Pregunta 106**: el lote omite la etiqueta de examen `(2013-1)` que va al final del
  enunciado. Es limpieza deliberada, no pérdida de contenido.

### Pendiente menor, no bloqueante

Varios `topicName` son **taxonómicamente válidos pero temáticamente flojos** —la pregunta 1,
sobre la captura de Atahualpa, entra como «Prehistoria y comunidad primitiva» porque el
capítulo del libro es «CONCEPTOS GENERALES DE HISTORIA». Sirve para sembrar; conviene afinar
el mapa capítulo→tema si alguien revisa la taxonomía.

---

## scan-12-unac-2022-i-image → `unverified-unac/` (emparejamiento falso)

Lote UNAC "Examen General de Admisión 2022-I, Bloque III" (70 preguntas-imagen,
`Bloque-iii-2022-i.pdf`). Los recortes están bien; la **clave registrada no corresponde a este
examen**. Verificación independiente resolviendo las preguntas a mano: **0 aciertos de 14**
(el azar sobre 5 opciones daría ~20%).

| Preg. | Resuelto | Registrado | Razón |
|---|---|---|---|
| 1 | A (5) | b | Último dígito del período de `ab/7938`, `ab` impar: (10^126−1)/3969 ≡ 1 mód 10 ⇒ dígito = 5·ab mód 10 = 5 |
| 2 | E (60) | b | J:L = 5:4, L:A = 3:2 ⇒ J:L:A = 15:12:8; 140/35 = 4 ⇒ José = 60 |
| 3 | B (7/12) | d | P(par) = 1/12, P(impar) = 3/12; primos 2,3,5 ⇒ 1/12+3/12+3/12 = 7/12 |
| 4 | E (60) | b | 3/(x−3) > 1/3 ⇒ 3 < x < 12; suma 4+…+11 = 60 |
| 5 | C (se octuplica) | e | A = k/B³, C = m/B²; C×4 ⇒ B/2 ⇒ A×8 |
| 6 | A (18) | e | T = 0,4V; 0,5V − 0,7T = 33 ⇒ V = 150, T = 60; vendidos = 0,3·60 = 18 |
| 7 | B (15120) | a | C·(1+0,08·10/12) = 14400 ⇒ C = 13500; 18 meses ⇒ 13500·1,12 = 15120 |
| 8 | B | d | Elemento = un enfermo; variable = diagnóstico; cualitativa |
| 10 | A (−3) | c | Num = a³+b³+2 = −3(1+ab(a+b)); Den = ab(a+b)+1 ⇒ M = −3 |
| 19 | D (FVV) | c | I falsa (compartir electrones = enlace covalente); II y III verdaderas |
| 21 | E (solo III) | a | Isótopos: mismo elemento, mismos protones, distinto número de masa |
| 24 | B (NaHCO₃) | e | Bicarbonato de sodio |
| 55 | D (10) | b | 2x+5y = 75, 5(x+y) = 105 ⇒ x+y = 21 ⇒ 3x = 30 ⇒ x = 10 |
| 66 | B (Ejecutivo − Legislativo) | d | El Decreto Legislativo lo dicta el Ejecutivo por delegación del Congreso |

El clavijero usado en la cosecha pertenece a otro bloque/año. **Ninguna clave fue deducida ni
corregida**: el defecto es del emparejamiento examen↔clavijero, no de las preguntas. El recorte
se conserva aquí; ningún seeder lee este directorio.

## scan-3-unac-2021-i-image — emparejamiento falso (movido a `unverified-unac/`)

El lote (40 preguntas-imagen, atribuidas al «Examen Especial de Admisión por Otras
Modalidades 2021-I» de la UNAC, `examen-otras-modalidades-OK.pdf`) trae recortes limpios y
legibles, pero la clave registrada NO corresponde a este examen: resolví 13 preguntas
inequívocas y solo 1 coincidió (7.7 %, por debajo del 20 % que da el azar sobre 5 opciones).
Evidencia: P2 (edades, relación 7:9 → 5:6) da 18 = C y el lote registra A; P3 (mes con 5
sábados, 5 domingos y 5 lunes → mes de 31 días que empieza sábado, día 20 = jueves) da B y el
lote registra E; P4 (subconjuntos de 6 cremas, 2^6) da 64 = B y el lote registra E; P5 (áreas
DEC = ABDE → AE = 6/7) da C y el lote registra B; P10 (11 goles → 12 marcadores) da E y el
lote registra B; P11 (pierde 1/3, luego 1/5, luego 3/4; queda 60) da 450 = D y el lote
registra A; P12 (edad: x = 2a−2b → dentro de 2b años, 2a) da B y el lote registra D; P14
(producto excede en 662 a la suma → enamorado 18, cifra de decenas 1) da C y el lote registra
B; P17 (meses vividos − años = 467 → 42 años 5 meses en julio → nace en febrero) da D y el
lote registra B; P20 (hexágono regular de sección del cubo, 27√3 → arista 6 → volumen 216) da
E y el lote registra B; P39 («contaminación ambiental natural» → incendio forestal, E) y el
lote registra B, que es una causa antropogénica; P40 (convivencia como principio ético, D) y
el lote registra C («Es un fascista»), que no es clave de examen. Único acierto: P15
(2/7 + 1/3 de la edad entero y > 38, edad < 65 → 63 = B), compatible con el azar.
Conclusión: el clavijero usado pertenece a otro examen/bloque de la UNAC. Los recortes se
conservan aquí, sin sembrar, por si aparece el clavijero correcto.

## scan-10-unac-2022-i-image — emparejamiento falso (movido a `unverified-unac/`)

El lote (70 preguntas-imagen, atribuidas al «Examen General de Admisión 2022-I, Bloque I:
Ciencias e Ingenierías» de la UNAC, `Bloque-i-2022-i.pdf`) trae recortes limpios y legibles,
pero la clave registrada NO corresponde a este examen: resolví 12 preguntas inequívocas y solo
1 coincidió (8.3 %, por debajo del 20 % que da el azar sobre 5 opciones).
Evidencia: P5 (entre 400 y 600, divisible por 49 y 35 → 490; muertos 150, heridos 322 → ilesos
18) da E y el lote registra C; P6 (residuo mod 13 de `u1n5a5c` a partir del de `1u9n6a6c`;
pesos 1,−3,−4,−1,3,4 → 8 − 16 ≡ 5) da D y el lote registra C; P7 (13!/6306300 = 2^8·3^3/7 →
periodo de 1/7) da 6 = E y el lote registra D; P8 (S/ 5000 al 20 % capitalizable semestral, 18
meses = 3 semestres al 10 % → 5000·1,1^3) da 6655 = D y el lote registra A; P31 (c = 1050 J /
(0,525 kg · 10 °C)) da 200 J/kg°C = D y el lote registra B; P35 (a = bc²/d con a velocidad, b
masa, d fuerza → c² = L²T⁻³) da B y el lote registra E; P39 (configuración de 18 electrones;
la única especie que no la tiene es ₁₆S⁺² con 14) da D y el lote registra E; P40 (isótopos:
J/X comparten Z = 15 y T/Z comparten Z = 38 → el sin par es ₁₆R) da E y el lote registra B;
P42 (hidrácidos = H₂S, HCl, H₂Te, HI → II, IV, V y VI) da B y el lote registra A, que omite dos;
P58 (30 t − 20 % = 24 000 kg; 14 400 · 1,25 = 18 000 → 18 000/24 000) da 0,75 = D y el lote
registra B; P60 (mcd(168,108) = 12; solo el lado 2 cm agota el alambre en hexágonos completos:
138 varillas = 23 hexágonos y 83 + 53 = 136 cortes → 159) da D y el lote registra C. Único
acierto: P2 (aumento m %, descuento del 25 % del costo, ganancia 20 % del precio de venta →
1 + m/100 = 1,5 → m = 50 = B), compatible con el azar.
**Ninguna clave fue deducida ni corregida**: el defecto es del emparejamiento examen↔clavijero,
no de las preguntas. Ojo: en los PDF de la UNAC el nombre de archivo, la portada y el cuerpo se
contradicen entre sí, así que el clavijero usado bien puede pertenecer a otro bloque del mismo
año. Los recortes se conservan aquí, sin sembrar; ningún seeder lee este directorio.

## scan-21-unac-2022-ii-image — emparejamiento falso (movido a `unverified-unac/`)

Lote de 70 preguntas-imagen recortadas de
`https://admision.unac.edu.pe/wp-content/uploads/2026/03/examen-pre-22%C2%B7II-B.I.pdf`
(Cuarto Examen 2022-II, Bloque I según el nombre de archivo). **Los recortes están bien; la
clave registrada no corresponde a este examen.** Resolví 15 preguntas de respuesta inequívoca
y solo 2 coincidieron (13,3 %, dentro del ruido del 20 % que da el azar sobre 5 opciones).

Evidencia (correcta → registrada):
- P1: 63!/65! = 1/4160 = 1/(2⁶·5·13); parte no periódica = 6 cifras, periodo = ord₁₃(10) = 6 →
  suma 12 = **C**, el lote registra B.
- P2: `bac` = 9̊ obliga a a+b+c ≡ 0 mod 9 y la única opción múltiplo de 9 es 18; se realiza con
  693/396/963 → **C**, el lote registra E.
- P3: 48·30·8 = 11520 → 4m y 32·1,25·12·10 = 4800 → 3n ⟹ m/n = 9/5 = **E**, el lote registra C.
- P4: 9000 − 8·9·9·9 = 9000 − 5832 = 3168 = **B**, el lote registra A.
- P5: Σhi = 15/k = 1 → k = 15; la clase [1100;1400⟩ tiene fi = 9k = 135 = **B**, el lote
  registra E.
- P6: X√Z/(P²V³) = 3 ⟹ a = 120, b = 3 → a+b = 123 = **E**, coincide (único acierto junto a P43).
- P28: (7π/ab)rad = 1260/ab grados ⟹ N² − N − 1260 = 0 → ab = 36; 36° = π/5 = **B**, el lote
  registra C.
- P29: S₁/S₂ = (π/180)/(π/200) = 10/9 = **C**, el lote registra E.
- P39: I y III verdaderas, II falsa (el protón es positivo) → **D**, el lote registra E.
- P40: catión de Fe(OH)₃ es Fe³⁺ y el oxianión de HNO₃ es NO₃⁻ → Fe(NO₃)₃ = **E**, el lote
  registra D.
- P41: Ti²⁺ = [Ar]3d² (I ok), Ti neutro tiene 2 electrones desapareados → paramagnético (II
  falsa), radio atómico > radio del catión (III ok) → **C**, el lote registra A.
- P42: n = PV/RT = 0,82·50/(0,082·300) = 1,67 mol = **B**, el lote registra A.
- P43: N se oxida (−3 → +5), H₂SO₄ es el agente **oxidante** (II falsa) y al balancear
  3NH₃ + 4H₂SO₄ → 4S + 3HNO₃ + 7H₂O el agua lleva 7 → I y III = **C**, coincide (segundo y
  último acierto).
- P57: en 30 años la suma será 84 ⟹ hoy suman 24; el hijo es recién nacido (0) → madre 24 =
  **B**, el lote registra E.
- P60: v₂(v₂−2) = 224 → v₂ = 16, v₁ = 14 km/h = **B**, el lote registra D.

Los dos aciertos (P6, P43) no forman patrón: no hay desplazamiento constante entre la clave
correcta y la registrada, así que no es un corrimiento de índices reparable — es otro clavijero.
**Ninguna clave fue deducida ni corregida**: el defecto es del emparejamiento examen↔clavijero,
no de las preguntas. Como en los demás lotes de la UNAC, el nombre de archivo, la portada y el
cuerpo del PDF se contradicen entre sí, así que el clavijero usado bien puede pertenecer a otro
bloque del mismo año. Los recortes se conservan aquí, sin sembrar; ningún seeder lee este
directorio.
