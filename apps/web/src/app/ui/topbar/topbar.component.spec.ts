import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
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

describe('TopbarComponent', () => {
  it('renders the title', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.textContent).toContain('Exámenes');
  });

  it('renders projected [actions] content', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('[data-testid="topbar-action"]')).toBeTruthy();
  });

  it('emits menuToggle when the menu button is clicked', () => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;

    compiled.querySelector<HTMLButtonElement>('[data-testid="topbar-menu-button"]')!.click();
    fixture.detectChanges();

    expect(fixture.componentInstance.toggled).toBe(true);
  });
});
