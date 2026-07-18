import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { Difficulty } from '@exams-generator/shared';
import { BankListComponent } from './bank-list.component';
import { BankService } from '../bank.service';
import { BankQuestion } from '../bank.models';

const QUESTIONS: BankQuestion[] = [
  {
    id: 'q1',
    tenantId: null,
    courseId: 'course-1',
    topicId: 'topic-1',
    difficulty: Difficulty.Easy,
    gradeLevel: 'primaria_1',
    correctAnswer: 'a',
    imageAssetId: 'asset-1',
  },
  {
    id: 'q2',
    tenantId: 'tenant-1',
    courseId: 'course-2',
    topicId: 'topic-2',
    difficulty: Difficulty.Hard,
    gradeLevel: 'secundaria_5',
    correctAnswer: 'b',
    imageAssetId: null,
  },
];

function setup(listQuestionsImpl: (...args: unknown[]) => unknown) {
  const listQuestions = vi.fn(listQuestionsImpl);
  const buildImageAssetUrl = vi.fn((id: string) => `http://api.test/assets/${id}`);

  TestBed.configureTestingModule({
    imports: [BankListComponent],
    providers: [{ provide: BankService, useValue: { listQuestions, buildImageAssetUrl } }],
  });

  const fixture = TestBed.createComponent(BankListComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, listQuestions, buildImageAssetUrl };
}

describe('BankListComponent', () => {
  it('loads and renders questions on init', () => {
    const { compiled, listQuestions } = setup(() => of(QUESTIONS));

    expect(listQuestions).toHaveBeenCalledWith({});
    const items = compiled.querySelectorAll('[data-testid="bank-question"]');
    expect(items.length).toBe(2);
  });

  it('renders an image for questions that have an imageAssetId, using BankService.buildImageAssetUrl', () => {
    const { compiled, buildImageAssetUrl } = setup(() => of(QUESTIONS));

    expect(buildImageAssetUrl).toHaveBeenCalledWith('asset-1');
    const images = compiled.querySelectorAll('img');
    expect(images.length).toBe(1);
    expect(images[0].getAttribute('src')).toBe('http://api.test/assets/asset-1');
  });

  it('renders the correct answer and taxonomy for each question', () => {
    const { compiled } = setup(() => of(QUESTIONS));

    expect(compiled.textContent).toContain('a');
    expect(compiled.textContent).toContain('course-1');
    expect(compiled.textContent).toContain('topic-1');
    expect(compiled.textContent).toContain('easy');
    expect(compiled.textContent).toContain('primaria_1');
  });

  it('sends courseId/topicId/difficulty/gradeLevel filters when the filter form is submitted', () => {
    const { compiled, fixture, listQuestions } = setup(() => of(QUESTIONS));
    listQuestions.mockClear();

    const courseInput = compiled.querySelector<HTMLInputElement>('input[name="courseId"]')!;
    const topicInput = compiled.querySelector<HTMLInputElement>('input[name="topicId"]')!;
    const difficultySelect = compiled.querySelector<HTMLSelectElement>('select[name="difficulty"]')!;
    const gradeLevelSelect = compiled.querySelector<HTMLSelectElement>('select[name="gradeLevel"]')!;
    const form = compiled.querySelector('form')!;

    courseInput.value = 'course-9';
    courseInput.dispatchEvent(new Event('input'));
    topicInput.value = 'topic-9';
    topicInput.dispatchEvent(new Event('input'));
    difficultySelect.value = 'hard';
    difficultySelect.dispatchEvent(new Event('change'));
    gradeLevelSelect.value = 'pre';
    gradeLevelSelect.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    form.dispatchEvent(new Event('submit'));

    expect(listQuestions).toHaveBeenCalledWith({
      courseId: 'course-9',
      topicId: 'topic-9',
      difficulty: 'hard',
      gradeLevel: 'pre',
    });
  });

  it('shows an error message when the listing request fails', () => {
    const { compiled } = setup(() => throwError(() => new Error('boom')));

    expect(compiled.textContent).toMatch(/could not load/i);
  });
});
