import { Component, EventEmitter, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { ExamCreateComponent } from './exam-create.component';
import { ExamBlueprintComponent } from '../exam-blueprint/exam-blueprint.component';
import type { CreateExamResult } from '../exams.models';

const EXAM: CreateExamResult = { id: 'exam-1', status: 'draft', selectedQuestionIds: ['q1'] };

@Component({ selector: 'app-exam-blueprint', template: '<button data-testid="stub-create" (click)="examCreated.emit(exam)">create</button>' })
class StubBlueprintComponent {
  @Output() examCreated = new EventEmitter<CreateExamResult>();
  exam = EXAM;
}

function setup() {
  const navigate = vi.fn();

  TestBed.configureTestingModule({
    imports: [ExamCreateComponent],
    providers: [{ provide: Router, useValue: { navigate } }],
  });
  TestBed.overrideComponent(ExamCreateComponent, {
    remove: { imports: [ExamBlueprintComponent] },
    add: { imports: [StubBlueprintComponent] },
  });

  const fixture = TestBed.createComponent(ExamCreateComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  return { fixture, compiled, navigate };
}

describe('ExamCreateComponent', () => {
  it('shows the blueprint builder', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="stub-create"]')).toBeTruthy();
  });

  it('navigates to the review route once the blueprint emits examCreated', () => {
    const { compiled, navigate } = setup();

    compiled.querySelector<HTMLButtonElement>('[data-testid="stub-create"]')!.click();

    expect(navigate).toHaveBeenCalledWith(['/app/exams', 'exam-1']);
  });
});
