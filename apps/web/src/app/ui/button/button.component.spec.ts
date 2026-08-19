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

  // Audit P1 #3 regression guard: text-primary-500 was 3.08:1 against
  // bg-surface in dark mode. --color-tint-text has an identical light-mode
  // hex (#5a6acf) but a lighter, AA-passing dark-mode hex (#9db4cb) — see
  // the contrast measurement in the PR description, not something jsdom can
  // assert since styles.css isn't loaded in unit tests.
  it('uses the tint-text token (not primary-500) for the ghost variant text/border', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('variant', 'ghost');
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    expect(button.className).toContain('text-tint-text');
    expect(button.className).toContain('border-tint-text');
    expect(button.className).not.toContain('text-primary-500');
    expect(button.className).not.toContain('border-primary-500');
  });

  it('renders the danger variant with a solid red fill, distinct from primary', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('variant', 'danger');
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    expect(button.className).toContain('bg-hard-text');
    expect(button.className).not.toContain('bg-primary-500');
  });

  it('renders rounded-field and never a hardcoded English default label', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    expect(button.className).toContain('rounded-field');
    expect(button.textContent?.trim()).toBe('');
  });

  it('defaults to the md size padding', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    expect(compiled.querySelector('button')!.className).toContain('px-4 py-2');
  });

  it('renders sm with tighter padding but the SAME type size — only the box shrinks', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('size', 'sm');
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    expect(button.className).toContain('px-3 py-1.5');
    expect(button.className).not.toContain('px-4 py-2');
    expect(button.className).toContain('text-sm');
  });

  it('sets the native button type from htmlType', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('htmlType', 'submit');
    fixture.detectChanges();

    const button = compiled.querySelector('button')!;
    expect(button.getAttribute('type')).toBe('submit');
  });
});
