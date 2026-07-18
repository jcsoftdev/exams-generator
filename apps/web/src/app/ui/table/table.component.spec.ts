import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { TableComponent } from './table.component';
import { Column } from '../ui.types';

interface Row {
  readonly nombre: string;
  readonly nota: number;
}

const COLUMNS: Column<Row>[] = [
  { key: 'nombre', label: 'Nombre' },
  { key: 'nota', label: 'Nota' },
];

const ROWS: Row[] = [
  { nombre: 'Ana', nota: 18 },
  { nombre: 'Beto', nota: 15 },
];

@Component({
  standalone: true,
  imports: [TableComponent],
  template: `<ui-table [columns]="columns" [rows]="rows"></ui-table>`,
})
class SimpleHostComponent {
  columns = COLUMNS;
  rows = ROWS;
}

@Component({
  standalone: true,
  imports: [TableComponent],
  template: `
    <ui-table>
      <ng-container head><th data-testid="bespoke-head">Especial</th></ng-container>
      <ng-container body><td data-testid="bespoke-body">Contenido libre</td></ng-container>
    </ui-table>
  `,
})
class ProjectedHostComponent {}

describe('TableComponent', () => {
  it('renders columns+rows in simple mode', () => {
    TestBed.configureTestingModule({ imports: [SimpleHostComponent] });
    const fixture = TestBed.createComponent(SimpleHostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Nombre');
    expect(compiled.textContent).toContain('Ana');
    expect(compiled.textContent).toContain('18');
    expect(compiled.querySelectorAll('tbody tr').length).toBe(2);
  });

  it('renders [head]/[body] projected content for bespoke tables', () => {
    TestBed.configureTestingModule({ imports: [ProjectedHostComponent] });
    const fixture = TestBed.createComponent(ProjectedHostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-testid="bespoke-head"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="bespoke-body"]')).toBeTruthy();
  });
});
