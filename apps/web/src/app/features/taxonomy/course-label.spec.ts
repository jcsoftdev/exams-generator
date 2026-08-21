import { courseLabels } from './course-label';

describe('courseLabels', () => {
  it('leaves a unique course name exactly as it is', () => {
    const labels = courseLabels([
      { id: 'a', name: 'Álgebra', stage: 'preuniversitario' },
      { id: 'b', name: 'Química', stage: 'colegio' },
    ]);

    expect(labels.get('a')).toBe('Álgebra');
    expect(labels.get('b')).toBe('Química');
  });

  it('adds the stage only to the names that repeat', () => {
    // Audit 2026-08-20 M2: "Comunicación" ×3 in the bank tree, no way to tell which is which.
    const labels = courseLabels([
      { id: '1', name: 'Comunicación', stage: 'escuela' },
      { id: '2', name: 'Comunicación', stage: 'colegio' },
      { id: '3', name: 'Comunicación', stage: 'preuniversitario' },
      { id: '4', name: 'Geometría', stage: 'preuniversitario' },
    ]);

    expect(labels.get('1')).toBe('Comunicación · Escuela');
    expect(labels.get('2')).toBe('Comunicación · Colegio');
    expect(labels.get('3')).toBe('Comunicación · Preuniversitario');
    expect(labels.get('4')).toBe('Geometría');
  });

  it('treats names differing only in case or spacing as the same name', () => {
    const labels = courseLabels([
      { id: '1', name: 'Arte y Cultura', stage: 'colegio' },
      { id: '2', name: 'arte y cultura ', stage: 'escuela' },
    ]);

    expect(labels.get('1')).toBe('Arte y Cultura · Colegio');
    expect(labels.get('2')).toBe('arte y cultura · Escuela');
  });

  it('falls back to the raw stage code rather than dropping the distinction', () => {
    // A stage the frontend does not know about must still disambiguate.
    const labels = courseLabels([
      { id: '1', name: 'Comunicación', stage: 'colegio' },
      { id: '2', name: 'Comunicación', stage: 'posgrado' },
    ]);

    expect(labels.get('2')).toBe('Comunicación · posgrado');
  });

  it('returns an empty map for an empty catalog', () => {
    expect(courseLabels([]).size).toBe(0);
  });
});
