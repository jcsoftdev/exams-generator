import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { importProvidersFrom } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
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

function setup(
  over: {
    listImpl?: () => unknown;
    dupImpl?: () => unknown;
    delImpl?: () => unknown;
    renameImpl?: () => unknown;
    queryParams?: Record<string, string>;
  } = {},
) {
  const listExams = vi.fn(over.listImpl ?? (() => of(RESULT)));
  const duplicateExam = vi.fn(over.dupImpl ?? (() => of({ id: 'e3', title: 'Copia de Examen X', status: 'draft' })));
  const deleteExam = vi.fn(over.delImpl ?? (() => of(void 0)));
  const renameExam = vi.fn(over.renameImpl ?? (() => of({ id: 'e1', title: 'Simulacro de marzo' })));
  const navigate = vi.fn();
  TestBed.configureTestingModule({
    imports: [ExamListComponent],
    providers: [
      importProvidersFrom(LucideAngularModule.pick({ Ellipsis, Plus, Check, ChevronDown })),
      { provide: ExamsService, useValue: { listExams, duplicateExam, deleteExam, renameExam } },
      { provide: Router, useValue: { navigate } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(over.queryParams ?? {}) } },
      },
    ],
  });
  const fixture = TestBed.createComponent(ExamListComponent);
  fixture.detectChanges();
  return {
    fixture,
    compiled: fixture.nativeElement as HTMLElement,
    listExams,
    duplicateExam,
    deleteExam,
    renameExam,
    navigate,
  };
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

  /**
   * Audit 2026-08-15: un borrador se borraba al primer click, sin modal, sin
   * toast y sin deshacer (reproducido: 7 → 6 filas al instante). El "nothing to
   * lose" original no aplica — un borrador puede llevar 80 preguntas armadas, y
   * el disparador es un ítem de un menú chiquito.
   */
  it('asks for confirmation before deleting a DRAFT too, and says what is at stake', () => {
    const { compiled, fixture, deleteExam, listExams } = setup();
    (compiled.querySelectorAll('[data-testid="exam-menu"]')[1] as HTMLButtonElement).click(); // e2 draft
    fixture.detectChanges();
    listExams.mockClear();

    (compiled.querySelector('[data-testid="exam-delete"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(deleteExam).not.toHaveBeenCalled();
    const confirm = compiled.querySelector('[data-testid="delete-confirm"]')!;
    expect(confirm.textContent).toContain('Borrador Y');
    expect(confirm.textContent).toMatch(/10 preguntas/);

    (compiled.querySelector('[data-testid="delete-confirm-yes"] button') as HTMLButtonElement).click();
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

  /**
   * Audit 2026-08-15: un examen `ready` sin ninguna forma se mostraba como
   * "Generado" — el docente lee "generado" y espera PDFs, abre, y no hay nada.
   * El estado del examen y la existencia de PDFs son dos cosas distintas.
   */
  it('distinguishes a confirmed exam from one that actually has forms', () => {
    const { compiled } = setup({
      listImpl: () =>
        of({
          items: [
            { ...RESULT.items[0], id: 'e-listo', status: 'ready', versionCount: 0 },
            { ...RESULT.items[0], id: 'e-generado', status: 'ready', versionCount: 3 },
          ],
          total: 2,
        }),
    });

    const rows = Array.from(compiled.querySelectorAll('[data-testid="exam-row"]'));
    expect(rows[0].textContent).toContain('Listo');
    expect(rows[0].textContent).not.toContain('Generado');
    expect(rows[1].textContent).toContain('Generado');
  });

  /**
   * Audit 2026-08-15: el título se autogeneraba y no había forma de cambiarlo,
   * así que la lista acumulaba filas idénticas ("Examen Pre-admisión —
   * 14/8/2026" ×3) y "Copia de Copia de …". `PATCH /exams/:id` es nuevo.
   */
  it('renames an exam from its menu and reloads the list', () => {
    const { compiled, fixture, renameExam, listExams } = setup();

    (compiled.querySelectorAll('[data-testid="exam-menu"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="exam-rename"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = compiled.querySelector<HTMLInputElement>('[data-testid="rename-input"] input')!;
    expect(input.value).toBe('Examen X'); // arranca con el nombre actual, no en blanco
    input.value = 'Simulacro de marzo';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    listExams.mockClear();
    (compiled.querySelector('[data-testid="rename-confirm"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(renameExam).toHaveBeenCalledWith('e1', 'Simulacro de marzo');
    expect(listExams).toHaveBeenCalledTimes(1);
  });

  it('refuses to save an empty name instead of replacing a real title with nothing', () => {
    const { compiled, fixture, renameExam } = setup();

    (compiled.querySelectorAll('[data-testid="exam-menu"]')[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    (compiled.querySelector('[data-testid="exam-rename"] button') as HTMLButtonElement).click();
    fixture.detectChanges();

    const input = compiled.querySelector<HTMLInputElement>('[data-testid="rename-input"] input')!;
    input.value = '   ';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(
      (compiled.querySelector('[data-testid="rename-confirm"] button') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(renameExam).not.toHaveBeenCalled();
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

  /**
   * Audit 2026-08-15: los filtros no viajaban a la URL, así que recargar los
   * perdía y no se podían compartir ni recuperar con Atrás.
   */
  it('reflects the active filters in the URL', () => {
    const { compiled, fixture, navigate } = setup();

    selectOption(compiled.querySelector('[data-testid="status-filter"]') as HTMLElement, fixture, 'Borrador');

    expect(navigate).toHaveBeenCalledWith([], {
      queryParams: { status: 'draft', gradeLevel: null, search: null, page: null },
      replaceUrl: true,
    });
  });

  it('restores the filters from the URL on load, so a reload or a shared link keeps them', () => {
    const { compiled, listExams } = setup({ queryParams: { status: 'draft', gradeLevel: 'pre', search: 'simulacro' } });

    expect(listExams).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft', gradeLevel: 'pre', search: 'simulacro' }),
    );
    expect((compiled.querySelector('[data-testid="search-filter"] input') as HTMLInputElement).value).toBe('simulacro');
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
    selectOption(container, fixture, 'Listo');
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
