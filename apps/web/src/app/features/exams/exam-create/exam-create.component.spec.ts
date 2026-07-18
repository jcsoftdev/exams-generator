import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { ExamCreateComponent } from './exam-create.component';
import { ExamBlueprintComponent } from '../exam-blueprint/exam-blueprint.component';
import { ExamReviewComponent } from '../exam-review/exam-review.component';
import type { CreateExamResult } from '../exams.models';

const EXAM: CreateExamResult = { id: 'exam-1', status: 'draft', selectedQuestionIds: ['q1'] };

@Component({ selector: 'app-exam-blueprint', template: '<button data-testid="stub-create" (click)="examCreated.emit(exam)">create</button>' })
class StubBlueprintComponent {
  @Output() examCreated = new EventEmitter<CreateExamResult>();
  exam = EXAM;
}

@Component({ selector: 'app-exam-review', template: '<p data-testid="stub-review">reviewing {{ exam.id }}</p>' })
class StubReviewComponent {
  @Input() exam!: CreateExamResult;
}

function setup() {
  TestBed.configureTestingModule({ imports: [ExamCreateComponent] });
  TestBed.overrideComponent(ExamCreateComponent, {
    remove: { imports: [ExamBlueprintComponent, ExamReviewComponent] },
    add: { imports: [StubBlueprintComponent, StubReviewComponent] },
  });

  const fixture = TestBed.createComponent(ExamCreateComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled };
}

describe('ExamCreateComponent', () => {
  it('shows the blueprint builder first', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="stub-create"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="stub-review"]')).toBeFalsy();
  });

  it('switches to the review screen once the blueprint emits examCreated', () => {
    const { compiled, fixture } = setup();

    compiled.querySelector<HTMLButtonElement>('[data-testid="stub-create"]')!.click();
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="stub-create"]')).toBeFalsy();
    expect(compiled.querySelector('[data-testid="stub-review"]')!.textContent).toContain('exam-1');
  });
});
