import { Difficulty } from '@exams-generator/shared';
import { BankQuestion, questionOrigin } from './bank.models';

function question(overrides: Partial<BankQuestion>): BankQuestion {
  return {
    id: 'q1',
    tenantId: 't1',
    courseId: 'c1',
    topicId: 'tp1',
    difficulty: Difficulty.Easy,
    gradeLevel: 'pre',
    correctAnswer: 'a',
    type: 'image',
    status: 'approved',
    imageAssetId: null,
    bodyTypst: null,
    alternatives: null,
    figureCode: null,
    sourceName: null,
    aiGenerated: false,
    usedInExamCount: 0,
    folderId: null,
    ...overrides,
  };
}

describe('questionOrigin', () => {
  it('calls a question with no tenant central', () => {
    expect(questionOrigin(question({ tenantId: null }))).toBe('central');
  });

  it("calls a tenant's AI-authored question ai", () => {
    // This branch was unreachable before: the UI read an `origin` field the
    // API never sent, so the "IA" chip could not render (audit M13).
    expect(questionOrigin(question({ tenantId: 't1', aiGenerated: true }))).toBe('ai');
  });

  it("calls a tenant's own question school", () => {
    expect(questionOrigin(question({ tenantId: 't1', aiGenerated: false }))).toBe('school');
  });

  it('treats central as central even when the AI wrote it — ownership decides, not authorship', () => {
    expect(questionOrigin(question({ tenantId: null, aiGenerated: true }))).toBe('central');
  });
});
