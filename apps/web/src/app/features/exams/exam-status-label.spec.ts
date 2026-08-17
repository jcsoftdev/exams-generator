import { examStatusLabel } from './exam-status-label';

describe('examStatusLabel', () => {
  it('calls a draft exam "Borrador"', () => {
    expect(examStatusLabel('draft', 0)).toBe('Borrador');
  });

  it('still calls it "Borrador" even if forms somehow exist', () => {
    expect(examStatusLabel('draft', 2)).toBe('Borrador');
  });

  it('calls a confirmed exam with no forms "Listo", not "Generado"', () => {
    expect(examStatusLabel('ready', 0)).toBe('Listo');
  });

  it('calls a confirmed exam with forms "Generado"', () => {
    expect(examStatusLabel('ready', 2)).toBe('Generado');
  });

  it('falls back to "Listo" when the form count is unknown, never claiming PDFs exist', () => {
    expect(examStatusLabel('ready', undefined)).toBe('Listo');
  });

  it('uses the masculine form — the noun is "examen"', () => {
    expect(examStatusLabel('ready', 0)).not.toBe('Lista');
  });
});
