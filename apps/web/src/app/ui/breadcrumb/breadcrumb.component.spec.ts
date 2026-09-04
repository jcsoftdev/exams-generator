import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { BreadcrumbComponent } from './breadcrumb.component';

function setup() {
  TestBed.configureTestingModule({ imports: [BreadcrumbComponent] });
  const fixture = TestBed.createComponent(BreadcrumbComponent);
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

const ITEMS = [
  { id: 'root', label: 'Mi banco' },
  { id: 'colegio', label: 'Colegio' },
  { id: 'mate', label: 'Matemática' },
];

describe('BreadcrumbComponent', () => {
  it('renders every crumb and marks the last one as the current page', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('items', ITEMS);
    fixture.detectChanges();

    const crumbs = compiled.querySelectorAll('[data-testid="breadcrumb-crumb"]');
    expect(crumbs.length).toBe(3);
    expect(crumbs[0].tagName).toBe('BUTTON');
    expect(crumbs[1].tagName).toBe('BUTTON');
    expect(crumbs[2].tagName).not.toBe('BUTTON');
    expect(crumbs[2].getAttribute('aria-current')).toBe('page');
    expect(crumbs[2].textContent).toContain('Matemática');
  });

  /**
   * The last crumb is the page you are already on. Making it a link would
   * announce a route change to a screen reader for a navigation that never
   * happens.
   */
  it('emits only for a crumb that is not the last one', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('items', ITEMS);
    fixture.detectChanges();
    const seen: string[] = [];
    fixture.componentInstance.navigate.subscribe((id) => seen.push(id));

    const crumbs = compiled.querySelectorAll<HTMLElement>('[data-testid="breadcrumb-crumb"]');
    crumbs[0].click();
    crumbs[1].click();
    crumbs[2].click();

    expect(seen).toEqual(['root', 'colegio']);
  });

  it('labels the nav so a screen reader can skip it', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('items', ITEMS);
    fixture.detectChanges();

    expect(compiled.querySelector('nav')!.getAttribute('aria-label')).toBe('Ruta');
  });

  it('renders nothing when there are no crumbs', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('[data-testid="breadcrumb-crumb"]').length).toBe(0);
  });
});
