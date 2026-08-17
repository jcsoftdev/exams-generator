import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { TableComponent } from './table.component';

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
  it('renders [head]/[body] projected content for bespoke tables', () => {
    TestBed.configureTestingModule({ imports: [ProjectedHostComponent] });
    const fixture = TestBed.createComponent(ProjectedHostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-testid="bespoke-head"]')).toBeTruthy();
    expect(compiled.querySelector('[data-testid="bespoke-body"]')).toBeTruthy();
  });
});
