import { describe, it, expect } from 'vitest';
import { GLYPH_ICONS, glyphFor } from './folder-glyph';

describe('glyphFor', () => {
  it('gives each school subject a glyph of its own', () => {
    expect(glyphFor('Matemática')).toBe('sigma');
    expect(glyphFor('Comunicación')).toBe('book-open');
    expect(glyphFor('Ciencia y Tecnología')).toBe('flask-conical');
    expect(glyphFor('Historia del Perú')).toBe('landmark');
    expect(glyphFor('Inglés')).toBe('languages');
  });

  /** Folder names are typed by teachers: "matematica", "MATEMÁTICA", "Matemática 1". */
  it('ignores case, accents and whatever else is in the name', () => {
    expect(glyphFor('matematica')).toBe('sigma');
    expect(glyphFor('MATEMÁTICA')).toBe('sigma');
    expect(glyphFor('Matemática 1° secundaria')).toBe('sigma');
  });

  /** A subject reads by any of the words a school actually uses for it. */
  it('matches a subject by any of its words', () => {
    expect(glyphFor('Álgebra')).toBe('sigma');
    expect(glyphFor('Razonamiento matemático')).toBe('sigma');
    expect(glyphFor('Química')).toBe('flask-conical');
  });

  /**
   * The fallback is still a subject glyph, never a folder icon: the grid is a
   * bank of questions, and file-manager furniture is exactly what the redesign
   * took out.
   */
  it('falls back to a subject glyph for a name it does not know', () => {
    expect(glyphFor('Simulacros 2026')).toBe('book-open');
    expect(glyphFor('')).toBe('book-open');
  });

  /** Every glyph the mapping can return has to be registered, or the card renders nothing. */
  it('only returns icons the card registers', () => {
    const returned = new Set(
      ['Matemática', 'Comunicación', 'Ciencia', 'Historia', 'Inglés', 'Arte', 'Cualquier cosa'].map(
        glyphFor,
      ),
    );

    for (const icon of returned) {
      expect(Object.keys(GLYPH_ICONS)).toContain(toPascal(icon));
    }
  });
});

function toPascal(kebab: string): string {
  return kebab
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/** The real seeded catalog, where a word from two subjects meets one folder name. */
describe('glyphFor — the names the seeded catalog actually produces', () => {
  it('reads "Ciencias Sociales" as social studies, not as a laboratory', () => {
    expect(glyphFor('Ciencias Sociales')).toBe('landmark');
  });

  it('still reads "Ciencia y Tecnología" as a laboratory', () => {
    expect(glyphFor('Ciencia y Tecnología')).toBe('flask-conical');
  });

  it('reads "Educación Religiosa", not only the word "religión"', () => {
    expect(glyphFor('Educación Religiosa')).toBe('church');
  });

  it('keeps "Educación Física" a dumbbell', () => {
    expect(glyphFor('Educación Física')).toBe('dumbbell');
  });
});
