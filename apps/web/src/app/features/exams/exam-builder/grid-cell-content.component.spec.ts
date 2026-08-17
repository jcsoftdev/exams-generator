import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { GridCellContentComponent } from './grid-cell-content.component';

function setup(overrides: { status?: 'ok' | 'short' } = {}) {
  const fixture = TestBed.createComponent(GridCellContentComponent);
  fixture.componentRef.setInput('inputName', 'requested-c1-t1-easy');
  fixture.componentRef.setInput('cellKey', 'c1:t1:easy');
  fixture.componentRef.setInput('requestedStr', '5');
  fixture.componentRef.setInput('requested', 5);
  fixture.componentRef.setInput('stock', overrides.status === 'short' ? 2 : 5);
  fixture.componentRef.setInput('status', overrides.status ?? 'ok');
  fixture.componentRef.setInput('stockOkClasses', 'text-xs text-n500');
  fixture.componentRef.setInput('previewIds', ['q1', 'q2']);
  fixture.componentRef.setInput('cellLabel', 'Aritmética · Conjuntos · Fácil');
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('GridCellContentComponent', () => {
  /**
   * Audit 2026-08-15: los 1,656 inputs de la grilla no tenían nombre
   * accesible — un lector de pantalla anunciaba "spin button" y nada más, y el
   * curso·tema·dificultad de la celda solo existía en la posición visual.
   */
  it('names the count input after its cell, for a screen reader', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('input')!.getAttribute('aria-label')).toBe(
      'Preguntas de Aritmética · Conjuntos · Fácil',
    );
  });

  it('names the bridge actions after the cell too — three identical "Elegir del banco" are useless out of context', () => {
    const { compiled } = setup({ status: 'short' });

    expect(
      compiled.querySelector('[data-testid="bridge-choose-bank"] button')!.getAttribute('aria-label'),
    ).toContain('Aritmética · Conjuntos · Fácil');
  });

  it('shows the stock-ok indicator when status is ok', () => {
    const { compiled } = setup({ status: 'ok' });
    expect(compiled.querySelector('[data-testid="stock-ok"]')?.textContent).toContain('de 5');
    expect(compiled.querySelector('[data-testid="bridge-to-ai"]')).toBeFalsy();
  });

  it('shows the bridge-to-AI actions when status is short, with the correct shortfall count', () => {
    const { compiled } = setup({ status: 'short' });
    expect(compiled.querySelector('[data-testid="stock-warning"]')?.textContent).toContain('solo 2');
    expect(compiled.querySelector('[data-testid="bridge-generate-ai"]')?.textContent).toContain('Generar 3 con IA');
  });

  it('emits generateAi/chooseBank/lowerCount when the bridge buttons are clicked', () => {
    const { fixture, compiled } = setup({ status: 'short' });
    let generateAi = false;
    let chooseBank = false;
    let lowerCount = false;
    fixture.componentInstance.generateAi.subscribe(() => (generateAi = true));
    fixture.componentInstance.chooseBank.subscribe(() => (chooseBank = true));
    fixture.componentInstance.lowerCount.subscribe(() => (lowerCount = true));

    (compiled.querySelector('[data-testid="bridge-generate-ai"] button') as HTMLButtonElement).click();
    (compiled.querySelector('[data-testid="bridge-choose-bank"] button') as HTMLButtonElement).click();
    (compiled.querySelector('[data-testid="bridge-lower-count"] button') as HTMLButtonElement).click();

    expect(generateAi).toBe(true);
    expect(chooseBank).toBe(true);
    expect(lowerCount).toBe(true);
  });

  it('renders the comma-joined preview ids', () => {
    const { compiled } = setup();
    expect(compiled.querySelector('[data-testid="preview-ids"]')?.textContent?.trim()).toBe('q1,q2');
  });

  it('emits requestedChange when the count input changes', () => {
    const { fixture, compiled } = setup();
    let emitted: string | null = null;
    fixture.componentInstance.requestedChange.subscribe((v) => (emitted = v));

    const input = compiled.querySelector('input') as HTMLInputElement;
    input.value = '7';
    input.dispatchEvent(new Event('input'));

    expect(emitted).toBe('7');
  });
});
