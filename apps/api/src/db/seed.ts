import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Role } from "@exams-generator/shared";
import { and, eq, isNull } from "drizzle-orm";
import { GRADE_LEVELS } from "../modules/exams/domain/value-objects/grade-level";
import type { GradeLevel, Stage } from "../modules/exams/domain/value-objects/grade-level";
import { hashPassword } from "../modules/auth/password.util";
import { db, pool } from "./client";
import {
  courses,
  cycles,
  examBlueprintTemplateRows,
  examBlueprintTemplates,
  examTypes,
  gradeLevels,
  syllabusWeekMaps,
  tenants,
  topics,
  tracks,
  universities,
  users,
} from "./schema";

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
  /**
   * The 4 entries below are courses the existing preuniversitario catalog
   * didn't have, added for the UNI/UNCP exam-blueprint seed (design doc
   * §4, phase 2). Their `topics` start empty here on purpose:
   * - "Historia" and "Inglés": UNI evaluates a single combined "Historia"
   *   subject (mixing Perú + Universal week by week) and "Inglés" isn't in
   *   this catalog at all. Forcing "Historia" content into the existing
   *   split "Historia del Perú"/"Historia Universal" courses would have
   *   badly mismatched roughly half of UNI's weekly syllabus (see
   *   `data/uni-preuniversitario-syllabus.json`). `seedUniSyllabusWeekMaps`
   *   creates their real topics on demand, one per mapped syllabus week.
   * - "Estadística y Probabilidades" and "Ecología": genuinely new UNCP
   *   Anexo 7 courses with no existing match; UNCP's Anexo 7 is course-level
   *   only (`topic_id NULL`), and UNI doesn't test either subject, so no
   *   topic data exists to seed for them yet.
   */
  { name: "Historia", topics: [] },
  { name: "Inglés", topics: [] },
  { name: "Estadística y Probabilidades", topics: [] },
  { name: "Ecología", topics: [] },
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

/**
 * Global exam-type catalog (design doc §4 `exam_types`): the four default
 * exam types, data-driven by `course_scope` x `week_scope` — see
 * `exam-types.schema.ts` for why this is a seeded table, not an enum.
 */
const EXAM_TYPES = [
  { code: "manual", label: "Manual", courseScope: "none", weekScope: "none", sortOrder: 0 },
  {
    code: "fastest",
    label: "Fastest",
    courseScope: "selected",
    weekScope: "current_only",
    sortOrder: 1,
  },
  { code: "eta", label: "ETA", courseScope: "all", weekScope: "none", sortOrder: 2 },
  {
    code: "eta_by_week",
    label: "ETA por semana",
    courseScope: "all",
    weekScope: "cumulative",
    sortOrder: 3,
  },
] as const;

/** Global university catalog (design doc §4 `universities`). */
const UNIVERSITIES = [
  { code: "uni", name: "Universidad Nacional de Ingeniería" },
  { code: "uncp", name: "Universidad Nacional del Centro del Perú" },
] as const;

interface TrackSeed {
  readonly code: string;
  readonly name: string;
  readonly kind: "area" | "cycle_track";
}

/** UNCP's 5 career-based admission areas (design doc §2, §3.1). */
const UNCP_TRACKS: readonly TrackSeed[] = [
  { code: "I", name: "Ciencias de la Salud", kind: "area" },
  { code: "II", name: "Ingenierías y Arquitectura", kind: "area" },
  { code: "III", name: "Ciencias Administrativas, Contables y Económicas", kind: "area" },
  { code: "IV", name: "Ciencias Sociales y Educación", kind: "area" },
  { code: "V", name: "Ciencias Agrarias", kind: "area" },
];

/** UNI's prep-cycle tracks (design doc §2, §3.1). */
const UNI_TRACKS: readonly TrackSeed[] = [
  { code: "basico", name: "Ciclo Básico", kind: "cycle_track" },
  { code: "preuniversitario", name: "Ciclo Preuniversitario", kind: "cycle_track" },
  { code: "intensivo_1", name: "Intensivo I", kind: "cycle_track" },
];

/**
 * UNCP Anexo 7 — Cuadro de Ponderación por Áreas Académicas, Examen
 * Ordinario 2026-II (design doc §4 `exam_blueprint_template_rows`;
 * web-research slug peru-university-admissions/uncp-ceprunc-admission-syllabus).
 * Transcribed verbatim, course-level (`topic_id` stays NULL — Anexo 7 has no
 * per-topic breakdown): one row per (course, NIVEL) exactly as the table
 * lists it, so a course that appears twice under different NIVEL (e.g.
 * "Comunicación" at P.I. and P.A. in Área I) becomes two rows here.
 * `questionCount`/`weightPoints` are the real "Nº Preg"/"Puntaje" columns —
 * not derived or estimated. `sourceLevel` keeps the raw "P.B."/"P.I."/"P.A."
 * string unmapped (design doc §3.6).
 *
 * `courseName` resolves against the existing `courses` catalog:
 * "Aptitud Lógico Matemático" reuses "Razonamiento Matemático" and "Aptitud
 * Comunicativa" reuses "Razonamiento Verbal" — both are UNCP's name for the
 * same concept UNI calls "Razonamiento" (a reasoning/aptitude test, distinct
 * from the graded content course of the same subject area). "Cívica" reuses
 * "Educación Cívica". "Estadística y Probabilidades", "Ecología" and
 * "Historia" are the new courses added to `PREUNI_SYLLABUS` above.
 */
interface UncpAnexo7Row {
  readonly examSection: string;
  readonly courseName: string;
  readonly sourceLevel: string;
  readonly questionCount: number;
  readonly weightPoints: number;
}

const UNCP_ANEXO7: Readonly<Record<string, readonly UncpAnexo7Row[]>> = {
  I: [
    { examSection: "Matemática", courseName: "Aritmética", sourceLevel: "P.A.", questionCount: 5, weightPoints: 3.925 },
    { examSection: "Matemática", courseName: "Álgebra", sourceLevel: "P.A.", questionCount: 5, weightPoints: 3.815 },
    {
      examSection: "Matemática",
      courseName: "Estadística y Probabilidades",
      sourceLevel: "P.A.",
      questionCount: 3,
      weightPoints: 2.415,
    },
    { examSection: "Comunicación", courseName: "Comunicación", sourceLevel: "P.I.", questionCount: 6, weightPoints: 3.918 },
    { examSection: "Comunicación", courseName: "Comunicación", sourceLevel: "P.A.", questionCount: 5, weightPoints: 7.66 },
    {
      examSection: "Ciencia y Tecnología",
      courseName: "Biología",
      sourceLevel: "P.I.",
      questionCount: 4,
      weightPoints: 4.984,
    },
    {
      examSection: "Ciencia y Tecnología",
      courseName: "Biología",
      sourceLevel: "P.B.",
      questionCount: 2,
      weightPoints: 2.112,
    },
    { examSection: "Ciencia y Tecnología", courseName: "Química", sourceLevel: "P.A.", questionCount: 6, weightPoints: 7.272 },
    { examSection: "Ciencia y Tecnología", courseName: "Física", sourceLevel: "P.A.", questionCount: 5, weightPoints: 5.925 },
    {
      examSection: "Ciencia y Tecnología",
      courseName: "Ecología",
      sourceLevel: "P.A.",
      questionCount: 3,
      weightPoints: 3.744,
    },
    { examSection: "DPCC", courseName: "Psicología", sourceLevel: "P.A.", questionCount: 6, weightPoints: 4.824 },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.A.",
      questionCount: 6,
      weightPoints: 7.212,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 6.606,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.B.",
      questionCount: 6,
      weightPoints: 6.036,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.A.",
      questionCount: 6,
      weightPoints: 4.83,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 4.722,
    },
  ],
  II: [
    { examSection: "Matemática", courseName: "Aritmética", sourceLevel: "P.A.", questionCount: 6, weightPoints: 6.756 },
    { examSection: "Matemática", courseName: "Aritmética", sourceLevel: "P.I.", questionCount: 2, weightPoints: 2.096 },
    { examSection: "Matemática", courseName: "Álgebra", sourceLevel: "P.A.", questionCount: 5, weightPoints: 5.84 },
    { examSection: "Matemática", courseName: "Álgebra", sourceLevel: "P.I.", questionCount: 3, weightPoints: 3.102 },
    { examSection: "Matemática", courseName: "Geometría", sourceLevel: "P.A.", questionCount: 5, weightPoints: 5.56 },
    { examSection: "Matemática", courseName: "Trigonometría", sourceLevel: "P.A.", questionCount: 5, weightPoints: 5.565 },
    {
      examSection: "Matemática",
      courseName: "Estadística y Probabilidades",
      sourceLevel: "P.I.",
      questionCount: 5,
      weightPoints: 4.905,
    },
    { examSection: "Comunicación", courseName: "Comunicación", sourceLevel: "P.I.", questionCount: 5, weightPoints: 4.19 },
    { examSection: "Ciencia y Tecnología", courseName: "Química", sourceLevel: "P.I.", questionCount: 5, weightPoints: 4.89 },
    { examSection: "Ciencia y Tecnología", courseName: "Física", sourceLevel: "P.I.", questionCount: 6, weightPoints: 6.69 },
    {
      examSection: "Ciencia y Tecnología",
      courseName: "Ecología",
      sourceLevel: "P.I.",
      questionCount: 3,
      weightPoints: 2.019,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.A.",
      questionCount: 7,
      weightPoints: 7.721,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 5.946,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.B.",
      questionCount: 6,
      weightPoints: 5.532,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.A.",
      questionCount: 6,
      weightPoints: 5.178,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.I.",
      questionCount: 5,
      weightPoints: 4.01,
    },
  ],
  III: [
    { examSection: "Matemática", courseName: "Aritmética", sourceLevel: "P.I.", questionCount: 7, weightPoints: 8.127 },
    { examSection: "Matemática", courseName: "Álgebra", sourceLevel: "P.I.", questionCount: 5, weightPoints: 5.795 },
    { examSection: "Matemática", courseName: "Álgebra", sourceLevel: "P.B.", questionCount: 3, weightPoints: 2.781 },
    {
      examSection: "Matemática",
      courseName: "Estadística y Probabilidades",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 6.75,
    },
    { examSection: "Comunicación", courseName: "Comunicación", sourceLevel: "P.I.", questionCount: 6, weightPoints: 5.85 },
    {
      examSection: "Ciencia y Tecnología",
      courseName: "Ecología",
      sourceLevel: "P.I.",
      questionCount: 3,
      weightPoints: 1.815,
    },
    { examSection: "Ciencias Sociales", courseName: "Historia", sourceLevel: "P.I.", questionCount: 3, weightPoints: 1.944 },
    { examSection: "Ciencias Sociales", courseName: "Geografía", sourceLevel: "P.I.", questionCount: 3, weightPoints: 2.247 },
    { examSection: "Ciencias Sociales", courseName: "Economía", sourceLevel: "P.I.", questionCount: 6, weightPoints: 7.608 },
    { examSection: "DPCC", courseName: "Psicología", sourceLevel: "P.I.", questionCount: 3, weightPoints: 2.619 },
    { examSection: "DPCC", courseName: "Educación Cívica", sourceLevel: "P.I.", questionCount: 5, weightPoints: 3.73 },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.A.",
      questionCount: 6,
      weightPoints: 6.618,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 6.126,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.B.",
      questionCount: 4,
      weightPoints: 3.836,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.A.",
      questionCount: 6,
      weightPoints: 6.45,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 5.946,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.B.",
      questionCount: 2,
      weightPoints: 1.758,
    },
  ],
  IV: [
    { examSection: "Matemática", courseName: "Aritmética", sourceLevel: "P.B.", questionCount: 5, weightPoints: 4.075 },
    { examSection: "Matemática", courseName: "Álgebra", sourceLevel: "P.B.", questionCount: 4, weightPoints: 3.228 },
    {
      examSection: "Matemática",
      courseName: "Estadística y Probabilidades",
      sourceLevel: "P.B.",
      questionCount: 3,
      weightPoints: 2.775,
    },
    { examSection: "Comunicación", courseName: "Comunicación", sourceLevel: "P.I.", questionCount: 5, weightPoints: 5.89 },
    { examSection: "Comunicación", courseName: "Comunicación", sourceLevel: "P.B.", questionCount: 5, weightPoints: 5.18 },
    {
      examSection: "Ciencia y Tecnología",
      courseName: "Biología",
      sourceLevel: "P.B.",
      questionCount: 3,
      weightPoints: 2.988,
    },
    {
      examSection: "Ciencia y Tecnología",
      courseName: "Ecología",
      sourceLevel: "P.B.",
      questionCount: 3,
      weightPoints: 2.934,
    },
    { examSection: "Ciencias Sociales", courseName: "Historia", sourceLevel: "P.B.", questionCount: 5, weightPoints: 5.49 },
    { examSection: "Ciencias Sociales", courseName: "Geografía", sourceLevel: "P.B.", questionCount: 3, weightPoints: 3.255 },
    { examSection: "Ciencias Sociales", courseName: "Economía", sourceLevel: "P.B.", questionCount: 3, weightPoints: 3.009 },
    { examSection: "DPCC", courseName: "Psicología", sourceLevel: "P.I.", questionCount: 5, weightPoints: 5.23 },
    { examSection: "DPCC", courseName: "Filosofía", sourceLevel: "P.I.", questionCount: 3, weightPoints: 3.045 },
    { examSection: "DPCC", courseName: "Educación Cívica", sourceLevel: "P.I.", questionCount: 3, weightPoints: 3.045 },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 6.714,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.B.",
      questionCount: 6,
      weightPoints: 5.232,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.A.",
      questionCount: 6,
      weightPoints: 6.606,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 5.928,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.B.",
      questionCount: 6,
      weightPoints: 5.376,
    },
  ],
  V: [
    { examSection: "Matemática", courseName: "Aritmética", sourceLevel: "P.B.", questionCount: 5, weightPoints: 5.57 },
    { examSection: "Matemática", courseName: "Álgebra", sourceLevel: "P.B.", questionCount: 5, weightPoints: 5.565 },
    { examSection: "Matemática", courseName: "Geometría", sourceLevel: "P.B.", questionCount: 3, weightPoints: 3.333 },
    { examSection: "Matemática", courseName: "Trigonometría", sourceLevel: "P.B.", questionCount: 3, weightPoints: 3.354 },
    {
      examSection: "Matemática",
      courseName: "Estadística y Probabilidades",
      sourceLevel: "P.B.",
      questionCount: 3,
      weightPoints: 3.198,
    },
    { examSection: "Comunicación", courseName: "Comunicación", sourceLevel: "P.B.", questionCount: 6, weightPoints: 5.232 },
    {
      examSection: "Ciencia y Tecnología",
      courseName: "Biología",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 6.09,
    },
    { examSection: "Ciencia y Tecnología", courseName: "Química", sourceLevel: "P.B.", questionCount: 5, weightPoints: 4.825 },
    { examSection: "Ciencia y Tecnología", courseName: "Física", sourceLevel: "P.B.", questionCount: 3, weightPoints: 2.943 },
    {
      examSection: "Ciencia y Tecnología",
      courseName: "Ecología",
      sourceLevel: "P.I.",
      questionCount: 5,
      weightPoints: 5.755,
    },
    { examSection: "Ciencias Sociales", courseName: "Geografía", sourceLevel: "P.B.", questionCount: 3, weightPoints: 2.526 },
    { examSection: "DPCC", courseName: "Psicología", sourceLevel: "P.B.", questionCount: 3, weightPoints: 1.797 },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.A.",
      questionCount: 4,
      weightPoints: 4.86,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 6.576,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Matemático",
      sourceLevel: "P.B.",
      questionCount: 6,
      weightPoints: 5.928,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.A.",
      questionCount: 2,
      weightPoints: 2.188,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.I.",
      questionCount: 6,
      weightPoints: 5.226,
    },
    {
      examSection: "Preguntas Aptitudes",
      courseName: "Razonamiento Verbal",
      sourceLevel: "P.B.",
      questionCount: 6,
      weightPoints: 5.034,
    },
  ],
};

/**
 * UNI E1/E2/E3 course lists (design doc §4 step 4). CEPRE-UNI's reglamento
 * only publishes per-SECTION point totals (E1=745, E2=600, E3=500 — see
 * design doc §2) — never a per-course breakdown, so `question_count` stays
 * NULL for every UNI row and `weight_points` below is an EXPLICIT EVEN
 * SPLIT of each section's total across its courses. This is a documented
 * approximation, not official data (see seed report). RM has no dedicated
 * syllabus (its content is threaded inside Aritmética/Álgebra/Geometría —
 * design doc §3.10) but is still one of the 9 officially evaluated subjects,
 * so it gets its own E1 row reusing the existing "Razonamiento Matemático"
 * course.
 */
const UNI_E1_COURSES = [
  "Razonamiento Verbal",
  "Razonamiento Matemático",
  "Literatura",
  "Filosofía",
  "Lenguaje",
  "Inglés",
  "Historia",
  "Economía",
  "Geografía",
  "Psicología",
] as const;
const UNI_E2_COURSES = ["Aritmética", "Álgebra", "Geometría", "Trigonometría"] as const;
const UNI_E3_COURSES = ["Física", "Química"] as const;
const UNI_SECTION_TOTALS = { E1: 745, E2: 600, E3: 500 } as const;

/** Path to the UNI week-by-week syllabus data (design doc §4 `syllabus_week_maps`). */
const UNI_SYLLABUS_PATH = resolve(__dirname, "data/uni-preuniversitario-syllabus.json");

interface UniSyllabusWeekEntry {
  readonly week: number;
  readonly topics: readonly string[];
}
interface UniSyllabusCourseEntry {
  readonly courseName: string;
  readonly weeks: readonly UniSyllabusWeekEntry[];
}
interface UniSyllabusFile {
  readonly courses: readonly UniSyllabusCourseEntry[];
}

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
  await seedExamTypes();
  await seedUniversities();
  await seedTracks("uncp", UNCP_TRACKS);
  await seedTracks("uni", UNI_TRACKS);
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
  await seedExamBlueprintData();
  await seedCycle();
}

async function seedGradeLevels(): Promise<void> {
  const rows = GRADE_LEVELS.map((code, index) => ({ code, sortOrder: index }));
  await db.insert(gradeLevels).values(rows).onConflictDoNothing({ target: gradeLevels.code });
}

async function seedExamTypes(): Promise<void> {
  await db.insert(examTypes).values([...EXAM_TYPES]).onConflictDoNothing({ target: examTypes.code });
}

async function seedUniversities(): Promise<void> {
  await db.insert(universities).values([...UNIVERSITIES]).onConflictDoNothing({ target: universities.code });
}

/**
 * Seeds one university's tracks. `university_id` is FK-dependent on the
 * university row, so it's resolved by re-querying on `code` after
 * `seedUniversities()` — same read-after-insert pattern as `seedDemoTenant`.
 */
async function seedTracks(universityCode: string, trackList: readonly TrackSeed[]): Promise<void> {
  const [university] = await db
    .select({ id: universities.id })
    .from(universities)
    .where(eq(universities.code, universityCode));

  if (!university) {
    throw new Error(`Seed invariant violated: university '${universityCode}' missing after insert`);
  }

  const rows = trackList.map((track) => ({ ...track, universityId: university.id }));
  await db
    .insert(tracks)
    .values(rows)
    .onConflictDoNothing({ target: [tracks.universityId, tracks.code] });
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

async function getCourseId(name: string): Promise<string> {
  const [row] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.stage, "preuniversitario"), eq(courses.name, name)));
  if (!row) {
    throw new Error(`Seed invariant violated: preuniversitario course '${name}' missing — run seedStage first`);
  }
  return row.id;
}

/**
 * Upserts one topic under `courseId` and returns its id — same
 * insert-then-select shape as `seedStage`'s inner loop, factored out because
 * `seedUniSyllabusWeekMaps` needs it for topics that aren't in any static
 * `SyllabusCourse` list (they're read from `data/uni-preuniversitario-syllabus.json`).
 */
async function ensureTopic(courseId: string, name: string, gradeLevel: GradeLevel): Promise<string> {
  await db
    .insert(topics)
    .values({ courseId, name, gradeLevel })
    .onConflictDoNothing({ target: [topics.courseId, topics.name, topics.gradeLevel] });

  const [row] = await db
    .select({ id: topics.id })
    .from(topics)
    .where(and(eq(topics.courseId, courseId), eq(topics.name, name), eq(topics.gradeLevel, gradeLevel)));

  if (!row) {
    throw new Error(`Seed invariant violated: topic '${name}' missing after insert`);
  }
  return row.id;
}

/**
 * Resolves/creates the "current" `exam_blueprint_templates` row for
 * (university, track?, tenant=NULL). Its uniqueness is a partial index over
 * `COALESCE(track_id, sentinel)` / `COALESCE(tenant_id, sentinel)`
 * expressions (design doc §4), which Drizzle's `onConflictDoNothing({
 * target })` cannot address — it only emits a plain `ON CONFLICT (columns)`
 * clause, which does not match an expression index. So idempotency here is
 * a deliberate manual read-before-write instead of the usual
 * onConflictDoNothing pattern, not an oversight.
 */
async function seedExamBlueprintTemplate(
  universityCode: string,
  trackCode: string | null,
  cycleLabel: string,
): Promise<string> {
  const [university] = await db
    .select({ id: universities.id })
    .from(universities)
    .where(eq(universities.code, universityCode));
  if (!university) {
    throw new Error(`Seed invariant violated: university '${universityCode}' missing`);
  }

  let trackId: string | null = null;
  if (trackCode) {
    const [track] = await db
      .select({ id: tracks.id })
      .from(tracks)
      .where(and(eq(tracks.universityId, university.id), eq(tracks.code, trackCode)));
    if (!track) {
      throw new Error(`Seed invariant violated: track '${trackCode}' missing for university '${universityCode}'`);
    }
    trackId = track.id;
  }

  const [existing] = await db
    .select({ id: examBlueprintTemplates.id })
    .from(examBlueprintTemplates)
    .where(
      and(
        eq(examBlueprintTemplates.universityId, university.id),
        eq(examBlueprintTemplates.isCurrent, true),
        isNull(examBlueprintTemplates.tenantId),
        trackId ? eq(examBlueprintTemplates.trackId, trackId) : isNull(examBlueprintTemplates.trackId),
      ),
    );
  if (existing) {
    return existing.id;
  }

  const [inserted] = await db
    .insert(examBlueprintTemplates)
    .values({ universityId: university.id, trackId, tenantId: null, cycleLabel, isCurrent: true })
    .returning({ id: examBlueprintTemplates.id });
  if (!inserted) {
    throw new Error(`Seed invariant violated: insert into exam_blueprint_templates returned no row`);
  }
  return inserted.id;
}

/**
 * `exam_blueprint_template_rows` has no unique index at all (only the
 * question_count/weight_points CHECK) — by design, it's real transcribed
 * data, not a lookup table. Idempotency is therefore coarse-grained: if a
 * template already has rows, assume it was already fully seeded and skip,
 * rather than the per-row onConflictDoNothing used everywhere else in this
 * file.
 */
async function templateHasRows(templateId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: examBlueprintTemplateRows.id })
    .from(examBlueprintTemplateRows)
    .where(eq(examBlueprintTemplateRows.templateId, templateId));
  return Boolean(row);
}

/**
 * Seeds the 16 UNI blueprint rows (10 E1 + 4 E2 + 2 E3) — see
 * `UNI_E1_COURSES`/`UNI_E2_COURSES`/`UNI_E3_COURSES` for the explicit
 * even-split approximation this relies on.
 */
async function seedUniBlueprintRows(templateId: string): Promise<number> {
  if (await templateHasRows(templateId)) {
    return 0;
  }

  const sections = [
    { section: "E1", courseNames: UNI_E1_COURSES, total: UNI_SECTION_TOTALS.E1 },
    { section: "E2", courseNames: UNI_E2_COURSES, total: UNI_SECTION_TOTALS.E2 },
    { section: "E3", courseNames: UNI_E3_COURSES, total: UNI_SECTION_TOTALS.E3 },
  ] as const;

  const values: Array<{
    templateId: string;
    courseId: string;
    topicId: null;
    questionCount: null;
    weightPoints: string;
    examSection: string;
    sourceLevel: null;
  }> = [];

  for (const { section, courseNames, total } of sections) {
    const weightPerCourse = (total / courseNames.length).toFixed(3);
    for (const courseName of courseNames) {
      const courseId = await getCourseId(courseName);
      values.push({
        templateId,
        courseId,
        topicId: null,
        questionCount: null,
        weightPoints: weightPerCourse,
        examSection: section,
        sourceLevel: null,
      });
    }
  }

  await db.insert(examBlueprintTemplateRows).values(values);
  return values.length;
}

/** Seeds one UNCP track's Anexo 7 rows (transcribed verbatim in `UNCP_ANEXO7`). */
async function seedUncpBlueprintRows(templateId: string, rows: readonly UncpAnexo7Row[]): Promise<number> {
  if (await templateHasRows(templateId)) {
    return 0;
  }

  const values: Array<{
    templateId: string;
    courseId: string;
    topicId: null;
    questionCount: number;
    weightPoints: string;
    examSection: string;
    sourceLevel: string;
  }> = [];

  for (const row of rows) {
    const courseId = await getCourseId(row.courseName);
    values.push({
      templateId,
      courseId,
      topicId: null,
      questionCount: row.questionCount,
      weightPoints: row.weightPoints.toFixed(3),
      examSection: row.examSection,
      sourceLevel: row.sourceLevel,
    });
  }

  await db.insert(examBlueprintTemplateRows).values(values);
  return values.length;
}

/**
 * Seeds `syllabus_week_maps` for the UNI preuniversitario template from
 * `data/uni-preuniversitario-syllabus.json` (design doc §4). Each JSON
 * course entry lists only the weeks that got a real topic mapping; skipped
 * weeks (práctica calificada, repaso, content already covered by another
 * week's topic, etc.) live in that same file's `skipped` array per course,
 * for audit — they are intentionally not inserted anywhere.
 */
async function seedUniSyllabusWeekMaps(templateId: string): Promise<number> {
  const file = JSON.parse(readFileSync(UNI_SYLLABUS_PATH, "utf8")) as UniSyllabusFile;
  let count = 0;

  for (const course of file.courses) {
    const courseId = await getCourseId(course.courseName);
    for (const weekEntry of course.weeks) {
      for (const topicName of weekEntry.topics) {
        const topicId = await ensureTopic(courseId, topicName, "pre");
        await db
          .insert(syllabusWeekMaps)
          .values({ templateId, courseId, topicId, weekNumber: weekEntry.week })
          .onConflictDoNothing({ target: [syllabusWeekMaps.templateId, syllabusWeekMaps.topicId] });
        count += 1;
      }
    }
  }

  return count;
}

/**
 * Orchestrates phase-2 seeding (design doc §4): 1 UNI template (Ciclo
 * Preuniversitario, the only UNI track with full syllabus data — see task
 * notes) + 5 UNCP templates (áreas I-V), their blueprint rows, and UNI's
 * week-by-week syllabus maps. UNCP gets no `syllabus_week_maps` — confirmed
 * no public cronograma exists (design doc §2, §8).
 */
async function seedExamBlueprintData(): Promise<void> {
  const uniTemplateId = await seedExamBlueprintTemplate("uni", "preuniversitario", "2026-2");
  await seedUniBlueprintRows(uniTemplateId);
  await seedUniSyllabusWeekMaps(uniTemplateId);

  for (const [trackCode, rows] of Object.entries(UNCP_ANEXO7)) {
    const templateId = await seedExamBlueprintTemplate("uncp", trackCode, "2026-II");
    await seedUncpBlueprintRows(templateId, rows);
  }
}

/**
 * Seeds the single confirmed UNI cycle: Ciclo Preuniversitario 2026-2,
 * `starts_on` from the official CEPRE-UNI cronograma — the "INICIO DE
 * CLASES" date for that cycle, quoted verbatim in the cached research
 * (design doc §8). Global default (`tenant_id = NULL`), so every tenant
 * sees it unless they insert their own override row.
 *
 * No UNCP cycle is seeded here on purpose. CEPRUNC has zero
 * `syllabus_week_maps` rows (confirmed absent after two research passes —
 * design doc §2, §8), so "current week" has no functional consumer for any
 * UNCP track yet. Inventing a `starts_on` for UNCP would be exactly the
 * fabricated precision the design doc warns against (§3.6's spirit: don't
 * persist a number you don't actually have) — better to leave it unseeded
 * until a real cronograma shows up or someone configures it manually.
 */
async function seedCycle(): Promise<void> {
  const [university] = await db
    .select({ id: universities.id })
    .from(universities)
    .where(eq(universities.code, "uni"));
  if (!university) {
    throw new Error(`Seed invariant violated: university 'uni' missing`);
  }

  const [track] = await db
    .select({ id: tracks.id })
    .from(tracks)
    .where(and(eq(tracks.universityId, university.id), eq(tracks.code, "preuniversitario")));
  if (!track) {
    throw new Error(`Seed invariant violated: track 'preuniversitario' missing for university 'uni'`);
  }

  const [existing] = await db
    .select({ id: cycles.id })
    .from(cycles)
    .where(
      and(
        isNull(cycles.tenantId),
        eq(cycles.universityId, university.id),
        eq(cycles.trackId, track.id),
        eq(cycles.isActive, true),
      ),
    );
  if (existing) {
    return;
  }

  await db.insert(cycles).values({
    tenantId: null,
    universityId: university.id,
    trackId: track.id,
    label: "Ciclo Preuniversitario 2026-2",
    startsOn: new Date("2026-03-05"),
    weekLengthDays: 7,
    isActive: true,
  });
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
