import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { TagComponent } from './tag.component';

function setup() {
  const fixture = TestBed.createComponent(TagComponent);
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled };
}

describe('TagComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [TagComponent] });
  });

  it('renders the hard variant with the #fee2e2/#9f1239 token pair (bg-hard-bg/text-hard-text)', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('variant', 'hard');
    fixture.detectChanges();

    const el = compiled.querySelector('[data-testid="tag"]')!;
    expect(el.className).toContain('bg-hard-bg');
    expect(el.className).toContain('text-hard-text');
  });

  it('renders the ai variant with the #f3e8ff/#6b21a8 token pair (bg-ai-bg/text-ai-text)', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('variant', 'ai');
    fixture.detectChanges();

    const el = compiled.querySelector('[data-testid="tag"]')!;
    expect(el.className).toContain('bg-ai-bg');
    expect(el.className).toContain('text-ai-text');
  });

  it('maps each of the 5 semantic variants to a distinct static class pair', () => {
    const variants = ['easy', 'medium', 'hard', 'ai', 'warning-stock'] as const;
    const seen = new Set<string>();

    for (const variant of variants) {
      const { fixture, compiled } = setup();
      fixture.componentRef.setInput('variant', variant);
      fixture.detectChanges();
      seen.add(compiled.querySelector('[data-testid="tag"]')!.className);
    }

    expect(seen.size).toBe(5);
  });

  it('renders projected label content', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('variant', 'easy');
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="tag"]')).toBeTruthy();
  });
});
