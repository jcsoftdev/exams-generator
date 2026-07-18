import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ButtonComponent } from './button.component';

function setup() {
  const fixture = TestBed.createComponent(ButtonComponent);
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled };
}

describe('ButtonComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ButtonComponent] });
  });

  it('renders the primary variant with bg-primary-500 and is clickable', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    expect(button.className).toContain('bg-primary-500');

    let clicks = 0;
    fixture.componentInstance.clicked.subscribe(() => clicks++);
    button.click();
    expect(clicks).toBe(1);
  });

  it('does not emit clicked and carries a disabled attribute when disabled=true', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    expect(button.hasAttribute('disabled')).toBe(true);
    expect(button.getAttribute('aria-disabled')).toBe('true');

    let clicks = 0;
    fixture.componentInstance.clicked.subscribe(() => clicks++);
    button.click();
    expect(clicks).toBe(0);
  });

  it('does not emit clicked when loading=true', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    let clicks = 0;
    fixture.componentInstance.clicked.subscribe(() => clicks++);
    button.click();
    expect(clicks).toBe(0);
  });

  it('renders the ghost variant as transparent with a border, no solid fill', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('variant', 'ghost');
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    expect(button.className).toContain('bg-transparent');
    expect(button.className).toContain('border');
    expect(button.className).not.toContain('bg-primary-500');
  });

  it('renders rounded-field and never a hardcoded English default label', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    expect(button.className).toContain('rounded-field');
    expect(button.textContent?.trim()).toBe('');
  });

  it('sets the native button type from htmlType', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('htmlType', 'submit');
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    expect(button.getAttribute('type')).toBe('submit');
  });
});
