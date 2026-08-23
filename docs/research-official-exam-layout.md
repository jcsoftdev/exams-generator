# Research — cómo están organizados los exámenes oficiales (UNI, UNCP)

**Fecha:** 2026-08-23
**Motivo:** el PDF que genera la app no respeta la maqueta de los exámenes oficiales.
**Cache:** `web-research` slugs `peru-university-admissions/uni-exam-paper-layout` y `peru-university-admissions/uncp-exam-paper-layout`.

---

## 1. UNI — evidencia primaria

Fuente: solucionario oficial UNI 2021-1 (`admision.uni.edu.pe/.../solucionario2021.pdf`). Los capítulos
"ENUNCIADOS DE LA … PRUEBA" reproducen el cuadernillo real, así que los rangos de abajo salen del
documento oficial, no de una academia.

### Tres pruebas, días separados, no eliminatorias

| Prueba | Nombre oficial               | Puntaje |
| ------ | ---------------------------- | ------- |
| E1     | Aptitud Académica y Humanidades | 745  |
| E2     | Matemática                   | 600     |
| E3     | Física y Química             | 500     |
|        | **Total**                    | **1845** (= 20 vigesimal) |

### Bloques y rangos de numeración medidos en 2021-1

**E1 — 35 preguntas, numeración corrida 1–35**

| Bloque                  | Preguntas |
| ----------------------- | --------- |
| Razonamiento Matemático | 1–12      |
| Razonamiento Verbal     | 13–25     |
| Humanidades             | 26–35     |

**E2 — 20 preguntas, numeración corrida 1–20**

| Bloque        | Preguntas |
| ------------- | --------- |
| Aritmética    | 1–5       |
| Álgebra       | 6–9       |
| Geometría     | 10–14     |
| Trigonometría | 15–20     |

**E3 — 20 preguntas, numeración corrida 1–20**

| Bloque  | Preguntas |
| ------- | --------- |
| Física  | 1–10      |
| Química | 11–20     |

### Reglas de maquetación (lo que hay que copiar)

1. **Bloques contiguos por curso.** Los cursos nunca se intercalan.
2. **Encabezado de sección** antes de cada bloque, con el nombre del curso en mayúsculas.
3. **Numeración corrida dentro de la prueba** (1..N). No reinicia por curso; sí reinicia en cada prueba.
4. **Orden de cursos fijo**, el mismo del temario oficial: RM → RV → Humanidades; Aritmética → Álgebra →
   Geometría → Trigonometría; Física → Química. No es aleatorio.
5. **5 alternativas A)–E)**, en una sola línea cuando son cortas.
6. Pie de página que identifica el examen ("Prueba Admisión UNI 2021-1") + número de página.

### Volumen por convocatoria (varía; la maqueta no)

- 2025-2: E1 = 100 preguntas / 180 min → RM 32 + RV 32 + Humanidades 36.
- 2026: prensa reporta ~60 preguntas por examen. El reglamento **no** publica desglose por curso, solo
  puntaje por sección — coherente con lo que ya asumía el diseño de plantillas (`weight_points` primario).

---

## 2. UNCP — evidencia

Fuente: Anexo 4 del prospecto (`uncpadmision.edu.pe/.../TEMARIO-PARA-EL-EXAMEN.pdf`) + comunicados
oficiales UNCP 2026.

- **Examen único** (no 3 días), **80 preguntas**, 3 horas. Antes eran 50 / 02:10 h.
- Puntaje total ponderado; se eliminó la escala vigesimal y el 10.5 mínimo.
- **5 áreas por carrera**, cada una con su propio cuadernillo y su propio reparto por curso.
- **64% conocimientos / 36% aptitudes.** Las aptitudes se aplican a todos los programas; solo los
  conocimientos cambian por área.
- Inglés fue retirado del prospecto en 2026 (el Anexo 4 todavía lo lista — la fuente de temario va
  por detrás del reglamento).

### Jerarquía de organización: dos niveles, no uno

```
ÁREA CURRICULAR : MATEMÁTICA
    ARITMÉTICA / ÁLGEBRA / GEOMETRÍA / TRIGONOMETRÍA
ÁREA CURRICULAR : CIENCIA Y TECNOLOGÍA
    FÍSICA / QUÍMICA / BIOLOGÍA
ÁREA CURRICULAR : ... (Comunicación, Desarrollo Personal, Economía, ...)

PREGUNTAS DE APTITUDES
    APTITUD COMUNICATIVA / APTITUD LÓGICO MATEMÁTICO
```

UNCP agrupa por **Área Curricular → Curso**, y el bloque de aptitudes es sección propia, separada de
conocimientos. El conteo real por bloque ya lo tenemos: es el Anexo 7 (Nº de preguntas por curso y por
NIVEL P.B./P.I./P.A.), ya extraído en la plantilla UNCP.

### No confirmado

Los rangos exactos de numeración del cuadernillo UNCP (los exámenes reales están tras paywall en
Scribd/Studocu). Lo más probable, por ser examen único, es numeración corrida 1–80.

---

## 3. Qué hace hoy nuestro generador (la brecha)

| Aspecto | Oficial | Nuestro PDF hoy |
| --- | --- | --- |
| Agrupación | Bloques contiguos por curso | Ninguna — mezcla global |
| Encabezado de sección | Sí, por curso | No existe |
| Orden de cursos | Fijo, el del temario | Aleatorio |
| Numeración | Corrida dentro de la prueba | Corrida 1..N sobre la mezcla |
| Secciones/pruebas (E1/E2/E3) | Documentos separados | Un solo documento |
| Cabecera | Identificación + instrucciones + tiempo | Solo `título — versión` |

Evidencia en código:

- `apps/api/src/modules/exams/domain/version-shuffler.ts:105` — `shuffleArray(questionIds, rng)` permuta
  **todas** las preguntas del examen sin agrupar por curso. Los cursos quedan intercalados al azar.
- `apps/api/src/modules/exams/adapters/pdf/typst-template.ts:21` — `input.questions.map(...)` renderiza
  una lista plana `1..N`, sin encabezados de sección, en dos columnas.
- `apps/api/src/db/schema/exam-blueprint-template-rows.schema.ts` — `exam_section` existe pero está
  documentado como "purely descriptive"; nadie lo lee al renderizar. **No hay columna de orden**
  (`sort_order`) ni en las filas de plantilla ni en el blueprint del examen, así que hoy no existe la
  información para reproducir el orden oficial de cursos.

## 4. Implicaciones de diseño (no implementado aún)

1. El shuffle tiene que ser **intra-bloque**, no global: barajar preguntas dentro de cada curso y barajar
   alternativas, pero mantener los bloques de curso en su orden canónico. Es lo único que preserva a la
   vez la anti-copia y la fidelidad al examen real.
2. Hace falta persistir el **orden canónico de cursos** por plantilla (`sort_order` en
   `exam_blueprint_template_rows`, o un catálogo de orden por universidad). Sin eso el orden oficial no
   es reproducible.
3. UNI necesita el concepto de **prueba/sección de nivel superior** (E1/E2/E3) con numeración que
   reinicia; UNCP necesita **Área Curricular → Curso** con numeración corrida. Un solo modelo de
   "secciones anidadas con política de numeración" cubre ambos.
4. `exam_section` deja de ser decorativo y pasa a ser dato de renderizado.
