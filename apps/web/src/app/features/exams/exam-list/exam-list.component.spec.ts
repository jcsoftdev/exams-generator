import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { Router } from '@angular/router';
import { LucideAngularModule, Ellipsis, Plus, Check, ChevronDown } from 'lucide-angular';
import { ExamListComponent } from './exam-list.component';
import { ExamsService } from '../exams.service';
import { ExamListItem, ExamListResult, GRADE_LEVEL_LABELS } from '../exams.models';

function item(o: Partial<ExamListItem> & { id: string }): ExamListItem {
  return {
    id: o.id, title: o.title ?? 'Examen X', gradeLevel: o.gradeLevel ?? 'pre',
    status: o.status ?? 'ready', questionCount: o.questionCount ?? 10,
    versionCount: o.versionCount ?? 2, createdAt: o.createdAt ?? '2026-07-18T00:00:00.000Z',
  };
}
const RESULT: ExamListResult = { items: [item({ id: 'e1', status: 'ready' }), item({ id: 'e2', status: 'draft', title: 'Borrador Y' })], total: 2 };

function selectOption(container: HTMLElement, fixture: { detectChanges(): void }, label: string): void {
  (container.querySelector('button[role="combobox"]') as HTMLButtonElement).click();
  fixture.detectChanges();
  const option = Array.from(container.querySelectorAll('[data-testid="select-option"]')).find(
    (li) => li.textContent?.trim() === label,
  ) as HTMLElement | undefined;
  if (!option) {
    throw new Error(`option "${label}" not found`);
  }
  option.click();
  fixture.detectChanges();
}

function setup(over: { listImpl?: () => unknown; dupImpl?: () => unknown; delImpl?: () => unknown } = {}) {
  const listExams = vi.fn(over.listImpl ?? (() => of(RESULT)));
  const duplicateExam = vi.fn(over.dupImpl ?? (() => of({ id: 'e3', title: 'Copia de Examen X', status: 'draft' })));
  const deleteExam = vi.fn(over.delImpl ?? (() => of(void 0)));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [ExamListComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Ellipsis, Plus, Check, ChevronDown })),
      { provide: ExamsService, useValue: { listExams, duplicateExam, deleteExam } },
      { provide: Router, useValue: { navigate } },
    ],
  });
  const fixture = TestBed.createComponent(ExamListComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement, listExams, duplicateExam, deleteExam, navigate };
}

describe('ExamListComponent', () => {
  it('renders one row per exam with a status tag', () => {
    const { compiled } = setup();
    expect(compiled.querySelectorAll('[data-testid="exam-row"]').length).toBe(2);
    expect(compiled.querySelectorAll('[data-testid="tag"]').length).toBe(2);
  });

  it('opens the versions detail for a ready exam', () => {
    const { compiled, navigate } = setup();
    (compiled.querySelectorAll('[data-testid="exam-open"] button')[0] as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/app/exams', 'e1', 'versions']);
  });

  it('continues building a draft exam', () => {
    const { compiled, navigate } = setup();
    (compiled.querySelector('[data-testid="exam-continue"] button') as HTMLButtonElement).click();
    expect(navigate).toHaveBeenCalledWith(['/app/exams', 'e2']);
  });

  it('duplicates an exam and navigates to the new draft builder', () => {
    const { compiled, fixture, duplicateExam, navigate } = setup();
    (compiled.querySelectorAll('[data-testid="exam-menu"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="exam-duplicate"] button') as HTMLButtonElement).click();
    expect(duplicateExam).toHaveBeenCalledWith('e1');
    expect(navigate).toHaveBeenCalledWith(['/app/exams', 'e3']);
  });

  it('deletes a draft directly (no confirmation) and reloads', () => {
    const { compiled, fixture, deleteExam, listExams } = setup();
    (compiled.querySelectorAll('[data-testid="exam-menu"]')[1] as HTMLButtonElement).click(); // e2 draft
    fixture.detectChanges();
    listExams.mockClear();
    (compiled.querySelector('[data-testid="exam-delete"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(deleteExam).toHaveBeenCalledWith('e2');
    expect(listExams).toHaveBeenCalledTimes(1);
  });

  it('requires confirmation before deleting a ready exam', () => {
    const { compiled, fixture, deleteExam } = setup();
    (compiled.querySelectorAll('[data-testid="exam-menu"]')[0] as HTMLButtonElement).click(); // e1 ready
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="exam-delete"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(deleteExam).not.toHaveBeenCalled(); // abre modal, aún no borra
    expect(compiled.querySelector('[data-testid="delete-confirm"]')).toBeTruthy();
    (compiled.querySelector('[data-testid="delete-confirm-yes"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(deleteExam).toHaveBeenCalledWith('e1');
  });

  it('shows empty state when there are no exams', () => {
    const { compiled } = setup({ listImpl: () => of({ items: [], total: 0 }) });
    expect(compiled.querySelector('[data-testid="empty-exams"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/aún no tienes exámenes/i);
  });

  /**
   * Audit 2026-08-15: filtrar por Estado=Borrador sin coincidencias mostraba
   * "Aún no tienes exámenes. Crea el primero para empezar." teniendo 6
   * exámenes — el usuario cree que perdió su trabajo.
   */
  it('distinguishes "no matches for these filters" from "no exams at all"', () => {
    const { compiled, fixture, listExams } = setup();

    listExams.mockReturnValue(of({ items: [], total: 0 }));
    const container = compiled.querySelector('[data-testid="status-filter"]') as HTMLElement;
    selectOption(container, fixture, 'Borrador');

    expect(compiled.querySelector('[data-testid="empty-exams"]')).toBeFalsy();
    expect(compiled.querySelector('[data-testid="empty-filtered"]')).toBeTruthy();
    expect(compiled.textContent).toMatch(/no hay exámenes con estos filtros/i);
  });

  it('clears every filter and reloads from the filtered empty state', () => {
    const { compiled, fixture, listExams } = setup();

    listExams.mockReturnValue(of({ items: [], total: 0 }));
    selectOption(compiled.querySelector('[data-testid="status-filter"]') as HTMLElement, fixture, 'Borrador');
    listExams.mockClear();
    listExams.mockReturnValue(of(RESULT));

    (compiled.querySelector('[data-testid="clear-filters"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(listExams).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined, gradeLevel: undefined, search: undefined, page: 1 }),
    );
    expect(compiled.querySelectorAll('[data-testid="exam-row"]').length).toBeGreaterThan(0);
  });

  it('shows an error state with retry', () => {
    const { compiled, fixture, listExams } = setup({ listImpl: () => throwError(() => new HttpErrorResponse({ status: 500 })) });
    expect(compiled.querySelector('[data-testid="error-state"]')).toBeTruthy();
    listExams.mockClear();
    listExams.mockReturnValue(of(RESULT));
    (compiled.querySelector('[data-testid="retry-button"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(listExams).toHaveBeenCalledTimes(1);
  });

  it('reloads exams with the selected estado when the filter changes', () => {
    const { compiled, fixture, listExams } = setup();
    listExams.mockClear();
    const container = compiled.querySelector('[data-testid="status-filter"]') as HTMLElement;
    selectOption(container, fixture, 'Generado');
    expect(listExams).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'ready', page: 1, pageSize: 50 }),
    );
  });

  it('reloads exams with the selected grado when the filter changes', () => {
    const { compiled, fixture, listExams } = setup();
    listExams.mockClear();
    const container = compiled.querySelector('[data-testid="gradeLevel-filter"]') as HTMLElement;
    selectOption(container, fixture, GRADE_LEVEL_LABELS['secundaria_3']);
    expect(listExams).toHaveBeenCalledWith(
      expect.objectContaining({ gradeLevel: 'secundaria_3', page: 1, pageSize: 50 }),
    );
  });

  it('debounces the search box 300ms before reloading exams', () => {
    vi.useFakeTimers();
    try {
      const { compiled, fixture, listExams } = setup();
      listExams.mockClear();
      const input = compiled.querySelector<HTMLInputElement>('[data-testid="search-filter"] input')!;
      input.value = 'bimestral';
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      expect(listExams).not.toHaveBeenCalled();

      vi.advanceTimersByTime(299);
      expect(listExams).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(listExams).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'bimestral', page: 1, pageSize: 50 }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the delete-confirm modal when it self-closes (Esc/backdrop) and allows reopening it', () => {
    const { compiled, fixture } = setup();
    (compiled.querySelectorAll('[data-testid="exam-menu"]')[0] as HTMLButtonElement).click(); // e1 ready
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="exam-delete"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="delete-confirm"]')).toBeTruthy();

    // ui-modal self-closes on backdrop click / Esc without the parent ever calling cancelDelete()
    (compiled.querySelector('[data-testid="modal-backdrop"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="delete-confirm"]')).toBeFalsy();
    expect(
      (fixture.componentInstance as unknown as { pendingDelete: () => unknown }).pendingDelete(),
    ).toBeNull();

    // Must be able to reopen the same confirmation afterwards.
    (compiled.querySelectorAll('[data-testid="exam-menu"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="exam-delete"] button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(compiled.querySelector('[data-testid="delete-confirm"]')).toBeTruthy();
  });
});
