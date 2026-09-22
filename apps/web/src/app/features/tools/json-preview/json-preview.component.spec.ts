import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { JsonPreviewComponent } from './json-preview.component';

const CHAT_PASTE = JSON.stringify({
  questions: [
    {
      sourceImage: 1,
      bodyTypst: 'Hallar una raíz de la ecuación:\n$2x^2 - 3x - 3 = 0$',
      alternatives: [
        '$\\frac{2 - \\sqrt{32}}{3}$',
        '$\\frac{13 + \\sqrt{33}}{4}$',
        '$\\frac{3 - \\sqrt{32}}{2}$',
        '$\\frac{3 + \\sqrt{33}}{4}$',
        '$\\sqrt{3}$',
      ],
      correctAnswer: 'd',
      figureCode: null,
      conceptsUsed: ['Ecuación cuadrática', 'Fórmula general de segundo grado'],
      solutionSteps: ['Identificar los coeficientes.', 'Aplicar la fórmula cuadrática.'],
      suggestedCourse: 'Álgebra',
      suggestedTopic: 'Ecuaciones cuadráticas',
    },
  ],
});

function setup() {
  TestBed.configureTestingModule({ imports: [JsonPreviewComponent] });
  const fixture = TestBed.createComponent(JsonPreviewComponent);
  fixture.detectChanges();
  const compiled = fixture.nativeElement as HTMLElement;

  const paste = (raw: string): void => {
    const textarea = compiled.querySelector<HTMLTextAreaElement>('[data-testid="paste-textarea"]')!;
    textarea.value = raw;
    textarea.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    compiled.querySelector<HTMLButtonElement>('[data-testid="paste-submit"] button')!.click();
    fixture.detectChanges();
  };

  return { fixture, compiled, paste };
}

describe('JsonPreviewComponent', () => {
  it('starts on an empty state, with no preview and no error', () => {
    const { compiled } = setup();

    expect(compiled.querySelector('[data-testid="paste-empty"]')).not.toBeNull();
    expect(compiled.querySelectorAll('[data-testid="preview-question"]')).toHaveLength(0);
    expect(compiled.querySelector('[data-testid="banner"]')).toBeNull();
  });

  it('renders one card per question in the { questions: [...] } envelope', () => {
    const { compiled, paste } = setup();

    paste(CHAT_PASTE);

    expect(compiled.querySelectorAll('[data-testid="preview-question"]')).toHaveLength(1);
    expect(compiled.querySelector('[data-testid="paste-empty"]')).toBeNull();
  });

  it('renders the 5 alternatives with their letters, marking the correct one', () => {
    const { compiled, paste } = setup();

    paste(CHAT_PASTE);

    const alternatives = compiled.querySelectorAll('[data-testid="preview-alternative"]');
    expect(alternatives).toHaveLength(5);
    expect(alternatives[0]!.textContent).toContain('A)');
    const correct = compiled.querySelectorAll(
      '[data-testid="preview-alternative"][data-correct="true"]',
    );
    expect(correct).toHaveLength(1);
    expect(correct[0]!.textContent).toContain('D)');
  });

  it('shows the suggested course/topic, the concepts and the solution steps', () => {
    const { compiled, paste } = setup();

    paste(CHAT_PASTE);

    expect(compiled.querySelector('[data-testid="preview-taxonomy"]')!.textContent).toContain(
      'Álgebra',
    );
    expect(compiled.querySelectorAll('[data-testid="preview-concept"]')).toHaveLength(2);
    expect(compiled.querySelectorAll('[data-testid="preview-step"]')).toHaveLength(2);
  });

  it('surfaces the raw-LaTeX warning the paste earns, instead of silently rendering it', () => {
    const { compiled, paste } = setup();

    paste(CHAT_PASTE);

    expect(compiled.querySelector('[data-testid="preview-warning"]')!.textContent).toContain(
      'LaTeX',
    );
  });

  it('renders a bare array of questions', () => {
    const { compiled, paste } = setup();

    paste('[{"bodyTypst":"Primera"},{"bodyTypst":"Segunda"}]');

    expect(compiled.querySelectorAll('[data-testid="preview-question"]')).toHaveLength(2);
  });

  it('renders a bare Typst statement with no alternatives', () => {
    const { compiled, paste } = setup();

    paste('El área del círculo de radio $3$ es $9 pi$.');

    expect(compiled.querySelectorAll('[data-testid="preview-question"]')).toHaveLength(1);
    expect(compiled.querySelectorAll('[data-testid="preview-alternative"]')).toHaveLength(0);
  });

  it('shows the parse error in a banner and renders nothing', () => {
    const { compiled, paste } = setup();

    paste('{"questions":[{"bodyTypst":"x"},]}');

    expect(compiled.querySelector('[data-testid="banner"]')!.textContent).toContain('JSON');
    expect(compiled.querySelectorAll('[data-testid="preview-question"]')).toHaveLength(0);
  });

  it('clears a previous preview when a new paste fails to parse', () => {
    const { compiled, paste } = setup();

    paste(CHAT_PASTE);
    expect(compiled.querySelectorAll('[data-testid="preview-question"]')).toHaveLength(1);

    paste('{"roto":true}');

    expect(compiled.querySelectorAll('[data-testid="preview-question"]')).toHaveLength(0);
    expect(compiled.querySelector('[data-testid="banner"]')).not.toBeNull();
  });

  it('empties both the textarea and the preview on clear', () => {
    const { compiled, fixture, paste } = setup();

    paste(CHAT_PASTE);
    compiled.querySelector<HTMLButtonElement>('[data-testid="paste-clear"] button')!.click();
    fixture.detectChanges();

    expect(
      compiled.querySelector<HTMLTextAreaElement>('[data-testid="paste-textarea"]')!.value,
    ).toBe('');
    expect(compiled.querySelectorAll('[data-testid="preview-question"]')).toHaveLength(0);
    expect(compiled.querySelector('[data-testid="paste-empty"]')).not.toBeNull();
  });

  it('labels each question with the image it came from when the paste says so', () => {
    const { compiled, paste } = setup();

    paste(CHAT_PASTE);

    expect(compiled.querySelector('[data-testid="preview-source-image"]')!.textContent).toContain(
      '1',
    );
  });
});
