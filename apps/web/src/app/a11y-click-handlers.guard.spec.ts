import { describe, it, expect } from 'vitest';
import {
  parseTemplate,
  TmplAstRecursiveVisitor,
  tmplAstVisitAll,
  type TmplAstElement,
  type TmplAstNode,
} from '@angular/compiler';

/**
 * GUARDIAN — click handlers must be keyboard-reachable.
 *
 * This audit found the same defect twice, in different files: a
 * `<div (click)="open(job)">` row in the AI generation history and a
 * `<tr (click)="toggleCourse(...)">` row in the exam builder. Both meant the
 * element was clickable with a mouse and invisible to a keyboard user — the
 * entire row was unreachable via Tab. Both are fixed now. This test exists so
 * the THIRD one fails CI instead of shipping.
 *
 * The fix, demonstrated across all three layers of
 * `features/bank/bank-list/bank-list.component.html`: use a real
 * `<button type="button">` with `focus:outline-none focus:ring-2
 * focus:ring-primary-300` instead of a `(click)` on a `<div>`/`<tr>`/etc.
 * Native interactive elements (button, a, input, select, textarea, option,
 * label, summary, details) are exempt — the platform already gives them
 * keyboard support for free.
 *
 * A non-interactive element is allowed to keep its `(click)` ONLY if it also
 * carries `role`, `tabindex`, AND a keyboard handler
 * ((keydown)/(keyup)/(keypress), including modifiers like `(keydown.enter)`)
 * — i.e. it has been deliberately made into a custom interactive control.
 *
 * Custom Angular components (any tag with a `-`, e.g. `ui-button`,
 * `app-question-taxonomy-fields`) are out of scope: they manage their own
 * host accessibility and this repo's convention is `(clicked)`, not
 * `(click)`, for custom component outputs.
 *
 * `apps/web/src/app/features/ai/**` is intentionally excluded — another
 * workstream owns that tree right now.
 *
 * ONE narrow, deliberate exemption: `role="option"` elements. WAI-ARIA
 * combobox/listbox items are the canonical case where an option is
 * intentionally NOT independently focusable — DOM focus stays on the
 * trigger, keyboard selection is handled there, and `aria-activedescendant`
 * communicates the "virtual focus" to assistive tech (see
 * `ui/select/select.component.ts`, which carries the matching
 * eslint-disable with the same justification). Do not add more exemptions
 * here without equally strong, documented justification — an allowlist that
 * grows freely is theater, not a guardian.
 *
 * Implementation note: templates are read via Vite's `import.meta.glob`
 * (raw string import) rather than Node's `fs`, since this project's tsconfig
 * for specs does not include `@types/node`. This keeps the guardian
 * dependency-free.
 */

// `vite/client` types aren't resolvable from this workspace's tsconfig
// (vite isn't a direct dependency of apps/web), so declare the minimal
// ImportMeta.glob shape this file actually uses.
declare global {
  interface ImportMeta {
    glob(
      pattern: string | string[],
      options: { eager: true; query: string; import: string },
    ): Record<string, string>;
  }
}

// `import.meta.glob` must appear literally (not via an alias/wrapper) — Vite
// statically rewrites this exact call shape during transform.
const htmlModules = import.meta.glob(['./**/*.html', '!./features/ai/**'], {
  eager: true,
  query: '?raw',
  import: 'default',
});

const tsModules = import.meta.glob(['./**/*.ts', '!./**/*.spec.ts', '!./features/ai/**'], {
  eager: true,
  query: '?raw',
  import: 'default',
});

const NATIVE_INTERACTIVE_TAGS = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'option',
  'label',
  'summary',
  'details',
  'audio',
  'video',
  'dialog',
]);

const KEYBOARD_EVENT_PREFIX = /^key(down|up|press)/i;

interface TemplateSource {
  /** Path relative to apps/web/src/app, used in failure messages. */
  relativePath: string;
  html: string;
  /** 1-based line, in the ORIGINAL file, that template content line 0 falls on. */
  baseLine: number;
}

interface Violation {
  relativePath: string;
  line: number;
  column: number;
  tag: string;
  missing: string[];
}

/**
 * Pulls the inline `template: \`...\`` literal out of a component .ts file,
 * if present. Returns null for components using templateUrl (their .html
 * sibling is picked up separately via htmlModules).
 *
 * Limitation: this is a plain backtick-boundary scan, not a JS parser. A
 * literal, unescaped backtick inside the template's HTML/text content (e.g.
 * inside an HTML comment) would prematurely close the match. Angular inline
 * templates don't legitimately need raw backticks — Angular interpolation is
 * `{{ }}`, not JS `${}` — so this is a real but narrow limitation; the parse
 * error check below in the test fails loudly if it ever happens instead of
 * silently under-scanning.
 */
function extractInlineTemplate(source: string): { html: string; baseLine: number } | null {
  const marker = /template\s*:\s*`/.exec(source);
  if (!marker) {
    return null;
  }
  const start = marker.index + marker[0].length;
  let i = start;
  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2;
      continue;
    }
    if (source[i] === '`') {
      break;
    }
    i++;
  }
  const html = source.slice(start, i);
  const baseLine = source.slice(0, start).split('\n').length; // 1-based line of template content's line 0
  return { html, baseLine };
}

function loadTemplateSources(): TemplateSource[] {
  const sources: TemplateSource[] = [];

  for (const [path, html] of Object.entries(htmlModules)) {
    sources.push({ relativePath: path.replace(/^\.\//, ''), html, baseLine: 1 });
  }

  for (const [path, tsSource] of Object.entries(tsModules)) {
    const extracted = extractInlineTemplate(tsSource);
    if (extracted) {
      sources.push({
        relativePath: path.replace(/^\.\//, ''),
        html: extracted.html,
        baseLine: extracted.baseLine,
      });
    }
  }

  return sources;
}

function hasAttrNamed(element: TmplAstElement, name: string): boolean {
  return (
    element.attributes.some((a) => a.name.toLowerCase() === name) ||
    element.inputs.some((a) => a.name.toLowerCase() === name)
  );
}

class ClickHandlerVisitor extends TmplAstRecursiveVisitor {
  readonly violations: Violation[] = [];

  constructor(
    private readonly relativePath: string,
    private readonly baseLine: number,
  ) {
    super();
  }

  override visitElement(element: TmplAstElement): void {
    const tag = element.name.toLowerCase();
    const hasClick = element.outputs.some((o) => o.name === 'click');
    const isNativeInteractive = NATIVE_INTERACTIVE_TAGS.has(tag);
    const isCustomComponent = tag.includes('-');
    const staticRole = element.attributes
      .find((a) => a.name.toLowerCase() === 'role')
      ?.value.toLowerCase();
    const isAriaOption = staticRole === 'option';

    if (hasClick && !isNativeInteractive && !isCustomComponent && !isAriaOption) {
      const hasRole = hasAttrNamed(element, 'role');
      const hasTabindex = hasAttrNamed(element, 'tabindex');
      const hasKeyboardHandler = element.outputs.some((o) => KEYBOARD_EVENT_PREFIX.test(o.name));

      const missing: string[] = [];
      if (!hasRole) missing.push('role');
      if (!hasTabindex) missing.push('tabindex');
      if (!hasKeyboardHandler) missing.push('a keyboard handler: (keydown)/(keyup)/(keypress)');

      if (missing.length > 0) {
        const clickEvent = element.outputs.find((o) => o.name === 'click')!;
        this.violations.push({
          relativePath: this.relativePath,
          line: this.baseLine + clickEvent.sourceSpan.start.line,
          column: clickEvent.sourceSpan.start.col + 1,
          tag: element.name,
          missing,
        });
      }
    }

    super.visitElement(element);
  }
}

function formatViolation(v: Violation): string {
  return (
    `${v.relativePath}:${v.line}:${v.column} — <${v.tag}> has (click) but is missing ${v.missing.join(', ')}.\n` +
    `  Fix: use <button type="button"> with focus:outline-none focus:ring-2 focus:ring-primary-300 instead ` +
    `(see apps/web/src/app/features/bank/bank-list/bank-list.component.html), ` +
    `or — if this really must stay a non-button element — add role="button" tabindex="0" and a ` +
    `(keydown.enter)/(keydown.space) handler alongside (click).`
  );
}

describe('a11y guardian: (click) handlers must be keyboard-reachable', () => {
  it('has no (click) on a non-interactive element missing role + tabindex + a keyboard handler', () => {
    const violations: Violation[] = [];
    const parseFailures: string[] = [];

    for (const templateSource of loadTemplateSources()) {
      const parsed = parseTemplate(templateSource.html, templateSource.relativePath, {
        preserveWhitespaces: true,
      });
      if (parsed.errors && parsed.errors.length > 0) {
        parseFailures.push(
          `${templateSource.relativePath}: ${parsed.errors.map((e) => e.toString()).join('; ')}`,
        );
        continue;
      }
      const visitor = new ClickHandlerVisitor(templateSource.relativePath, templateSource.baseLine);
      tmplAstVisitAll(visitor, parsed.nodes as TmplAstNode[]);
      violations.push(...visitor.violations);
    }

    expect(
      parseFailures,
      `Guardian could not parse ${parseFailures.length} template(s) — fix extraction/template syntax:\n${parseFailures.join('\n')}`,
    ).toEqual([]);

    expect(
      violations,
      `Found ${violations.length} (click) handler(s) on non-interactive elements without full keyboard support:\n\n` +
        violations.map(formatViolation).join('\n\n'),
    ).toEqual([]);
  });
});
