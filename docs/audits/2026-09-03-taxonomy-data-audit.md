# Auditoría de datos — taxonomía (cursos y temas)

**Fecha:** 2026-09-03
**Disparador:** el usuario ve "Matemática" y otros temas repetidos en prod, ahora muy visibles en el árbol de carpetas.
**Fuente:** DB local sembrada con el mismo `seed.ts` que corre prod en cada deploy (`docker-compose.dokploy.yml:131`: `migrate && seed && main`). El seed es idempotente, así que prod tiene exactamente esta forma.

## Hallazgos

| # | Hallazgo | Medida | Severidad |
|---|---|---|---|
| 1 | Un tema existe como una fila POR GRADO. `topics` es único por `(course_id, name, grade_level)`, así que "Fracciones, decimales y porcentajes" son 2 filas, "Patrones y secuencias" son 6. | 953 filas de temas para 626 nombres distintos; 182 nombres repetidos afectan 510 filas (escuela 256 filas / 81 nombres, colegio 273 / 120, preuni 424 / 425). | Alta |
| 2 | La mayoría de esas copias por grado están vacías. | De 182 nombres repetidos: 71 no tienen preguntas en ninguna copia, 30 usan una sola copia, 51 usan dos; solo 6 usan cuatro o cinco. | Alta |
| 3 | El grado de la pregunta ya vive en `questions.grade_level`; la copia del tema no aporta información. | 66 943 de 67 029 preguntas tienen el mismo grado que su tema; las 86 que difieren son preuni. | Media |
| 4 | Cursos con el mismo nombre en etapas distintas (Matemática, Comunicación x3, Arte y Cultura...). Es correcto por currículo, pero en el árbol de carpetas se ve como duplicado. | 7 nombres de curso repetidos entre etapas; preuni además parte Matemática en 27 cursos (Aritmética, Álgebra, Geometría, Trigonometría...). | Baja (modelo) / Media (UX) |
| 5 | Temas con el mismo nombre en cursos distintos (Fracciones en Matemática escuela y colegio; Literatura peruana en dos cursos; Reacciones químicas...). | 12+ nombres normalizados en 2 cursos. Solapamiento real del currículo, no error. | Baja |
| 6 | `subtopics` no se usa. | 0 de 67 029 preguntas con `subtopic_id`. | Baja |
| 7 | El banco central está volcado en preuni. | preuni 66 219 preguntas, colegio 667, escuela 143. | Info |
| 8 | Consecuencia en carpetas: la siembra crea una carpeta por fila de tema, con sufijo de grado. | ~1 000 carpetas por colegio, 510 de ellas copias por grado. | Alta (UX) |

## Causa raíz

El modelo confunde "tema" con "tema en un grado". Un tema del currículo (concepto) se repite como fila por cada grado en el que se dicta, y las preguntas apuntan a la copia del grado. Como la pregunta ya guarda su grado, la copia es redundante: solo multiplica selects, árboles y carpetas.

## Propuesta

**Opción A (recomendada): un tema por concepto, grados como atributo.**
- `topics` único por `(course_id, name)`. Tabla nueva `topic_grades(topic_id, grade_level)` con los grados en que se dicta.
- Migración de datos: por cada grupo `(course_id, name)` se conserva una fila canónica, se re-apuntan `questions.topic_id`, `question_folders.topic_id` y cualquier otra FK a la canónica, y las copias se borran. `questions.grade_level` no cambia.
- Seed y `canonical-taxonomy.json` pasan a declarar grados como lista.
- API: `GET /topics?gradeLevel=` filtra por `topic_grades`. Los selects de Curso/Tema en la web dejan de mostrar copias. La siembra de carpetas crea una carpeta por tema, sin sufijo de grado (los sufijos existentes se renombran en la migración).
- Resultado: 953 → 626 temas; ~1 000 → ~670 carpetas por colegio.

**Opción B: mantener el modelo y ocultar la duplicación en la UI.**
- Agrupar copias por nombre en selects y carpetas (`folder_topics` con varios `topic_id`).
- Barato a corto plazo, pero la deuda queda y cada consumidor nuevo vuelve a tropezar.

**Fuera de esta decisión:** los cursos repetidos entre etapas (hallazgo 4) son correctos; lo que se puede mejorar es la etiqueta en el árbol (ya cuelgan de Escuela/Colegio/Preuniversitario). Los solapamientos entre cursos (hallazgo 5) son currículo real.
