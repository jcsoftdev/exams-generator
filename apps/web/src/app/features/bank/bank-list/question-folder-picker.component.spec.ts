import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { Subject, of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { LucideAngularModule, ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-angular';
import { BankFolderNode, Difficulty, UNFILED_FOLDER_ID } from '@exams-generator/shared';
import { QuestionFolderPickerComponent } from './question-folder-picker.component';
import { BankService } from '../bank.service';
import { BankFoldersStore } from '../folders/bank-folders.store';
import { BankQuestion } from '../bank.models';

/** Mirrors the tree `bank-list.component.spec.ts` uses — same ids/names, so `folderName('trigo')` resolves the same "Trigonometría" label. */
const FOLDERS: BankFolderNode[] = [
  {
    id: 'colegio',
    name: 'Colegio',
    parentId: null,
    topicId: null,
    position: 0,
    ownCount: 0,
    centralCount: 0,
    children: [
      {
        id: 'trigo',
        name: 'Trigonometría',
        parentId: 'colegio',
        topicId: 't1',
        position: 0,
        ownCount: 7,
        centralCount: 30,
        children: [],
      },
    ],
  },
];

function makeQuestion(o: Partial<BankQuestion> & { id: string }): BankQuestion {
  return {
    id: o.id,
    tenantId: o.tenantId === undefined ? 't1' : o.tenantId,
    courseId: o.courseId ?? 'c1',
    topicId: o.topicId ?? 't1',
    difficulty: o.difficulty ?? Difficulty.Easy,
    gradeLevel: o.gradeLevel ?? 'pre',
    correctAnswer: o.correctAnswer ?? 'a',
    imageAssetId: o.imageAssetId ?? null,
    status: o.status ?? 'approved',
    type: o.type ?? 'image',
    usedInExamCount: o.usedInExamCount ?? 0,
    bodyTypst: o.bodyTypst ?? null,
    alternatives: o.alternatives ?? null,
    sourceName: o.sourceName ?? null,
    figureCode: o.figureCode ?? null,
    aiGenerated: o.aiGenerated ?? false,
    folderId: o.folderId === undefined ? 'trigo' : o.folderId,
  };
}

@Component({
  standalone: true,
  imports: [QuestionFolderPickerComponent],
  template: `
    <app-question-folder-picker
      [question]="question()"
      (moved)="lastMoved = $event"
    ></app-question-folder-picker>
  `,
})
class HostComponent {
  readonly question = signal<BankQuestion>(makeQuestion({ id: 'q1' }));
  lastMoved: BankQuestion | null = null;
}

function setup(
  over: {
    updateQuestionImpl?: (id: string, patch: unknown) => unknown;
    unfiledCount?: number;
  } = {},
) {
  const updateQuestion = vi.fn(
    over.updateQuestionImpl ??
      ((id: string, patch: { folderId?: string | null }) =>
        of(makeQuestion({ id, folderId: patch.folderId ?? null }))),
  );
  const getFolders = vi.fn(() => of({ folders: FOLDERS, unfiledCount: over.unfiledCount ?? 4 }));

  TestBed.configureTestingModule({
    imports: [
      HostComponent,
      LucideAngularModule.pick({ ChevronDown, ChevronRight, MoreHorizontal }),
    ],
    providers: [{ provide: BankService, useValue: { updateQuestion, getFolders } }],
  });

  // `QuestionFolderPickerComponent` never calls `load()` itself — in the real
  // app `bank-list`'s own constructor already primed this (root-provided)
  // store by the time this component ever mounts. Mirror that here.
  TestBed.inject(BankFoldersStore).load();

  const fixture = TestBed.createComponent(HostComponent);
  const host = fixture.componentInstance;
  fixture.detectChanges();

  return {
    fixture,
    host,
    compiled: fixture.nativeElement as HTMLElement,
    updateQuestion,
    getFolders,
  };
}

function openPicker(compiled: HTMLElement, fixture: { detectChanges(): void }): void {
  (
    compiled.querySelector('[data-testid="question-folder-edit"] button') as HTMLButtonElement
  ).click();
  fixture.detectChanges();
}

function pickFolder(
  compiled: HTMLElement,
  fixture: { detectChanges(): void },
  folderId: string,
): void {
  (
    compiled.querySelector(
      `[data-testid="question-folder-picker"] [data-folder-id="${folderId}"]`,
    ) as HTMLElement
  ).click();
  fixture.detectChanges();
}

function saveFolder(compiled: HTMLElement, fixture: { detectChanges(): void }): void {
  (
    compiled.querySelector('[data-testid="question-folder-save"] button') as HTMLButtonElement
  ).click();
  fixture.detectChanges();
}

describe('QuestionFolderPickerComponent', () => {
  it('shows the current folder name', () => {
    const { compiled, host, fixture } = setup();
    host.question.set(makeQuestion({ id: 'q1', folderId: 'trigo' }));
    fixture.detectChanges();

    expect(compiled.textContent).toContain('Trigonometría');
  });

  it('shows "Sin carpeta" for an unfiled question', () => {
    const { compiled, host, fixture } = setup();
    host.question.set(makeQuestion({ id: 'q1', folderId: null }));
    fixture.detectChanges();

    expect(compiled.textContent).toContain('Sin carpeta');
  });

  it('opens the popover in `pick` mode — no folder actions render', () => {
    const { compiled, fixture } = setup();
    openPicker(compiled, fixture);

    const picker = compiled.querySelector('[data-testid="question-folder-picker"]');
    expect(picker).toBeTruthy();
    expect(picker!.querySelector('ui-folder-tree')).toBeTruthy();
    expect(picker!.querySelector('[data-testid="folder-menu"]')).toBeNull();
  });

  it('has an id on the popover matched by aria-controls on the trigger', () => {
    const { compiled, fixture } = setup();
    const trigger = compiled.querySelector(
      '[data-testid="question-folder-edit"] button',
    ) as HTMLButtonElement;
    openPicker(compiled, fixture);

    const picker = compiled.querySelector('[data-testid="question-folder-picker"]') as HTMLElement;
    expect(picker.id).toBeTruthy();
    expect(trigger.getAttribute('aria-controls')).toBe(picker.id);
  });

  it('PATCHes with the picked folder', () => {
    const { compiled, host, fixture, updateQuestion } = setup();
    host.question.set(makeQuestion({ id: 'q1', folderId: null }));
    fixture.detectChanges();

    openPicker(compiled, fixture);
    pickFolder(compiled, fixture, 'colegio');
    saveFolder(compiled, fixture);

    expect(updateQuestion).toHaveBeenCalledWith('q1', { folderId: 'colegio' });
  });

  it('sends folderId: null when the virtual "Sin carpeta" node is picked', () => {
    const { compiled, fixture, updateQuestion } = setup();
    openPicker(compiled, fixture);
    pickFolder(compiled, fixture, UNFILED_FOLDER_ID);
    saveFolder(compiled, fixture);

    expect(updateQuestion).toHaveBeenCalledWith('q1', { folderId: null });
  });

  it('closes the popover and emits `moved` with the updated record on success', () => {
    const updated = makeQuestion({ id: 'q1', folderId: 'colegio' });
    const { compiled, host, fixture } = setup({ updateQuestionImpl: () => of(updated) });

    openPicker(compiled, fixture);
    pickFolder(compiled, fixture, 'colegio');
    saveFolder(compiled, fixture);

    expect(compiled.querySelector('[data-testid="question-folder-picker"]')).toBeNull();
    expect(host.lastMoved).toEqual(updated);
  });

  it('surfaces the server error inside the popover and keeps it open', () => {
    const { compiled, fixture } = setup({
      updateQuestionImpl: () =>
        throwError(
          () =>
            new HttpErrorResponse({
              status: 404,
              error: {
                statusCode: 404,
                code: 'folder_not_found',
                message: 'La carpeta no existe.',
              },
            }),
        ),
    });
    openPicker(compiled, fixture);
    pickFolder(compiled, fixture, 'colegio');
    saveFolder(compiled, fixture);

    expect(compiled.querySelector('[data-testid="question-folder-picker"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="question-folder-error"]')!.textContent).toContain(
      'La carpeta no existe.',
    );
    // Never applied locally — the label is derived purely from the `question` input.
    expect(compiled.textContent).toContain('Trigonometría');
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const { compiled, fixture } = setup();
    const trigger = compiled.querySelector(
      '[data-testid="question-folder-edit"] button',
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    compiled
      .querySelector('[data-testid="question-folder-picker"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="question-folder-picker"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('resets — closes, drops the choice and any error — when the input question changes', () => {
    const { compiled, host, fixture } = setup();
    openPicker(compiled, fixture);
    expect(compiled.querySelector('[data-testid="question-folder-picker"]')).toBeTruthy();

    host.question.set(makeQuestion({ id: 'q2', folderId: 'colegio' }));
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="question-folder-picker"]')).toBeNull();
  });

  it('ignores a stale success response for a question the input has already moved past, but still emits `moved`', () => {
    const pending = new Subject<BankQuestion>();
    const { compiled, host, fixture } = setup({ updateQuestionImpl: () => pending });

    openPicker(compiled, fixture);
    pickFolder(compiled, fixture, 'colegio');
    saveFolder(compiled, fixture);

    // the teacher moves on to a different question before q1's save resolves
    host.question.set(makeQuestion({ id: 'q2', folderId: 'trigo' }));
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="question-folder-picker"]')).toBeNull();

    const updated = makeQuestion({ id: 'q1', folderId: 'colegio' });
    pending.next(updated);
    pending.complete();
    fixture.detectChanges();

    // still closed — the stale response must not reopen/resurface anything for q2
    expect(compiled.querySelector('[data-testid="question-folder-picker"]')).toBeNull();
    // but the parent still needs to know, to refresh the tree/list
    expect(host.lastMoved).toEqual(updated);
  });
});
