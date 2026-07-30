import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MathTextComponent } from './math-text.component';

function setup(value: string) {
  const fixture = TestBed.createComponent(MathTextComponent);
  fixture.componentRef.setInput('value', value);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('MathTextComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [MathTextComponent] });
  });

  it('renders prose as plain text and the $…$ run as typeset math', async () => {
    const { compiled } = setup('El área de un círculo es $36 pi$ cm.');

    // The `$` delimiters and the Typst spelling `pi` are gone from the output…
    expect(compiled.textContent).toContain('El área de un círculo es');
    expect(compiled.textContent).not.toContain('$');
    // …replaced by real KaTeX markup carrying the transpiled LaTeX, once the
    // dynamically-imported katex chunk resolves.
    await vi.waitFor(() => expect(compiled.querySelector('.katex')).not.toBeNull());
    expect(compiled.querySelector('annotation')?.textContent).toBe('36 \\pi');
  });

  it('re-renders when the value input changes, leaving no stale math behind', async () => {
    const { fixture, compiled } = setup('$36 pi$');
    await vi.waitFor(() => expect(compiled.querySelectorAll('.katex').length).toBe(1));

    fixture.componentRef.setInput('value', 'sin matemática');
    fixture.detectChanges();

    expect(compiled.querySelectorAll('.katex').length).toBe(0);
    expect(compiled.textContent).toBe('sin matemática');
  });

  it('renders an empty value as empty, without throwing', () => {
    const { compiled } = setup('');
    expect(compiled.textContent).toBe('');
  });

  it('shows malformed math instead of blanking the statement', () => {
    const { compiled } = setup('antes $frac(1,$ después');

    expect(compiled.textContent).toContain('antes');
    expect(compiled.textContent).toContain('después');
  });

  it('never turns markup in the stored statement into live DOM', () => {
    // `bodyTypst` can come from the AI generator or from a teacher's paste, so
    // it is untrusted: it must land as text, never as an element.
    const { compiled } = setup('<img src=x onerror="alert(1)"> y $x^2$');

    expect(compiled.querySelector('img')).toBeNull();
    expect(compiled.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
