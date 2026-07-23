import { describe, it, expect } from 'vitest';
import { Role } from '@exams-generator/shared';
import { EXAMS_ROLES } from './exams.roles';

describe('EXAMS_ROLES', () => {
  it('matches the backend exams controller role gate (Teacher, SchoolAdmin)', () => {
    expect(EXAMS_ROLES).toEqual([Role.Teacher, Role.SchoolAdmin]);
  });
});
