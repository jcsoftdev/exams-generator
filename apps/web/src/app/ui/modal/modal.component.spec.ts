import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { ModalComponent } from './modal.component';

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `
    <ui-modal [(open)]="open" title="Confirmar">
      <p>Cuerpo del modal</p>
      <div actions><button data-testid="ok">Aceptar</button></div>
    </ui-modal>
  `,
})
class HostComponent {
  open = false;
}

describe('ModalComponent', () => {
  it('does not render its content when open=false', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-testid="modal-panel"]')).toBeFalsy();
  });

  it('renders content, title and the [actions] slot when open=true', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.open = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-testid="modal-panel"]')).toBeTruthy();
    expect(compiled.textContent).toContain('Confirmar');
    expect(compiled.textContent).toContain('Cuerpo del modal');
    expect(compiled.querySelector('[data-testid="ok"]')).toBeTruthy();
  });

  it('closes on backdrop click and emits closed', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.open = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLElement>('[data-testid="modal-backdrop"]')!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.open).toBe(false);
  });

  it('closes on Escape keydown', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.open = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled
      .querySelector('[data-testid="modal-panel"]')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.open).toBe(false);
  });
});
