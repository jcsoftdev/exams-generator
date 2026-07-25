import { Component, importProvidersFrom } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { LucideAngularModule, Menu, Search } from 'lucide-angular';
import { TopbarComponent } from './topbar.component';

@Component({
  standalone: true,
  imports: [TopbarComponent],
  template: `
    <ui-topbar title="Exámenes" (menuToggle)="toggled = true">
      <button actions data-testid="topbar-action">Nueva pregunta</button>
    </ui-topbar>
  `,
})
class HostComponent {
  toggled = false;
}

function setup() {
  TestBed.configureTestingModule({
    imports: [HostComponent],
    providers: [importProvidersFrom(LucideAngularModule.pick({ Menu, Search }))],
  });
  const fixture = TestBed.createComponent(HostComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('TopbarComponent', () => {
  it('renders the title', () => {
    const { compiled } = setup();

    expect(compiled.textContent).toContain('Exámenes');
  });

  it('renders projected [actions] content', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="topbar-action"]')).toBeTruthy();
  });

  it('emits menuToggle when the menu button is clicked', () => {
    const { fixture, compiled } = setup();

    compiled.querySelector<HTMLButtonElement>('[data-testid="topbar-menu-button"]')!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.toggled).toBe(true);
  });

  it('renders a lucide menu icon (no emoji) inside the menu button', () => {
    const { compiled } = setup();
    const button = compiled.querySelector('[data-testid="topbar-menu-button"]')!;
    expect(button.querySelector('lucide-angular,i-lucide')).toBeTruthy();
    expect(button.textContent).not.toContain('☰');
  });
});
