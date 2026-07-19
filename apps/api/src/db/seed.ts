import { Role } from "@exams-generator/shared";
import { and, eq, isNull } from "drizzle-orm";
import { GRADE_LEVELS } from "../modules/exams/domain/value-objects/grade-level";
import type { GradeLevel, Stage } from "../modules/exams/domain/value-objects/grade-level";
import { hashPassword } from "../modules/auth/password.util";
import { db, pool } from "./client";
import { courses, gradeLevels, tenants, topics, users } from "./schema";

/**
 * Known demo password for the seeded school-admin account, so a human (or a
 * smoke check) can actually log in through `POST /auth/login`. Seed/demo data
 * only — never a real credential.
 */
const DEMO_ADMIN_PASSWORD = "demo-password-123";

/**
 * One syllabus topic. `grades` lists every grade level where the theme is
 * assessed; the seed writes one `topics` row per grade. Omit `grades` for a
 * whole-stage topic (used by preuniversitario, whose single grade is `pre`).
 */
interface SyllabusTopic {
  readonly name: string;
  readonly grades?: readonly GradeLevel[];
}

interface SyllabusCourse {
  readonly name: string;
  readonly topics: readonly SyllabusTopic[];
}

/**
 * ESCUELA (primaria) — áreas curriculares del CNEB (MINEDU), vigente 2026, con
 * temas concretos etiquetados con los grados de primaria donde se evalúan.
 */
const ESCUELA_SYLLABUS: readonly SyllabusCourse[] = [
  {
    name: "Matemática",
    topics: [
      { name: "Números hasta el 20", grades: ["primaria_1"] },
      { name: "Números hasta el 100", grades: ["primaria_1", "primaria_2"] },
      { name: "Números hasta 10 000", grades: ["primaria_2", "primaria_3", "primaria_4"] },
      { name: "Números hasta 100 000 y valor posicional", grades: ["primaria_5", "primaria_6"] },
      { name: "Suma y resta (sin y con canje)", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "Multiplicación: tablas y algoritmo", grades: ["primaria_2", "primaria_3", "primaria_4"] },
      { name: "División exacta e inexacta", grades: ["primaria_3", "primaria_4", "primaria_5"] },
      { name: "Fracciones", grades: ["primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "Números decimales y porcentajes", grades: ["primaria_5", "primaria_6"] },
      { name: "Figuras y cuerpos geométricos", grades: ["primaria_1", "primaria_2", "primaria_3", "primaria_4", "primaria_5"] },
      { name: "Perímetro, área y volumen", grades: ["primaria_4", "primaria_5", "primaria_6"] },
      { name: "Medidas de longitud, peso, capacidad, tiempo y dinero", grades: ["primaria_1", "primaria_2", "primaria_3", "primaria_4"] },
      { name: "Patrones y secuencias", grades: ["primaria_1", "primaria_2", "primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "Gráficos, tablas, estadística y probabilidad", grades: ["primaria_2", "primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
    ],
  },
  {
    name: "Comunicación",
    topics: [
      { name: "El abecedario, trazo de letras y conciencia fonológica", grades: ["primaria_1"] },
      { name: "Comprensión lectora literal", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "Comprensión lectora inferencial y crítica", grades: ["primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "Producción de textos narrativos", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "Producción de textos descriptivos e informativos", grades: ["primaria_3", "primaria_4", "primaria_5"] },
      { name: "Producción de textos argumentativos", grades: ["primaria_5", "primaria_6"] },
      { name: "Comunicación oral: diálogo y exposición", grades: ["primaria_1", "primaria_2", "primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "Sustantivo, adjetivo y verbo", grades: ["primaria_2", "primaria_3", "primaria_4"] },
      { name: "Categorías gramaticales (pronombre, adverbio, preposición)", grades: ["primaria_4", "primaria_5", "primaria_6"] },
      { name: "Sujeto y predicado", grades: ["primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "Acentuación y tildación", grades: ["primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "Signos de puntuación y ortografía básica", grades: ["primaria_2", "primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "Sinónimos, antónimos y familia de palabras", grades: ["primaria_2", "primaria_3", "primaria_4"] },
      { name: "Conectores textuales", grades: ["primaria_4", "primaria_5", "primaria_6"] },
    ],
  },
  {
    name: "Ciencia y Tecnología",
    topics: [
      { name: "Los seres vivos: características y clasificación", grades: ["primaria_1", "primaria_2"] },
      { name: "Las plantas: partes y funciones", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "Los animales y sus hábitats", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "El cuerpo humano: órganos de los sentidos", grades: ["primaria_1", "primaria_2"] },
      { name: "Sistemas del cuerpo humano (digestivo, respiratorio, circulatorio)", grades: ["primaria_3", "primaria_4", "primaria_5"] },
      { name: "Los estados de la materia", grades: ["primaria_2", "primaria_3", "primaria_4"] },
      { name: "Mezclas y cambios de la materia", grades: ["primaria_4", "primaria_5", "primaria_6"] },
      { name: "Fuerza, movimiento y energía", grades: ["primaria_4", "primaria_5", "primaria_6"] },
      { name: "La luz, el sonido y el calor", grades: ["primaria_3", "primaria_4", "primaria_5"] },
      { name: "El método científico y la experimentación", grades: ["primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "El ecosistema y las cadenas alimenticias", grades: ["primaria_4", "primaria_5", "primaria_6"] },
      { name: "Cuidado del ambiente y reciclaje", grades: ["primaria_1", "primaria_2", "primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "El sistema solar y los astros", grades: ["primaria_3", "primaria_4", "primaria_5"] },
      { name: "Diseño y construcción de prototipos tecnológicos", grades: ["primaria_4", "primaria_5", "primaria_6"] },
    ],
  },
  {
    name: "Personal Social",
    topics: [
      { name: "Mi identidad y mi familia", grades: ["primaria_1", "primaria_2"] },
      { name: "Normas de convivencia en el aula y la escuela", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "Derechos y deberes del niño", grades: ["primaria_2", "primaria_3", "primaria_4"] },
      { name: "Instituciones y autoridades locales", grades: ["primaria_3", "primaria_4"] },
      { name: "Símbolos patrios y la nación peruana", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "Culturas prehispánicas y el Tahuantinsuyo", grades: ["primaria_4", "primaria_5"] },
      { name: "La conquista y el virreinato del Perú", grades: ["primaria_5", "primaria_6"] },
      { name: "La independencia del Perú", grades: ["primaria_5", "primaria_6"] },
      { name: "El Perú republicano", grades: ["primaria_6"] },
      { name: "Las regiones naturales del Perú (costa, sierra, selva)", grades: ["primaria_2", "primaria_3", "primaria_4"] },
      { name: "Departamentos y regiones del Perú (geografía)", grades: ["primaria_4", "primaria_5", "primaria_6"] },
      { name: "Recursos naturales y actividades económicas", grades: ["primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "El dinero, el ahorro y el consumo responsable", grades: ["primaria_2", "primaria_3", "primaria_4", "primaria_5"] },
      { name: "La democracia y la participación ciudadana", grades: ["primaria_5", "primaria_6"] },
    ],
  },
  {
    name: "Arte y Cultura",
    topics: [
      { name: "Elementos del lenguaje visual (color, forma, línea)", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "Dibujo, pintura y collage", grades: ["primaria_1", "primaria_2", "primaria_3", "primaria_4"] },
      { name: "Música: ritmo, sonido e instrumentos", grades: ["primaria_1", "primaria_2", "primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "Danzas y música tradicional del Perú", grades: ["primaria_2", "primaria_3", "primaria_4", "primaria_5"] },
      { name: "Teatro y expresión corporal", grades: ["primaria_3", "primaria_4", "primaria_5"] },
      { name: "Apreciación y análisis de obras artísticas", grades: ["primaria_5", "primaria_6"] },
    ],
  },
  {
    name: "Educación Física",
    topics: [
      { name: "Esquema corporal y coordinación motriz", grades: ["primaria_1", "primaria_2"] },
      { name: "Habilidades motrices básicas (correr, saltar, lanzar)", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "Juegos predeportivos", grades: ["primaria_2", "primaria_3", "primaria_4"] },
      { name: "Deportes de conjunto (fútbol, vóley, básquet)", grades: ["primaria_4", "primaria_5", "primaria_6"] },
      { name: "Capacidades físicas (fuerza, velocidad, resistencia)", grades: ["primaria_4", "primaria_5", "primaria_6"] },
      { name: "Higiene, nutrición y vida saludable", grades: ["primaria_1", "primaria_2", "primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
    ],
  },
  {
    name: "Educación Religiosa",
    topics: [
      { name: "Dios creador y la creación", grades: ["primaria_1", "primaria_2"] },
      { name: "La familia de Jesús y la Sagrada Familia", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "Vida y enseñanzas de Jesús", grades: ["primaria_2", "primaria_3", "primaria_4"] },
      { name: "Los sacramentos", grades: ["primaria_3", "primaria_4", "primaria_5"] },
      { name: "Valores cristianos y la convivencia fraterna", grades: ["primaria_1", "primaria_2", "primaria_3", "primaria_4", "primaria_5", "primaria_6"] },
      { name: "La Biblia: Antiguo y Nuevo Testamento", grades: ["primaria_4", "primaria_5", "primaria_6"] },
    ],
  },
  {
    name: "Inglés como Lengua Extranjera",
    topics: [
      { name: "Saludos y presentaciones (greetings)", grades: ["primaria_1", "primaria_2"] },
      { name: "Vocabulario básico: colores, números y familia", grades: ["primaria_1", "primaria_2", "primaria_3"] },
      { name: "Verb to be y pronombres personales", grades: ["primaria_2", "primaria_3", "primaria_4"] },
      { name: "Presente simple (rutinas diarias)", grades: ["primaria_3", "primaria_4", "primaria_5"] },
      { name: "Vocabulario temático (animales, comida, escuela)", grades: ["primaria_1", "primaria_2", "primaria_3", "primaria_4"] },
      { name: "Comprensión de textos cortos y diálogos", grades: ["primaria_4", "primaria_5", "primaria_6"] },
      { name: "Preposiciones y estructuras there is / there are", grades: ["primaria_4", "primaria_5", "primaria_6"] },
    ],
  },
];

/**
 * COLEGIO (secundaria) — áreas curriculares del CNEB, con temas concretos
 * etiquetados con los grados de secundaria donde se evalúan.
 */
const COLEGIO_SYLLABUS: readonly SyllabusCourse[] = [
  {
    name: "Matemática",
    topics: [
      { name: "Números enteros y operaciones", grades: ["secundaria_1"] },
      { name: "Fracciones, decimales y porcentajes", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Razones, proporciones y regla de tres", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Potenciación, radicación y notación científica", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Ecuaciones e inecuaciones de primer grado", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Productos notables y factorización", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Ecuaciones cuadráticas", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Funciones: lineal, afín y cuadrática", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Sistemas de ecuaciones lineales", grades: ["secundaria_2", "secundaria_3", "secundaria_4"] },
      { name: "Trigonometría: razones e identidades", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Funciones exponenciales y logarítmicas", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Geometría plana: perímetros, áreas y polígonos", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Geometría del espacio: sólidos y volúmenes", grades: ["secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Semejanza, congruencia y teorema de Pitágoras", grades: ["secundaria_2", "secundaria_3", "secundaria_4"] },
      { name: "Estadística: tablas, gráficos y medidas de tendencia central", grades: ["secundaria_1", "secundaria_2", "secundaria_3", "secundaria_4"] },
      { name: "Probabilidad", grades: ["secundaria_2", "secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Geometría analítica: la recta y la circunferencia", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Programación lineal y optimización", grades: ["secundaria_5"] },
    ],
  },
  {
    name: "Comunicación",
    topics: [
      { name: "Comprensión lectora de textos narrativos", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Comprensión lectora de textos expositivos y argumentativos", grades: ["secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Producción de textos narrativos", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Producción de textos argumentativos y ensayos", grades: ["secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Gramática: clases de palabras y estructura de la oración", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Ortografía: tildación y uso de grafías", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Coherencia y cohesión textual", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Comunicación oral: exposición y debate", grades: ["secundaria_1", "secundaria_2", "secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Literatura peruana", grades: ["secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Literatura latinoamericana y universal", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Géneros literarios: narrativo, lírico y dramático", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Figuras literarias y recursos estilísticos", grades: ["secundaria_2", "secundaria_3", "secundaria_4"] },
      { name: "El texto periodístico e informativo", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Textos funcionales: solicitud, informe, currículum vitae", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Medios de comunicación y lenguaje audiovisual", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Etimología y vocabulario", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
    ],
  },
  {
    name: "Ciencia y Tecnología",
    topics: [
      { name: "La célula: estructura y función", grades: ["secundaria_1", "secundaria_2"] },
      { name: "La materia: propiedades y estados", grades: ["secundaria_1"] },
      { name: "Ecosistemas y biodiversidad", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Nutrición y sistemas del cuerpo humano", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Reproducción y salud sexual", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Fuerzas y movimiento (cinemática)", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Energía: formas y transformaciones", grades: ["secundaria_2", "secundaria_3", "secundaria_4"] },
      { name: "Estructura atómica y tabla periódica", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Reacciones químicas", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Genética y herencia", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Evolución y selección natural", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Electricidad y magnetismo", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Ondas: sonido y luz", grades: ["secundaria_4"] },
      { name: "Ecología y problemática ambiental", grades: ["secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Método científico y diseño experimental", grades: ["secundaria_1", "secundaria_2", "secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Biotecnología y salud pública", grades: ["secundaria_5"] },
      { name: "Física moderna: introducción", grades: ["secundaria_5"] },
    ],
  },
  {
    name: "Ciencias Sociales",
    topics: [
      { name: "Historia del Perú prehispánico", grades: ["secundaria_1"] },
      { name: "Culturas preincas e imperio incaico", grades: ["secundaria_1"] },
      { name: "Conquista y virreinato del Perú", grades: ["secundaria_2"] },
      { name: "Independencia del Perú", grades: ["secundaria_3"] },
      { name: "República del Perú: siglo XIX y XX", grades: ["secundaria_4"] },
      { name: "Historia universal: Edad Media y Moderna", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Revoluciones: Francesa e Industrial", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Guerras mundiales y siglo XX", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Geografía física del Perú", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Geografía económica y recursos naturales", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Cartografía y orientación espacial", grades: ["secundaria_1"] },
      { name: "Economía: producción, mercado y desarrollo", grades: ["secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Regiones naturales y geografía de América", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Cambio climático y desarrollo sostenible", grades: ["secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Perú contemporáneo: democracia y globalización", grades: ["secundaria_5"] },
      { name: "Diversidad cultural y multiculturalidad", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
    ],
  },
  {
    name: "Desarrollo Personal, Ciudadanía y Cívica",
    topics: [
      { name: "Autoconocimiento e identidad personal", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Proyecto de vida", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Constitución Política del Perú", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Derechos humanos y derechos del niño", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Deberes y derechos ciudadanos", grades: ["secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Instituciones democráticas del Perú", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Resolución de conflictos y convivencia escolar", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Prevención de la violencia y el bullying", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Educación sexual integral", grades: ["secundaria_2", "secundaria_3", "secundaria_4"] },
      { name: "Participación ciudadana y organización estudiantil", grades: ["secundaria_4", "secundaria_5"] },
    ],
  },
  {
    name: "Inglés como Lengua Extranjera",
    topics: [
      { name: "Vocabulario básico y saludos (greetings)", grades: ["secundaria_1"] },
      { name: "Presente simple y presente continuo", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Pasado simple", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Futuro: will / going to", grades: ["secundaria_3"] },
      { name: "Comprensión de textos cortos (reading)", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Producción escrita: descripciones y narraciones", grades: ["secundaria_2", "secundaria_3", "secundaria_4"] },
      { name: "Comparativos y superlativos", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Verbos modales: can, must, should", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Voz pasiva", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Oraciones condicionales", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Comprensión auditiva (listening)", grades: ["secundaria_1", "secundaria_2", "secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Comunicación oral: diálogos y presentaciones", grades: ["secundaria_1", "secundaria_2", "secundaria_3", "secundaria_4", "secundaria_5"] },
    ],
  },
  {
    name: "Arte y Cultura",
    topics: [
      { name: "Elementos del lenguaje visual: línea, color y forma", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Dibujo y composición", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Historia del arte peruano", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Música: ritmo, melodía y géneros peruanos", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Danza y expresión corporal", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Teatro y expresión dramática", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Artes visuales contemporáneas", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Cerámica y artesanía tradicional", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Proyecto artístico integrador", grades: ["secundaria_4", "secundaria_5"] },
    ],
  },
  {
    name: "Educación Física",
    topics: [
      { name: "Habilidades motrices básicas", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Condición física: resistencia, fuerza y flexibilidad", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Deportes de conjunto: fútbol, vóley y básquet", grades: ["secundaria_1", "secundaria_2", "secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Atletismo", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Juegos predeportivos y recreativos", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Hábitos de vida saludable y nutrición deportiva", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Expresión corporal y ritmo", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Reglamentación deportiva y arbitraje", grades: ["secundaria_4", "secundaria_5"] },
    ],
  },
  {
    name: "Educación Religiosa",
    topics: [
      { name: "Sagrada Escritura: Antiguo Testamento", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Sagrada Escritura: Nuevo Testamento", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Historia de la Iglesia", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Doctrina social de la Iglesia", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Ética y valores cristianos", grades: ["secundaria_1", "secundaria_2", "secundaria_3"] },
      { name: "Sacramentos y liturgia", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Diálogo interreligioso y libertad religiosa", grades: ["secundaria_5"] },
    ],
  },
  {
    name: "Educación para el Trabajo",
    topics: [
      { name: "Emprendimiento e ideas de negocio", grades: ["secundaria_3", "secundaria_4", "secundaria_5"] },
      { name: "Gestión de proyectos y plan de negocio", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Tecnologías de la información básica", grades: ["secundaria_1", "secundaria_2"] },
      { name: "Diseño y elaboración de productos", grades: ["secundaria_2", "secundaria_3"] },
      { name: "Comercialización y marketing", grades: ["secundaria_4", "secundaria_5"] },
      { name: "Seguridad y salud ocupacional", grades: ["secundaria_3", "secundaria_4"] },
      { name: "Contabilidad básica y costos", grades: ["secundaria_4", "secundaria_5"] },
    ],
  },
];

/**
 * PREUNIVERSITARIO (pre) — desglose académico de los cursos de admisión.
 * Todos los temas se asignan al grado `pre` (etapa de un solo grado). Los cursos
 * `Comunicación` y `Biología` también los siembra `BANK_SAMPLE_COURSES` (con los
 * temas exactos de las 71 preguntas reales); al compartir `(stage, name)` los
 * temas se fusionan en el mismo curso.
 */
const PREUNI_SYLLABUS: readonly SyllabusCourse[] = [
  {
    name: "Aritmética",
    topics: [
      { name: "Teoría de conjuntos" },
      { name: "Sistemas de numeración" },
      { name: "Operaciones fundamentales" },
      { name: "Divisibilidad" },
      { name: "Números primos, MCD y MCM" },
      { name: "Fracciones" },
      { name: "Razones y proporciones" },
      { name: "Regla de tres y porcentajes" },
      { name: "Magnitudes proporcionales" },
      { name: "Interés simple y compuesto" },
      { name: "Promedios" },
      { name: "Mezcla y aleación" },
    ],
  },
  {
    name: "Álgebra",
    topics: [
      { name: "Teoría de exponentes" },
      { name: "Polinomios" },
      { name: "Productos notables" },
      { name: "Factorización" },
      { name: "División algebraica" },
      { name: "Ecuaciones de primer grado" },
      { name: "Ecuaciones de segundo grado" },
      { name: "Sistemas de ecuaciones" },
      { name: "Inecuaciones y valor absoluto" },
      { name: "Funciones" },
      { name: "Matrices y determinantes" },
      { name: "Progresiones" },
      { name: "Logaritmos" },
    ],
  },
  {
    name: "Geometría",
    topics: [
      { name: "Segmentos y ángulos" },
      { name: "Triángulos" },
      { name: "Congruencia y semejanza" },
      { name: "Polígonos y cuadriláteros" },
      { name: "Circunferencia" },
      { name: "Áreas de regiones planas" },
      { name: "Proporcionalidad y relaciones métricas" },
      { name: "Geometría del espacio (poliedros)" },
      { name: "Cuerpos redondos" },
      { name: "Geometría analítica" },
    ],
  },
  {
    name: "Trigonometría",
    topics: [
      { name: "Ángulos y sistemas de medición angular" },
      { name: "Razones trigonométricas" },
      { name: "Identidades trigonométricas" },
      { name: "Ecuaciones trigonométricas" },
      { name: "Funciones trigonométricas" },
      { name: "Resolución de triángulos" },
      { name: "Circunferencia trigonométrica" },
    ],
  },
  {
    name: "Razonamiento Matemático",
    topics: [
      { name: "Sucesiones y series" },
      { name: "Analogías y distribuciones numéricas" },
      { name: "Planteo de ecuaciones" },
      { name: "Edades" },
      { name: "Móviles y cronometría" },
      { name: "Operadores matemáticos" },
      { name: "Conteo de figuras" },
      { name: "Razonamiento lógico" },
      { name: "Certezas y probabilidades" },
    ],
  },
  {
    name: "Razonamiento Verbal",
    topics: [
      { name: "Sinónimos y antónimos" },
      { name: "Analogías verbales" },
      { name: "Series verbales" },
      { name: "Oraciones incompletas" },
      { name: "Conectores lógicos" },
      { name: "Comprensión de lectura" },
      { name: "Eliminación de oraciones" },
      { name: "Plan de redacción" },
      { name: "Término excluido" },
    ],
  },
  {
    name: "Lenguaje",
    topics: [
      { name: "La comunicación" },
      { name: "Fonética y fonología" },
      { name: "Acentuación" },
      { name: "Morfología" },
      { name: "Sintaxis" },
      { name: "Categorías gramaticales" },
      { name: "Uso de grafías" },
      { name: "Signos de puntuación" },
      { name: "Semántica" },
      { name: "Normativa (dequeísmo y queísmo)" },
    ],
  },
  {
    name: "Literatura",
    topics: [
      { name: "Figuras literarias" },
      { name: "Géneros y especies literarias" },
      { name: "Literatura peruana" },
      { name: "Literatura española" },
      { name: "Literatura hispanoamericana" },
      { name: "Literatura universal" },
      { name: "Movimientos y vanguardias literarias" },
    ],
  },
  {
    name: "Física",
    topics: [
      { name: "Análisis dimensional y vectores" },
      { name: "Cinemática" },
      { name: "Estática" },
      { name: "Dinámica" },
      { name: "Trabajo, energía y potencia" },
      { name: "Cantidad de movimiento" },
      { name: "Hidrostática" },
      { name: "Termodinámica" },
      { name: "Electrostática y electrodinámica" },
      { name: "Magnetismo" },
      { name: "Ondas y óptica" },
    ],
  },
  {
    name: "Química",
    topics: [
      { name: "Materia y energía" },
      { name: "Estructura atómica" },
      { name: "Tabla periódica" },
      { name: "Enlace químico" },
      { name: "Nomenclatura inorgánica" },
      { name: "Reacciones químicas" },
      { name: "Estequiometría" },
      { name: "Estados de la materia" },
      { name: "Soluciones" },
      { name: "Química del carbono" },
      { name: "Ácidos, bases y sales" },
    ],
  },
  {
    name: "Historia del Perú",
    topics: [
      { name: "Culturas preincas" },
      { name: "Imperio incaico" },
      { name: "Descubrimiento y conquista" },
      { name: "Virreinato del Perú" },
      { name: "Emancipación e independencia" },
      { name: "República: siglo XIX" },
      { name: "Guerra con Chile" },
      { name: "República contemporánea" },
    ],
  },
  {
    name: "Historia Universal",
    topics: [
      { name: "Prehistoria" },
      { name: "Culturas de la Antigüedad" },
      { name: "Edad Media" },
      { name: "Edad Moderna" },
      { name: "Revolución Francesa" },
      { name: "Revolución Industrial" },
      { name: "Guerras Mundiales" },
      { name: "Guerra Fría" },
    ],
  },
  {
    name: "Geografía",
    topics: [
      { name: "Geografía física" },
      { name: "Coordenadas geográficas" },
      { name: "Geomorfología" },
      { name: "Hidrografía del Perú" },
      { name: "Climatología" },
      { name: "Ecorregiones del Perú" },
      { name: "Geografía económica" },
      { name: "Población y demografía" },
    ],
  },
  {
    name: "Economía",
    topics: [
      { name: "Necesidades y bienes" },
      { name: "Factores productivos" },
      { name: "Sistemas económicos" },
      { name: "Mercado, oferta y demanda" },
      { name: "Dinero y banca" },
      { name: "Inflación" },
      { name: "Comercio internacional" },
      { name: "El Estado y la economía" },
    ],
  },
  {
    name: "Filosofía",
    topics: [
      { name: "Origen de la filosofía" },
      { name: "Gnoseología y epistemología" },
      { name: "Lógica" },
      { name: "Ética" },
      { name: "Ontología y metafísica" },
      { name: "Axiología" },
      { name: "Antropología filosófica" },
      { name: "Filosofía política" },
    ],
  },
  {
    name: "Educación Cívica",
    topics: [
      { name: "Estado y nación" },
      { name: "Constitución Política del Perú" },
      { name: "Derechos humanos" },
      { name: "Poderes del Estado" },
      { name: "Organismos constitucionales autónomos" },
      { name: "Democracia y ciudadanía" },
      { name: "Defensa nacional" },
      { name: "Seguridad ciudadana" },
    ],
  },
  {
    name: "Psicología",
    topics: [
      { name: "Bases biológicas de la conducta" },
      { name: "Sensación y percepción" },
      { name: "Aprendizaje" },
      { name: "Memoria" },
      { name: "Motivación y emoción" },
      { name: "Personalidad" },
      { name: "Inteligencia" },
      { name: "Psicología social" },
    ],
  },
];

/**
 * Courses + topics required by `scripts/seed-bank-sample.ts` (71 real
 * image-type questions, grade level "pre"). Topic names are copied verbatim
 * from `bank-questions/classification.json` so the sample-seeding script can
 * resolve `topicId` by exact name match. These are preuniversitario courses
 * (grade "pre"); they merge into the `PREUNI_SYLLABUS` `Biología` /
 * `Comunicación` course rows.
 */
const BANK_SAMPLE_COURSES: readonly SyllabusCourse[] = [
  {
    name: "Biología",
    topics: [
      "biología general",
      "método científico",
      "fisiología humana",
      "evolución",
      "bioquímica",
      "citología",
      "biología molecular",
      "microbiología",
      "bioenergética",
      "fotosíntesis",
      "sistema nervioso",
      "biotecnología",
    ].map((name) => ({ name })),
  },
  {
    name: "Comunicación",
    topics: [
      "morfología verbal (accidentes del verbo)",
      "acentuación - clasificación de palabras según su acento (agudas, graves, esdrújulas, sobresdrújulas)",
      "sintaxis - complementos oracionales (complemento agente)",
      "ortografía - uso de mayúsculas",
      "clases de oraciones según la actitud del hablante",
      "morfología - clases de palabras (adjetivo)",
      "teoría de la comunicación - concepto y elementos",
      "morfología - formación de palabras (prefijos y sufijos)",
      "morfología - clases de palabras (adverbio)",
      "morfología - clasificación del sustantivo (individual y colectivo)",
      "morfología - clases de palabras (pronombre)",
      "sintaxis - la oración (concepto y estructura)",
      "fonética - diptongo, triptongo e hiato",
      "semántica - concepto y niveles de la lengua",
      "acentuación - conceptos generales (acento, tilde, sílaba tónica y átona)",
      "morfología - clases de palabras (sustantivo)",
      "ortografía - signos de puntuación y entonación",
      "teoría de la comunicación - funciones del lenguaje",
      "gramática - niveles de la lengua (fonética, morfología, sintaxis, semántica)",
      "morfología - formación de palabras (composición y derivación)",
      "ortografía - signos de puntuación (uso del punto y coma)",
      "sintaxis - funciones del sustantivo en la oración",
      "sintaxis - estructura del sujeto (núcleo y modificadores)",
      "lingüística - articulación del lenguaje (doble articulación)",
      "teoría de la comunicación - etimología del término comunicación",
      "acentuación - clasificación de palabras según su acento (tildación)",
      "sintaxis - el sujeto de la oración",
      "ortografía - uso de los dos puntos",
      "sintaxis - el sujeto tácito",
      "sintaxis - clases de sujeto",
      "lingüística - características de la lengua",
      "teoría de la comunicación - elementos de la comunicación (receptor)",
      "lingüística - ramas de la lingüística",
      "ortografía - uso de grafías (ortografía literal)",
      "acentuación - hiato",
      "morfología - clases de verbo (transitivo/intransitivo)",
      "sintaxis - el predicado (núcleo)",
      "sintaxis - el sintagma verbal / predicado",
      "lingüística - el fonema (unidades mínimas del lenguaje)",
      "teoría de la comunicación - lengua, lenguaje y habla",
    ].map((name) => ({ name })),
  },
];

const DEMO_TENANT = {
  name: "Colegio Demo",
  slug: "colegio-demo",
};

const DEMO_ADMIN = {
  email: "admin@colegio-demo.test",
  role: Role.SchoolAdmin,
};

/**
 * Platform-staff user (`tenant_id NULL`) that `scripts/seed-bank-sample.ts`
 * signs its JWT for. `questions.created_by` is a NOT NULL FK to `users.id`,
 * so a real row is required.
 */
const BANK_SAMPLE_ADMIN = {
  email: "bank-sample-seeder@exams-generator.internal",
  passwordHash: "unset-pending-auth-module-pr5",
  role: Role.PlatformAdmin,
};

/**
 * Idempotent: every insert targets a unique column/index with
 * `onConflictDoNothing`, so running this twice (or a hundred times) never
 * creates duplicates and never throws.
 */
export async function seed(): Promise<void> {
  await seedGradeLevels();
  const tenantId = await seedDemoTenant();
  await seedDemoAdmin(tenantId);
  await seedBankSampleAdmin();
  // Converge any legacy null-grade topics (seeded before the stage migration)
  // to preuniversitario's single grade so the unique index dedupes on reseed.
  await db.update(topics).set({ gradeLevel: "pre" }).where(isNull(topics.gradeLevel));
  await seedStage("escuela", ESCUELA_SYLLABUS);
  await seedStage("colegio", COLEGIO_SYLLABUS);
  await seedStage("preuniversitario", PREUNI_SYLLABUS);
  await seedStage("preuniversitario", BANK_SAMPLE_COURSES);
}

async function seedGradeLevels(): Promise<void> {
  const rows = GRADE_LEVELS.map((code, index) => ({ code, sortOrder: index }));
  await db.insert(gradeLevels).values(rows).onConflictDoNothing({ target: gradeLevels.code });
}

async function seedDemoTenant(): Promise<string> {
  await db.insert(tenants).values(DEMO_TENANT).onConflictDoNothing({ target: tenants.slug });

  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, DEMO_TENANT.slug));

  if (!tenant) {
    throw new Error(`Seed invariant violated: tenant '${DEMO_TENANT.slug}' missing after insert`);
  }

  return tenant.id;
}

async function seedDemoAdmin(tenantId: string): Promise<void> {
  const passwordHash = await hashPassword(DEMO_ADMIN_PASSWORD);
  await db
    .insert(users)
    .values({ ...DEMO_ADMIN, passwordHash, tenantId })
    .onConflictDoUpdate({ target: users.email, set: { passwordHash, role: DEMO_ADMIN.role } });
}

async function seedBankSampleAdmin(): Promise<void> {
  await db
    .insert(users)
    .values({ ...BANK_SAMPLE_ADMIN, tenantId: null })
    .onConflictDoNothing({ target: users.email });
}

/**
 * Seeds one stage's courses and topics. A course is unique by `(stage, name)`;
 * a topic is written once per grade it lists (`grades`), or once at grade `pre`
 * when it lists none (whole-stage / preuniversitario). Every insert is
 * `onConflictDoNothing`, so reseeding is a no-op.
 */
async function seedStage(stage: Stage, courseList: readonly SyllabusCourse[]): Promise<void> {
  for (const course of courseList) {
    await db
      .insert(courses)
      .values({ name: course.name, stage })
      .onConflictDoNothing({ target: [courses.stage, courses.name] });

    const [courseRow] = await db
      .select({ id: courses.id })
      .from(courses)
      .where(and(eq(courses.stage, stage), eq(courses.name, course.name)));

    if (!courseRow) {
      throw new Error(`Seed invariant violated: course '${course.name}' (${stage}) missing after insert`);
    }

    for (const topic of course.topics) {
      const topicGrades: readonly GradeLevel[] = topic.grades ?? (["pre"] as const);
      for (const gradeLevel of topicGrades) {
        await db
          .insert(topics)
          .values({ courseId: courseRow.id, name: topic.name, gradeLevel })
          .onConflictDoNothing({ target: [topics.courseId, topics.name, topics.gradeLevel] });
      }
    }
  }
}

/* istanbul ignore next -- CLI entrypoint, exercised manually / in deploys, not under unit test */
if (require.main === module) {
  seed()
    .then(() => {
      console.log("Seed complete.");
      return pool.end();
    })
    .catch((error: unknown) => {
      console.error("Seed failed:", error);
      return pool.end().finally(() => process.exit(1));
    });
}
