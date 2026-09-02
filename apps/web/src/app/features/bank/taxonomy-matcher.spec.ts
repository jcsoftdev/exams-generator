import { describe, it, expect } from 'vitest';
import { Course, Topic } from '../taxonomy/taxonomy.models';
import {
  CORRECT_ANSWER_LETTERS,
  correctAnswerLetterToIndex,
  findCourseMatch,
  findTopicMatch,
  indexToCorrectAnswerLetter,
  normalizeForMatch,
} from './taxonomy-matcher';

describe('normalizeForMatch', () => {
  it('strips diacritics, lowercases and trims', () => {
    expect(normalizeForMatch('  Matemática  ')).toBe('matematica');
  });

  it('leaves an already-normalized value unchanged', () => {
    expect(normalizeForMatch('algebra')).toBe('algebra');
  });
});

describe('indexToCorrectAnswerLetter', () => {
  it('converts a 0-based index string to its letter', () => {
    expect(indexToCorrectAnswerLetter('0')).toBe('a');
    expect(indexToCorrectAnswerLetter('2')).toBe('c');
  });

  it('returns an empty string for null (B1: no clave read from the photo)', () => {
    expect(indexToCorrectAnswerLetter(null)).toBe('');
  });

  it('falls back to the raw index when it is out of the a-e range', () => {
    expect(indexToCorrectAnswerLetter('9')).toBe('9');
  });
});

describe('correctAnswerLetterToIndex', () => {
  it('converts a letter to its 0-based index string, case/whitespace-insensitive', () => {
    expect(correctAnswerLetterToIndex(' B ')).toBe('1');
    expect(correctAnswerLetterToIndex('e')).toBe('4');
  });

  it('falls back to the raw letter when it is not a recognized a-e letter', () => {
    expect(correctAnswerLetterToIndex('z')).toBe('z');
  });

  it('round-trips with indexToCorrectAnswerLetter for every recognized letter', () => {
    for (const letter of CORRECT_ANSWER_LETTERS) {
      expect(indexToCorrectAnswerLetter(correctAnswerLetterToIndex(letter))).toBe(letter);
    }
  });
});

describe('findCourseMatch', () => {
  const courses: Course[] = [
    { id: 'c1', name: 'Matemática', stage: 'preuniversitario' },
    { id: 'c2', name: 'Comunicación', stage: 'preuniversitario' },
  ];

  it('matches a course by exact normalized name', () => {
    expect(findCourseMatch(courses, 'matematica')?.id).toBe('c1');
  });

  it('returns undefined when the guess is undefined', () => {
    expect(findCourseMatch(courses, undefined)).toBeUndefined();
  });

  it('returns undefined when nothing matches (no partial/substring match)', () => {
    expect(findCourseMatch(courses, 'Biología')).toBeUndefined();
  });
});

describe('findTopicMatch', () => {
  const topics: Topic[] = [
    { id: 't1', name: 'sintaxis - complementos oracionales (complemento agente)', courseId: 'c1' },
  ];

  it('matches by exact normalized name', () => {
    expect(
      findTopicMatch(topics, 'sintaxis - complementos oracionales (complemento agente)')?.id,
    ).toBe('t1');
  });

  it('matches when the guess is a substring of the topic name', () => {
    expect(findTopicMatch(topics, 'complemento agente')?.id).toBe('t1');
  });

  it('matches when the topic name is a substring of the guess', () => {
    expect(
      findTopicMatch(topics, 'sintaxis - complementos oracionales (complemento agente), unidad 3')
        ?.id,
    ).toBe('t1');
  });

  it('returns undefined when the guess is undefined', () => {
    expect(findTopicMatch(topics, undefined)).toBeUndefined();
  });

  it('returns undefined when nothing matches', () => {
    expect(findTopicMatch(topics, 'geometría analítica')).toBeUndefined();
  });
});
