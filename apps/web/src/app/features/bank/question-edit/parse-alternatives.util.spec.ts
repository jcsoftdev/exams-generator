import { describe, it, expect } from 'vitest';
import { parseAlternativesList } from './parse-alternatives.util';

describe('parseAlternativesList', () => {
  it('splits on newlines and trims each line', () => {
    expect(parseAlternativesList('  4\n 3\n5 \n6')).toEqual(['4', '3', '5', '6']);
  });

  it('drops empty lines', () => {
    expect(parseAlternativesList('a\n\n\nb\n')).toEqual(['a', 'b']);
  });

  it('returns an empty array for blank input', () => {
    expect(parseAlternativesList('')).toEqual([]);
    expect(parseAlternativesList('   \n  \n')).toEqual([]);
  });
});
