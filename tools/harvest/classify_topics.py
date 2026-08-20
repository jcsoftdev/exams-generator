#!/usr/bin/env python3
"""Suggest a canonical course + topic for a harvested question.

Hand-mapping every question of a 100-question exam does not scale across the
dozen solucionarios we harvest, so this proposes the taxonomy slot from the
statement's vocabulary. It is a suggestion, not a verdict: the caller prints the
assignments and a human scans them before the lot is seeded.

Rules are ordered — the first matching pattern wins — so put the specific
vocabulary ("efecto fotoeléctrico") above the generic one ("energía").
"""
from __future__ import annotations

import re
import unicodedata

# course -> [(regex, canonical topic name)], most specific first.
RULES: dict[str, list[tuple[str, str]]] = {
    "Física": [
        (r"dimensionalmente|ecuacion dimensional|analisis dimensional|vector", "Análisis dimensional y vectorial"),
        (r"foton|fotoelectric|frecuencia umbral|trabajo de extraccion|nucleo atomico|"
         r"desintegra|relativi|cuantic|nm\b", "Física moderna"),
        (r"espejo|lente|refracci|indice de refraccion|imagen virtual", "Óptica geométrica"),
        (r"solenoide|campo magnetico|induccion magnetica|espira|flujo magnetico", "Magnetismo y electromagnetismo"),
        (r"circuito|resistencia de|resistencias|corriente que|fuerza electromotriz|amperi|voltaje|condensador", "Electrodinámica"),
        (r"carga electrica|campo electrico|potencial electrico|coulomb", "Electrostática"),
        (r"onda|oscila|pendulo|frecuencia angular|cuerda|sonido|armonic", "Oscilaciones y ondas mecánicas"),
        (r"ciclo termodinamic|maquina termica|entropia|gas ideal|isotermic|adiabatic", "Termodinámica"),
        (r"calor|temperatura|dilataci|termometro|caloria", "Temperatura, calorimetría y fenómenos térmicos"),
        (r"presion|densidad|sumergid|flota|empuje|hidrostatic|manometro", "Hidrostática"),
        (r"gravitacion|planeta|satelite|orbita", "Gravitación universal"),
        (r"trabajo|potencia|energia (cinetica|mecanica|potencial)|conservacion de la energia", "Trabajo, energía y potencia"),
        (r"equilibrio|momento de fuerza|torque|palanca", "Estática"),
        (r"fricci|rozamiento|fuerza|newton|masa .*acelera|tension", "Dinámica"),
        (r"velocidad|acelerac|proyectil|movimiento|rapidez|recorre", "Cinemática"),
    ],
    "Química": [
        (r"tabla periodica|grupo|periodo|electronegatividad", "Tabla periódica"),
        (r"numero atomico|configuracion electronica|orbital|isotopo|estructura atomica|ionizacion", "Estructura atómica"),
        (r"enlace|geometria molecular|polar|hibridacion", "Enlace químico"),
        (r"nomenclatura|nombre.*compuesto|acido .*nombrad|oxido de", "Nomenclatura inorgánica"),
        (r"estequiometr|balance|reaccion|combusti|rendimiento|agente oxidante|"
         r"estado de oxidacion|equilibrio quimico|constante de equilibrio", "Estequiometría y reacciones químicas"),
        (r"mol\b|masa molar|numero de avogadro|unidades quimicas", "Unidades químicas de masa"),
        (r"solubilidad|disolucion|molaridad|concentracion|solucion|coloide", "Soluciones"),
        (r"ph\b|acido|base|neutraliza|hidroxido", "Ácidos, bases y sales"),
        (r"celda|electroliti|electrolisis|potencial de reduccion|galvanic", "Electroquímica"),
        (r"alcohol|cetona|aldehido|amina|ester|acido carboxilic", "Funciones orgánicas oxigenadas y nitrogenadas"),
        (r"carbono|hidrocarburo|alcano|alqueno|benceno|isomer", "Química del carbono"),
        (r"contaminaci|efecto invernadero|lluvia acida|relave", "Contaminación ambiental y ecología aplicada"),
        (r"nanotecnolog|cristales liquidos|material(es)? modern|polimero", "Química aplicada: nanotecnología y materiales modernos"),
        (r"gas|liquido|solido|plasma|estado de agregacion|presion de vapor", "Estados de la materia"),
        (r"materia|energia|densidad", "Materia y energía"),
    ],
    "Aritmética": [
        (r"interes|descuento|capital|tasa nominal", "Interés y Descuento"),
        (r"probabilidad|combinaci|permutaci|al azar|aleatoriamente|variable aleatoria|"
         r"esperanza matematica", "Combinatoria y Probabilidad"),
        (r"promedio|mezcla|aleaci", "Promedios y Mezclas"),
        (r"regla de tres|porcentaje|descuento sucesivo|%", "Regla de Tres y Porcentajes"),
        (r"proporcional|magnitud", "Magnitudes Proporcionales"),
        (r"razon|proporcion", "Razones y Proporciones"),
        (r"mcd|mcm|primo|divisores|descomposicion canonica", "Números Primos, MCD y MCM"),
        (r"divisib|multiplo|resid", "Divisibilidad"),
        (r"base \d|sistema de numeracion|cifras", "Sistemas de Numeración"),
        (r"fraccion|decimal|periodic", "Números Racionales"),
        (r"conjunto", "Teoría de Conjuntos"),
        (r"media aritmetica|mediana|moda|frecuencia", "Estadística Descriptiva"),
    ],
    "Álgebra": [
        (r"matriz|matrices|determinante", "Matrices y Determinantes"),
        (r"programacion lineal|region admisible|minimizar|maximizar", "Programación Lineal"),
        (r"logaritm|exponente", "Teoría de Exponentes y Logaritmos"),
        (r"sucesion|serie|limite|suma finita|progresion", "Progresiones y Límites de Sucesiones"),
        (r"sistema de ecuaciones|sistema:", "Sistemas de Ecuaciones"),
        (r"inecuaci|valor absoluto|desigualdad|\bmayor que\b", "Inecuaciones y Valor Absoluto"),
        (r"ecuacion cuadratica|raices|ecuacion en", "Teoría de Ecuaciones"),
        (r"factoriza", "Factorización"),
        (r"polinomio|grado de", "Polinomios"),
        (r"proposicion|verdadera \(v\)|conjunto", "Lógica Proposicional y Teoría de Conjuntos"),
        (r"funcion|dominio|rango", "Funciones"),
        (r"complejo|imaginari", "Números Complejos"),
        (r"radical|racionaliza|fraccion algebraica", "Fracciones y Radicación Algebraica"),
    ],
    "Geometría": [
        (r"prisma|piramide|poliedro|hexaedro|cubo|tetraedro|diedro|plano", "Geometría del Espacio (Poliedros)"),
        (r"cilindro|cono|esfera|tronco de cono", "Cuerpos Redondos"),
        (r"circunferencia|circulo|tangencia|radio", "Circunferencia"),
        (r"area|region sombreada|superficie", "Áreas de Regiones Planas"),
        (r"poligono|hexagono|pentagono|cuadrilatero|trapecio|paralelogramo|diagonales", "Polígonos y Cuadriláteros"),
        (r"semejan|congruen", "Congruencia y Semejanza"),
        (r"teorema de|relaciones metricas|proporcionalidad", "Proporcionalidad y Relaciones Métricas"),
        (r"simetria|numero aureo|isoperim", "Isoperimetría, Número Áureo y Simetría"),
        (r"triangulo|mediatriz|bisectriz|altura", "Triángulos"),
        (r"angulo|segmento", "Segmentos y Ángulos"),
    ],
    "Trigonometría": [
        (r"arc (cos|sen|tan)|inversa", "Funciones Trigonométricas Inversas"),
        (r"elipse|parabola|hiperbola|excentricidad|conica", "Geometría Analítica: Cónicas"),
        (r"recta|pendiente|ecuacion de la recta", "Geometría Analítica: La Recta"),
        (r"identidad|simplifique|reduzca", "Identidades Trigonométricas"),
        (r"ecuacion trigonometric|resuelva.*sen|resuelva.*cos", "Ecuaciones e Inecuaciones Trigonométricas"),
        (r"circunferencia trigonometrica", "Circunferencia Trigonométrica"),
        (r"coterminal|sexagesimal|radian|sistema de medicion", "Ángulos y Sistemas de Medición Angular"),
        (r"grafica de y|periodo|amplitud|funcion (seno|coseno)", "Funciones Trigonométricas"),
        (r"cualquier angulo|cuadrante|reduccion al primer", "Razones Trigonométricas de Cualquier Ángulo"),
        (r"resolucion de triangulo|ley de senos|ley de cosenos|altura del|sombra", "Resolución de Triángulos"),
        (r"tan|sen|cos|cot|sec|csc", "Razones Trigonométricas"),
    ],
}

DEFAULT_TOPIC = {
    "Física": "Cinemática",
    "Química": "Materia y energía",
    "Aritmética": "Operaciones Fundamentales",
    "Álgebra": "Polinomios",
    "Geometría": "Triángulos",
    "Trigonometría": "Razones Trigonométricas",
}


def _fold(text: str) -> str:
    """Lowercase and strip accents so the rules can stay accent-free."""
    stripped = unicodedata.normalize("NFD", text.lower())
    return "".join(c for c in stripped if unicodedata.category(c) != "Mn")


# A UNI "Matemática" block mixes four courses, so the course has to be inferred
# before the topic. Ordered: whichever vocabulary appears first decides.
MATH_COURSE_RULES: list[tuple[str, str]] = [
    (r"sen |cos |tan |cot |sec |csc |trigonometric|radian|sexagesimal|arc (cos|sen|tan)", "Trigonometría"),
    # Deliberately narrow: "área", "plano" and "región" also show up in linear
    # programming and analytic-geometry algebra, which are not Geometría here.
    (r"triangulo|circunferencia|poligono|hexagono|prisma|piramide|cilindro|cono|esfera|"
     r"trapecio|paralelogramo|bisectriz|mediatriz|apotema|diedro|perimetro|"
     r"angulo (interior|central|obtuso|agudo)|area (del|de la) (triangulo|region sombreada|circulo)", "Geometría"),
    (r"matriz|matrices|determinante|polinomio|ecuacion|inecuacion|logaritm|funcion|"
     r"sucesion|serie|limite|programacion lineal|proposicion|raices|sistema", "Álgebra"),
    (r"variable aleatoria|esperanza matematica|"
     r"divisib|mcd|mcm|primo|cifras|fraccion|porcentaje|interes|probabilidad|promedio|"
     r"proporcional|razon|conjunto|numero(s)? de tres cifras", "Aritmética"),
]


def classify_course(statement: str, fallback: str = "Álgebra") -> str:
    """Course for a question that arrives inside a mixed "Matemática" block."""
    folded = _fold(statement)
    for pattern, course in MATH_COURSE_RULES:
        if re.search(pattern, folded):
            return course
    return fallback


def classify(course: str, statement: str) -> str:
    """Canonical topic for `statement` within `course`."""
    folded = _fold(statement)
    for pattern, topic in RULES.get(course, []):
        if re.search(pattern, folded):
            return topic
    return DEFAULT_TOPIC.get(course, "")


if __name__ == "__main__":
    import json
    import sys

    data = json.load(open(sys.argv[1]))
    course = sys.argv[2]
    for section in data["sections"]:
        for q in section["questions"]:
            body = " ".join(q["body"].split())
            print(f"{q['n']:3d} {classify(course, body):<45} {body[:70]}")
