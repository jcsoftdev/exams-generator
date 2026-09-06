import {
  BookOpen,
  Church,
  Dumbbell,
  FlaskConical,
  Globe,
  HelpCircle,
  Landmark,
  Languages,
  Laptop,
  Music,
  Palette,
  Sigma,
} from 'lucide-angular';

/**
 * Every icon a card can end up drawing, ready for `LucideAngularModule.pick()`.
 * A glyph that is returned but not registered renders as nothing at all, so the
 * mapping and the registration are kept in one place — there is a test pinning
 * that they agree.
 */
export const GLYPH_ICONS = {
  BookOpen,
  Church,
  Dumbbell,
  FlaskConical,
  Globe,
  HelpCircle,
  Landmark,
  Languages,
  Laptop,
  Music,
  Palette,
  Sigma,
};

/**
 * Which glyph a folder wears, read off its name.
 *
 * The bank grid deliberately has no folder icons: the teacher is looking for a
 * subject, not for file-manager furniture, so the tile has to say "this is
 * maths" before she reads a word. Folders are seeded from the course and topic
 * taxonomy and then renamed freely by the school, which is why this matches on
 * WORDS rather than on `topicId` — "Álgebra 3° B" is still maths, and no id
 * survives a teacher renaming it.
 *
 * ORDER MATTERS. The first rule that matches wins, which is what keeps
 * "Educación Física" a dumbbell instead of a laboratory flask, "Ciencias
 * Sociales" a landmark instead of a flask, and "Ciencia y Tecnología" a flask
 * instead of a laptop.
 */
const RULES: readonly { readonly icon: string; readonly words: readonly string[] }[] = [
  {
    icon: 'sigma',
    words: ['matemat', 'algebra', 'aritmet', 'geometr', 'trigonom', 'calculo', 'estadist'],
  },
  { icon: 'dumbbell', words: ['educacion fisica', 'deporte', 'psicomotr'] },
  { icon: 'landmark', words: ['historia', 'civic', 'ciudadan', 'sociales'] },
  { icon: 'flask-conical', words: ['ciencia', 'quimic', 'biolog', 'naturales', 'fisica', 'anatom'] },
  { icon: 'laptop', words: ['computac', 'informat', 'tecnolog', 'robotic'] },
  { icon: 'globe', words: ['geograf', 'ambiente', 'ecolog'] },
  { icon: 'languages', words: ['ingles', 'idioma', 'quechua', 'frances'] },
  { icon: 'palette', words: ['arte', 'dibujo', 'plastic'] },
  { icon: 'music', words: ['music'] },
  { icon: 'church', words: ['religio', 'catequesis'] },
];

/** What an unrecognised folder wears — still a subject glyph, never a folder. */
const FALLBACK_GLYPH = 'book-open';

export function glyphFor(name: string): string {
  const haystack = normalizeName(name);
  for (const rule of RULES) {
    if (rule.words.some((word) => haystack.includes(word))) {
      return rule.icon;
    }
  }
  return FALLBACK_GLYPH;
}

/** Teachers type "matematica", "MATEMÁTICA" and "Matemática 1° B" for the same subject. */
function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}
