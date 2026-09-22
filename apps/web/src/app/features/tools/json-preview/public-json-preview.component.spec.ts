import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, expect, it } from 'vitest';
import { PublicJsonPreviewComponent } from './public-json-preview.component';

function setup() {
  TestBed.configureTestingModule({
    imports: [PublicJsonPreviewComponent],
    providers: [provideRouter([])],
  });
  const fixture = TestBed.createComponent(PublicJsonPreviewComponent);
  fixture.detectChanges();
  return { fixture, compiled: fixture.nativeElement as HTMLElement };
}

describe('PublicJsonPreviewComponent', () => {
  it('renders its own heading, since there is no shell topbar to render one', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="public-preview-heading"]')).not.toBeNull();
  });

  it('embeds the same preview tool the in-shell route uses', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="paste-textarea"]')).not.toBeNull();
    expect(compiled.querySelector('[data-testid="paste-empty"]')).not.toBeNull();
  });

  it('previews a paste with no session and no backend call', () => {
    const { compiled, fixture } = setup();

    const textarea = compiled.querySelector<HTMLTextAreaElement>('[data-testid="paste-textarea"]')!;
    textarea.value = '{"bodyTypst":"¿Cuánto es $1/2 + 1/4$?"}';
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    compiled.querySelector<HTMLButtonElement>('[data-testid="paste-submit"] button')!.click();
    fixture.detectChanges();

    expect(compiled.querySelectorAll('[data-testid="preview-question"]')).toHaveLength(1);
  });

  it('offers a way into the app for a visitor who does have an account', () => {
    const { compiled } = setup();

    expect(
      compiled.querySelector('[data-testid="public-preview-login"]')!.getAttribute('href'),
    ).toBe('/login');
  });
});
