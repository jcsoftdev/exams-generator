import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CropReviewComponent, CropSlot, clampMove, clampResize } from './crop-review.component';

/**
 * jsdom has no `PointerEvent` and `getBoundingClientRect()` always returns
 * zeros, so a real drag has to be faked at both layers: dispatch a
 * `MouseEvent` under the `pointerdown`/`pointermove`/`pointerup` type names
 * (Angular binds by event name, not by constructor, so this reaches the same
 * `(pointerdown)` etc. handlers a real PointerEvent would) and stub the
 * container's rect so clientX/clientY convert to predictable fractions.
 */
function stubRect(el: HTMLElement, width: number, height: number): void {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    left: 0,
    top: 0,
    right: width,
    bottom: height,
    width,
    height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function dispatchPointer(el: HTMLElement, type: string, clientX: number, clientY: number): void {
  el.dispatchEvent(new MouseEvent(type, { clientX, clientY, bubbles: true }));
}

const SLOT: CropSlot = {
  target: { kind: 'figure' },
  label: 'Figura del enunciado',
  dataUrl: 'data:image/png;base64,AAAA',
  box: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
  busy: false,
};

async function render(slots: readonly CropSlot[]): Promise<ComponentFixture<CropReviewComponent>> {
  await TestBed.configureTestingModule({ imports: [CropReviewComponent] }).compileComponents();
  const fixture = TestBed.createComponent(CropReviewComponent);
  fixture.componentRef.setInput('photoUrl', 'blob:photo');
  fixture.componentRef.setInput('slots', slots);
  fixture.detectChanges();
  return fixture;
}

describe('CropReviewComponent', () => {
  it('renders nothing at all when there are no slots', async () => {
    const fixture = await render([]);

    expect(fixture.nativeElement.querySelector('[data-testid="crop-slot"]')).toBeNull();
  });

  it('renders one slot per crop, labelled', async () => {
    const fixture = await render([
      SLOT,
      { ...SLOT, target: { kind: 'alternative', alternativeIndex: 2 }, label: 'Alternativa c)' },
    ]);

    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '[data-testid="crop-slot-label"]',
      ),
    ).map((el) => el.textContent?.trim());
    expect(labels).toEqual(['Figura del enunciado', 'Alternativa c)']);
  });

  it('emits recrop with the slot target and the adjusted box', async () => {
    const fixture = await render([SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    fixture.componentInstance.applyBox(SLOT.target, { x: 0.2, y: 0.2, w: 0.3, h: 0.3 });

    expect(emitted).toEqual([
      { target: { kind: 'figure' }, box: { x: 0.2, y: 0.2, w: 0.3, h: 0.3 } },
    ]);
  });

  it('emits discard when the teacher removes a crop the AI invented', async () => {
    const fixture = await render([SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.discard.subscribe((event) => emitted.push(event));

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="crop-discard"]')!
      .click();

    expect(emitted).toEqual([{ kind: 'figure' }]);
  });

  it('does not emit recrop while that slot is busy', async () => {
    const fixture = await render([{ ...SLOT, busy: true }]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    fixture.componentInstance.applyBox(SLOT.target, { x: 0.2, y: 0.2, w: 0.3, h: 0.3 });

    expect(emitted).toEqual([]);
  });

  it('drags the rectangle across the real DOM and emits exactly one recrop on release', async () => {
    const fixture = await render([SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    const container = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-container"]',
    )!;
    stubRect(container, 200, 100);

    // Pointer starts exactly on the box's own origin (0.1, 0.1 of a 200x100
    // rect = clientX 20, clientY 10), then moves three times before release —
    // only the LAST position should end up in the emitted box, and only ONE
    // recrop should fire despite the three intermediate moves.
    dispatchPointer(container, 'pointerdown', 20, 10);
    dispatchPointer(container, 'pointermove', 40, 20);
    dispatchPointer(container, 'pointermove', 50, 25);
    dispatchPointer(container, 'pointermove', 60, 30);
    dispatchPointer(container, 'pointerup', 60, 30);

    expect(emitted.length).toBe(1);
    expect(emitted[0]).toEqual({
      target: { kind: 'figure' },
      box: { x: 0.3, y: 0.3, w: 0.5, h: 0.5 },
    });
  });

  it('renders each resize handle with an interactive hit area of at least 44x44 CSS px', async () => {
    const fixture = await render([SLOT]);

    const handles = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '[data-testid="crop-resize-handle"]',
    );

    expect(handles.length).toBe(8);
    handles.forEach((handle) => {
      expect(handle.style.width).toBe('44px');
      expect(handle.style.height).toBe('44px');
    });
  });

  it('starts a resize from a pointerdown 15 px outside the visible 8 px dot', async () => {
    const fixture = await render([SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    const container = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-container"]',
    )!;
    stubRect(container, 200, 100);

    // The `se` handle sits at the box's bottom-right corner: box {x:.1,y:.1,
    // w:.5,h:.5} on a 200x100 container puts its corner at clientX 120,
    // clientY 60. The visible dot there is only 8 px across, but a
    // pointerdown 15 px outside it (135, 75) must still land inside the
    // enlarged 44x44 hit area and start the resize rather than falling
    // through to the container's own `startMove`.
    const handles = container.querySelectorAll<HTMLElement>('[data-testid="crop-resize-handle"]');
    const seHandle = handles[4]; // RESIZE_HANDLES = ['nw','n','ne','e','se','s','sw','w']

    dispatchPointer(seHandle, 'pointerdown', 135, 75);
    dispatchPointer(container, 'pointermove', 145, 85);
    dispatchPointer(container, 'pointerup', 145, 85);

    expect(emitted.length).toBe(1);
    const event = emitted[0] as {
      target: unknown;
      box: { x: number; y: number; w: number; h: number };
    };
    expect(event.target).toEqual({ kind: 'figure' });
    expect(event.box.x).toBeCloseTo(0.1, 10);
    expect(event.box.y).toBeCloseTo(0.1, 10);
    expect(event.box.w).toBeCloseTo(0.55, 10);
    expect(event.box.h).toBeCloseTo(0.6, 10);
  });

  it('does not emit recrop for a plain click with no movement between pointerdown and pointerup', async () => {
    const fixture = await render([SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    const container = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-container"]',
    )!;
    stubRect(container, 200, 100);

    // Same spot down and up — no pointermove in between at all. The teacher
    // just tapped the photo (or grabbed a handle and let go without
    // dragging); the box never changed, so no HTTP round trip should fire.
    dispatchPointer(container, 'pointerdown', 20, 10);
    dispatchPointer(container, 'pointerup', 20, 10);

    expect(emitted.length).toBe(0);
  });

  it('makes the crop box focusable with a group role and an instructive aria-label', async () => {
    const fixture = await render([SLOT]);

    const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-box"]',
    )!;

    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('role')).toBe('group');
    expect(box.getAttribute('aria-label')).toBe(
      'Recorte de la figura, usa las flechas para mover y Shift+flechas para redimensionar',
    );
  });

  it('shows a visible keyboard instructions hint under the editor', async () => {
    const fixture = await render([SLOT]);

    const hint = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-keyboard-hint"]',
    );

    expect(hint?.textContent?.trim()).toBe(
      'Arrastra la caja o usa las flechas; Shift+flechas cambia el tamaño; Enter aplica.',
    );
  });

  it('moves the box right by 1% per ArrowRight press and applies it on Enter', async () => {
    const fixture = await render([SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-box"]',
    )!;
    box.focus();

    for (let i = 0; i < 3; i++) {
      box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    }
    fixture.detectChanges();

    // Box started at x: 0.1 (10%) — three 1% presses move it to 13%.
    expect(parseFloat(box.style.left)).toBeCloseTo(13, 6);

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(emitted.length).toBe(1);
    const event = emitted[0] as {
      target: unknown;
      box: { x: number; y: number; w: number; h: number };
    };
    expect(event.target).toEqual({ kind: 'figure' });
    expect(event.box.x).toBeCloseTo(0.13, 6);
    expect(event.box.y).toBeCloseTo(0.1, 6);
    expect(event.box.w).toBeCloseTo(0.5, 6);
    expect(event.box.h).toBeCloseTo(0.5, 6);
  });

  it('moves the box by 10% per ArrowRight press when Ctrl is held', async () => {
    const fixture = await render([SLOT]);

    const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-box"]',
    )!;
    box.focus();

    box.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', ctrlKey: true, bubbles: true }),
    );
    fixture.detectChanges();

    expect(parseFloat(box.style.left)).toBeCloseTo(20, 6);
  });

  it('grows the box height by 1% on Shift+ArrowDown, through the same clamp as the pointer path', async () => {
    const fixture = await render([SLOT]);

    const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-box"]',
    )!;
    box.focus();

    box.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }),
    );
    fixture.detectChanges();

    // Growing from the bottom edge: top/left/width stay put, only height grows.
    expect(parseFloat(box.style.top)).toBeCloseTo(10, 6);
    expect(parseFloat(box.style.left)).toBeCloseTo(10, 6);
    expect(parseFloat(box.style.width)).toBeCloseTo(50, 6);
    expect(parseFloat(box.style.height)).toBeCloseTo(51, 6);
  });

  it('reverts to the slot original box on Escape', async () => {
    const fixture = await render([SLOT]);

    const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-box"]',
    )!;
    box.focus();

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(parseFloat(box.style.left)).toBeCloseTo(12, 6);

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();

    expect(parseFloat(box.style.left)).toBeCloseTo(10, 6);
  });

  it('ignores keyboard input while the slot is busy', async () => {
    const fixture = await render([{ ...SLOT, busy: true }]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-box"]',
    )!;

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(parseFloat(box.style.left)).toBeCloseTo(10, 6);

    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(emitted).toEqual([]);
  });
});

describe('clampMove — keeps a dragged box inside the 0..1 canvas', () => {
  const BOX = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 };

  it('clamps to the left/top edge without shrinking the box', () => {
    const result = clampMove(BOX, -0.5, -0.5);

    expect(result).toEqual({ x: 0, y: 0, w: 0.3, h: 0.2 });
  });

  it('clamps to the right/bottom edge so x + w <= 1 and y + h <= 1', () => {
    const result = clampMove(BOX, 0.9, 0.9);

    expect(result.x + result.w).toBeLessThanOrEqual(1);
    expect(result.y + result.h).toBeLessThanOrEqual(1);
    expect(result).toEqual({ x: 0.7, y: 0.8, w: 0.3, h: 0.2 });
  });
});

describe('clampResize — never lets a handle collapse the box past the API bound', () => {
  const BOX = { x: 0.1, y: 0.1, w: 0.3, h: 0.2 };

  it('prevents a non-positive width when the west handle is dragged past the east edge', () => {
    const result = clampResize(BOX, 'w', 0.9, 0);

    expect(result.w).toBeGreaterThan(0);
    expect(result.x + result.w).toBeCloseTo(BOX.x + BOX.w, 10);
  });

  it('prevents a non-positive height when the north handle is dragged past the south edge', () => {
    const result = clampResize(BOX, 'n', 0, 0.9);

    expect(result.h).toBeGreaterThan(0);
    expect(result.y + result.h).toBeCloseTo(BOX.y + BOX.h, 10);
  });
});
