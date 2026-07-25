import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { PaginationComponent } from './pagination.component';

function setup(page: number, pageSize: number, total: number) {
  const fixture = TestBed.createComponent(PaginationComponent);
  fixture.componentRef.setInput('page', page);
  fixture.componentRef.setInput('pageSize', pageSize);
  fixture.componentRef.setInput('total', total);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('PaginationComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [PaginationComponent] });
  });

  it('renders nothing when everything fits on one page', () => {
    const { compiled } = setup(1, 50, 30);
    expect(compiled.querySelector('[data-testid="pagination-summary"]')).toBeFalsy();
  });

  it('shows the range summary and page count when there is more than one page', () => {
    const { compiled } = setup(2, 20, 45);
    expect(compiled.querySelector('[data-testid="pagination-summary"]')?.textContent).toContain('21–40 de 45');
    expect(compiled.querySelector('[data-testid="pagination-current"]')?.textContent).toContain('2 / 3');
  });

  it('disables "Anterior" on the first page and "Siguiente" on the last page', () => {
    const { compiled } = setup(1, 20, 45);
    expect((compiled.querySelector('[data-testid="pagination-prev"]') as HTMLButtonElement).disabled).toBe(true);
    expect((compiled.querySelector('[data-testid="pagination-next"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('emits pageChange with the next/previous page on click', () => {
    const { fixture, compiled } = setup(2, 20, 45);
    let emitted: number | null = null;
    fixture.componentInstance.pageChange.subscribe((p) => (emitted = p));

    (compiled.querySelector('[data-testid="pagination-next"]') as HTMLButtonElement).click();
    expect(emitted).toBe(3);

    (compiled.querySelector('[data-testid="pagination-prev"]') as HTMLButtonElement).click();
    expect(emitted).toBe(1);
  });
});
