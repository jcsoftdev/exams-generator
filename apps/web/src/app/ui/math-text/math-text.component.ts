import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input } from '@angular/core';
import katex from 'katex';
import { parseTypst } from '../../shared/typst/typst-to-latex';

/**
 * Renders a stored Typst statement (`bodyTypst`, an alternative, …) the way
 * the compiled PDF will show it: prose stays prose, `$…$` runs are typeset by
 * KaTeX after `parseTypst` transpiles them to LaTeX.
 *
 * Builds the DOM node by node instead of binding `[innerHTML]` on purpose.
 * KaTeX output relies on inline `style` attributes that Angular's sanitizer
 * strips, so `[innerHTML]` would need `bypassSecurityTrustHtml` — and
 * `bodyTypst` is untrusted (AI-generated, or pasted by a teacher). Appending
 * text nodes keeps that content inert with no bypass anywhere.
 *
 * `katex.render` is called with `throwOnError: false`, so a statement this
 * transpiler cannot handle degrades to the offending source shown in the
 * error colour — never to a blank statement.
 */
@Component({
  selector: 'ui-math-text',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'math-text' },
  template: '',
})
export class MathTextComponent {
  readonly value = input.required<string>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => {
      const target = this.host.nativeElement;
      target.replaceChildren();

      for (const segment of parseTypst(this.value() ?? '')) {
        if (segment.kind === 'text') {
          target.appendChild(document.createTextNode(segment.value));
          continue;
        }
        const holder = document.createElement('span');
        katex.render(segment.latex, holder, {
          displayMode: segment.display,
          throwOnError: false,
          strict: false,
          trust: false,
          output: 'htmlAndMathml',
        });
        target.appendChild(holder);
      }
    });
  }
}
