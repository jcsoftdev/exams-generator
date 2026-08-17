import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
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

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `
    <button data-testid="trigger" (click)="open = true">Abrir</button>
    <ui-modal [(open)]="open" title="Confirmar">
      <input data-testid="first-field" />
      <div actions>
        <button data-testid="cancel" (click)="open = false">Cancelar</button>
        <button data-testid="ok" (click)="open = false">Aceptar</button>
      </div>
    </ui-modal>
  `,
})
class TrapHostComponent {
  open = false;
}

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `
    <ui-modal [(open)]="open">
      <p>Sin título</p>
    </ui-modal>
  `,
})
class NoTitleHostComponent {
  open = false;
}

@Component({
  standalone: true,
  imports: [ModalComponent],
  template: `
    <ui-modal [(open)]="open" title="Vacío">
      <p>Sin elementos enfocables</p>
    </ui-modal>
  `,
})
class NoFocusableHostComponent {
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

  it('sets aria-labelledby on the panel pointing to the title heading when a title is provided', async () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.open = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const panel = compiled.querySelector<HTMLElement>('[data-testid="modal-panel"]')!;
    const heading = compiled.querySelector<HTMLElement>('h2')!;
    const labelledBy = panel.getAttribute('aria-labelledby');

    expect(labelledBy).toBeTruthy();
    expect(heading.id).toBe(labelledBy);
  });

  it('does not set aria-labelledby on the panel when no title is provided', () => {
    TestBed.configureTestingModule({ imports: [NoTitleHostComponent] });
    const fixture = TestBed.createComponent(NoTitleHostComponent);
    fixture.componentInstance.open = true;
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    const panel = compiled.querySelector<HTMLElement>('[data-testid="modal-panel"]')!;

    expect(panel.hasAttribute('aria-labelledby')).toBe(false);
  });

  it('traps Tab within the panel, wrapping from the last focusable element to the first', async () => {
    TestBed.configureTestingModule({ imports: [TrapHostComponent] });
    const fixture = TestBed.createComponent(TrapHostComponent);
    document.body.appendChild(fixture.nativeElement);
    try {
      fixture.componentInstance.open = true;
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      const firstField = compiled.querySelector<HTMLElement>('[data-testid="first-field"]')!;
      const okButton = compiled.querySelector<HTMLElement>('[data-testid="ok"]')!;
      await vi.waitFor(() => expect(document.activeElement).not.toBeNull());

      okButton.focus();
      expect(document.activeElement).toBe(okButton);

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      okButton.dispatchEvent(event);
      fixture.detectChanges();

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(firstField);
    } finally {
      fixture.nativeElement.remove();
    }
  });

  it('traps Shift+Tab within the panel, wrapping from the first focusable element to the last', async () => {
    TestBed.configureTestingModule({ imports: [TrapHostComponent] });
    const fixture = TestBed.createComponent(TrapHostComponent);
    document.body.appendChild(fixture.nativeElement);
    try {
      fixture.componentInstance.open = true;
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;

      const firstField = compiled.querySelector<HTMLElement>('[data-testid="first-field"]')!;
      const okButton = compiled.querySelector<HTMLElement>('[data-testid="ok"]')!;
      await vi.waitFor(() => expect(document.activeElement).not.toBeNull());

      firstField.focus();
      expect(document.activeElement).toBe(firstField);

      const event = new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true,
        cancelable: true,
      });
      firstField.dispatchEvent(event);
      fixture.detectChanges();

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(okButton);
    } finally {
      fixture.nativeElement.remove();
    }
  });

  it('keeps focus on the panel when Tab is pressed and it has no focusable descendants', async () => {
    TestBed.configureTestingModule({ imports: [NoFocusableHostComponent] });
    const fixture = TestBed.createComponent(NoFocusableHostComponent);
    document.body.appendChild(fixture.nativeElement);
    try {
      fixture.componentInstance.open = true;
      fixture.detectChanges();
      const compiled = fixture.nativeElement as HTMLElement;
      const panel = compiled.querySelector<HTMLElement>('[data-testid="modal-panel"]')!;

      await vi.waitFor(() => expect(document.activeElement).toBe(panel));

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      panel.dispatchEvent(event);
      fixture.detectChanges();

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(panel);
    } finally {
      fixture.nativeElement.remove();
    }
  });

  it('moves focus into the panel when opened and restores it to the trigger when closed by Escape', async () => {
    TestBed.configureTestingModule({ imports: [TrapHostComponent] });
    const fixture = TestBed.createComponent(TrapHostComponent);
    document.body.appendChild(fixture.nativeElement);
    try {
      const compiled = fixture.nativeElement as HTMLElement;
      const trigger = compiled.querySelector<HTMLElement>('[data-testid="trigger"]')!;
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      fixture.componentInstance.open = true;
      fixture.detectChanges();
      const panel = compiled.querySelector<HTMLElement>('[data-testid="modal-panel"]')!;
      await vi.waitFor(() => expect(document.activeElement).toBe(panel));

      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      fixture.detectChanges();

      await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      fixture.nativeElement.remove();
    }
  });

  it('restores focus to the trigger when closed by clicking the backdrop', async () => {
    TestBed.configureTestingModule({ imports: [TrapHostComponent] });
    const fixture = TestBed.createComponent(TrapHostComponent);
    document.body.appendChild(fixture.nativeElement);
    try {
      const compiled = fixture.nativeElement as HTMLElement;
      const trigger = compiled.querySelector<HTMLElement>('[data-testid="trigger"]')!;
      trigger.focus();

      fixture.componentInstance.open = true;
      fixture.detectChanges();
      const panel = compiled.querySelector<HTMLElement>('[data-testid="modal-panel"]')!;
      await vi.waitFor(() => expect(document.activeElement).toBe(panel));

      compiled.querySelector<HTMLElement>('[data-testid="modal-backdrop"]')!.click();
      fixture.detectChanges();

      await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      fixture.nativeElement.remove();
    }
  });

  it('restores focus to the trigger when closed externally by an action button', async () => {
    TestBed.configureTestingModule({ imports: [TrapHostComponent] });
    const fixture = TestBed.createComponent(TrapHostComponent);
    document.body.appendChild(fixture.nativeElement);
    try {
      const compiled = fixture.nativeElement as HTMLElement;
      const trigger = compiled.querySelector<HTMLElement>('[data-testid="trigger"]')!;
      trigger.focus();

      fixture.componentInstance.open = true;
      fixture.detectChanges();
      const panel = compiled.querySelector<HTMLElement>('[data-testid="modal-panel"]')!;
      await vi.waitFor(() => expect(document.activeElement).toBe(panel));

      compiled.querySelector<HTMLElement>('[data-testid="ok"]')!.click();
      fixture.detectChanges();

      await vi.waitFor(() => expect(document.activeElement).toBe(trigger));
    } finally {
      fixture.nativeElement.remove();
    }
  });
});
