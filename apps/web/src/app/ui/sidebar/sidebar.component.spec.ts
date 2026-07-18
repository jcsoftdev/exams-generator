import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, it, expect } from 'vitest';
import { SidebarComponent } from './sidebar.component';
import { NavGroup } from '../ui.types';

const GROUPS: NavGroup[] = [
  {
    title: 'Principal',
    items: [
      { label: 'Banco de preguntas', route: '/app/bank' },
      { label: 'Exámenes', route: '/app/exams' },
      { label: 'Versiones y PDF', route: '/app/exams/1/versions' },
    ],
  },
  {
    title: 'Inteligencia',
    items: [
      { label: 'Generar con IA', route: '/app/ai/generate' },
      { label: 'Cola de revisión', route: '/app/ai/review' },
    ],
  },
  {
    title: 'Colegio',
    items: [{ label: 'Configuración', route: '/app/settings' }],
  },
];

@Component({
  standalone: true,
  imports: [SidebarComponent],
  template: `<ui-sidebar [groups]="groups"></ui-sidebar>`,
})
class HostComponent {
  groups = GROUPS;
}

describe('SidebarComponent', () => {
  it('renders the 3 nav groups (Principal/Inteligencia/Colegio)', async () => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([])],
    });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Principal');
    expect(compiled.textContent).toContain('Inteligencia');
    expect(compiled.textContent).toContain('Colegio');
    expect(compiled.textContent).toContain('Exámenes');
  });

  it('marks ONLY the active route item with the active tint classes', async () => {
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideRouter([{ path: '**', children: [] }])],
    });
    const fixture = TestBed.createComponent(HostComponent);
    const router = TestBed.inject(Router);
    fixture.detectChanges();
    await router.navigateByUrl('/app/exams');
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const links = Array.from(compiled.querySelectorAll('a[data-testid="nav-item"]'));
    const active = links.filter((link) => link.className.includes('bg-tint-activo'));

    expect(active.length).toBe(1);
    expect(active[0].textContent).toContain('Exámenes');
    expect(active[0].className).toContain('text-tint-texto');
  });
});
