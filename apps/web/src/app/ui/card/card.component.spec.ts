import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { CardComponent } from './card.component';

@Component({
  standalone: true,
  imports: [CardComponent],
  template: `
    <ui-card [tone]="tone">
      <div header>Encabezado</div>
      <p>Cuerpo</p>
      <div footer>Pie</div>
    </ui-card>
  `,
})
class HostComponent {
  tone: 'default' | 'muted' = 'default';
}

describe('CardComponent', () => {
  it('renders projected header/body/footer content', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Encabezado');
    expect(compiled.textContent).toContain('Cuerpo');
    expect(compiled.textContent).toContain('Pie');
  });

  it('renders the rounded-card class', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-testid="card"]')?.className).toContain('rounded-card');
  });

  it('applies a muted-tone class when tone="muted"', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.tone = 'muted';
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-testid="card"]')?.className).toContain('bg-n50');
  });
});
