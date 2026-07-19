import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { Difficulty } from '@exams-generator/shared';
import { DraftCountService } from './draft-count.service';
import { AiService } from './ai.service';
import { DraftQuestion } from './ai.models';

function draft(id: string): DraftQuestion {
  return {
    id,
    tenantId: 't1',
    courseId: 'c1',
    topicId: 't1',
    difficulty: Difficulty.Easy,
    gradeLevel: 'pre',
    correctAnswer: 'a',
    bodyTypst: '¿2+2?',
    alternatives: ['4', '3'],
    figureCode: null,
  };
}

function setup(listImpl?: () => unknown) {
  const listDrafts = vi.fn(listImpl ?? (() => of([draft('d1'), draft('d2')])));
  TestBed.configureTestingModule({
    providers: [{ provide: AiService, useValue: { listDrafts } }],
  });
  const service = TestBed.inject(DraftCountService);
  return { service, listDrafts };
}

describe('DraftCountService', () => {
  it('fetches the draft count once on construction', () => {
    const { service, listDrafts } = setup();
    expect(listDrafts).toHaveBeenCalledTimes(1);
    expect(service.count()).toBe(2);
  });

  it('leaves the count unset (null) if the initial fetch fails', () => {
    const { service } = setup(() => throwError(() => new Error('boom')));
    expect(service.count()).toBeNull();
  });

  it('allows the review queue to push a fresh count via set()', () => {
    const { service } = setup();
    service.set(5);
    expect(service.count()).toBe(5);
  });

  it('re-fetches the count via refresh()', () => {
    const { service, listDrafts } = setup();
    listDrafts.mockReturnValue(of([draft('d1')]));
    service.refresh();
    expect(listDrafts).toHaveBeenCalledTimes(2);
    expect(service.count()).toBe(1);
  });
});
