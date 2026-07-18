import { describe, it, expect } from 'vitest';
import { Role, Difficulty } from '@exams-generator/shared';

describe('packages/shared path mapping (web)', () => {
  it('resolves the Role enum via @exams-generator/shared', () => {
    expect(Role.SchoolAdmin).toBe('school_admin');
  });

  it('resolves the Difficulty enum via @exams-generator/shared', () => {
    expect(Difficulty.Hard).toBe('hard');
  });
});
