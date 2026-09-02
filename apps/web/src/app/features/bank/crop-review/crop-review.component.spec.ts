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

  it('resizes via a pointerdown on the enlarged handle wrapper, not the 8px dot (jsdom cannot hit-test a 15px offset)', async () => {
    // jsdom has no hit-testing — dispatching a pointerdown always fires on
    // whichever element `dispatchEvent` is called on, never on "whatever a
    // real browser would find under these coordinates". So this test cannot
    // actually prove a pointerdown 15px outside the visible 8px dot still
    // starts a resize the way a real browser would; the 44x44 inline-size
    // assertion in the previous test IS that hit-area evidence. What this
    // test DOES prove: a pointerdown on the handle WRAPPER (its real DOM hit
    // target, sized well past the 8px dot) drives `startResize`'s coordinate
    // math correctly end to end.
    const fixture = await render([SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    const container = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-container"]',
    )!;
    stubRect(container, 200, 100);

    // The `se` handle sits at the box's bottom-right corner: box {x:.1,y:.1,
    // w:.5,h:.5} on a 200x100 container puts its corner at clientX 120,
    // clientY 60.
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

  it('keeps a real 24px move strip by shrinking the w/e handles when the box is narrower than two 44px wrappers (audit #1)', async () => {
    const NARROW_SLOT: CropSlot = {
      ...SLOT,
      box: { x: 0.3, y: 0.1, w: 0.2, h: 0.5 },
    };
    // Stubbed on the PROTOTYPE, and set up before the container div even
    // exists (`render()` does the first, real render below) — `handleSize`
    // reads the rect from inside a template expression, which on an OnPush
    // view is only re-evaluated on a render Angular actually runs. Stubbing
    // an per-instance rect only AFTER that first render — the container
    // element has to exist to spy on it — would need a SECOND render to
    // pick it up, and nothing here (no input change, no template-bound
    // event) gives Angular a reason to schedule one. Stubbing the prototype
    // up front sidesteps that entirely: the very first render already
    // measures 256x128.
    const rectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 256,
      bottom: 128,
      width: 256,
      height: 128,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const fixture = await render([NARROW_SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    const container = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-container"]',
    )!;

    // Box width = 0.2 * 256 = 51.2px — narrower than two 44px handles placed
    // side by side (88px). `w` and `e` must each shrink to 51.2 - 24 =
    // 27.2px so a real 24px strip survives in the middle for MOVE.
    const handles = container.querySelectorAll<HTMLElement>('[data-testid="crop-resize-handle"]');
    const wHandle = handles[7]; // RESIZE_HANDLES = ['nw','n','ne','e','se','s','sw','w']
    const eHandle = handles[3];
    expect(parseFloat(wHandle.style.width)).toBeCloseTo(27.2, 5);
    expect(parseFloat(eHandle.style.width)).toBeCloseTo(27.2, 5);

    // A pointerdown reaching the CONTAINER (as it would in a real browser
    // once the shrunk handles no longer cover the centre) at the box's own
    // centre — x: 0.3 + 0.1 = 0.4 of 256 = 102.4 — still starts a MOVE, not a
    // resize: the box shifts without changing size.
    const centerX = 0.4 * 256;
    const centerY = 0.35 * 128;
    dispatchPointer(container, 'pointerdown', centerX, centerY);
    dispatchPointer(container, 'pointermove', centerX + 10, centerY);
    dispatchPointer(container, 'pointerup', centerX + 10, centerY);

    expect(emitted.length).toBe(1);
    const event = emitted[0] as { box: { x: number; y: number; w: number; h: number } };
    expect(event.box.w).toBeCloseTo(0.2, 10);
    expect(event.box.h).toBeCloseTo(0.5, 10);

    rectSpy.mockRestore();
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

  it('makes the crop box focusable with a group role and an instructive aria-label built from the slot label', async () => {
    const fixture = await render([SLOT]);

    const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-box"]',
    )!;

    expect(box.getAttribute('tabindex')).toBe('0');
    expect(box.getAttribute('role')).toBe('group');
    expect(box.getAttribute('aria-label')).toBe(
      'Figura del enunciado, usa las flechas para mover y Shift+flechas para redimensionar',
    );
  });

  it('gives each slot its OWN aria-label instead of a shared one — audit crop-review #4', async () => {
    const fixture = await render([
      SLOT,
      { ...SLOT, target: { kind: 'alternative', alternativeIndex: 2 }, label: 'Alternativa c)' },
    ]);

    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '[data-testid="crop-box"]',
      ),
    ).map((box) => box.getAttribute('aria-label'));

    expect(labels).toEqual([
      'Figura del enunciado, usa las flechas para mover y Shift+flechas para redimensionar',
      'Alternativa c), usa las flechas para mover y Shift+flechas para redimensionar',
    ]);
    // Different slots, so the two labels must not collide.
    expect(labels[0]).not.toBe(labels[1]);
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

  it('does not emit recrop on Enter with no pending arrow-key edit — audit crop-review #2', async () => {
    const fixture = await render([SLOT]);
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));

    const box = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(
      '[data-testid="crop-box"]',
    )!;
    box.focus();

    // Enter pressed straight away, with no ArrowLeft/Right/Up/Down first —
    // there is nothing to apply, so this must be a silent no-op rather than
    // a wasted `recrop` for the slot's own unchanged box.
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(emitted).toEqual([]);
  });

  it('clears a pending arrow-key edit once a mouse drag starts on the same slot — audit crop-review #3', async () => {
    const fixture = await render([SLOT]);
    const compiled = fixture.nativeElement as HTMLElement;

    const box = compiled.querySelector<HTMLElement>('[data-testid="crop-box"]')!;
    box.focus();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(parseFloat(box.style.left)).toBeCloseTo(11, 6);

    const container = compiled.querySelector<HTMLElement>('[data-testid="crop-container"]')!;
    stubRect(container, 200, 100);
    // A drag that starts and releases with no movement in between never
    // calls `applyBox`, so the slot's own box (from `slots()`) stays exactly
    // what it was — x: 0.1 — which is what makes this a clean way to check
    // whether the pending key edit survived the drag.
    dispatchPointer(container, 'pointerdown', 20, 10);
    dispatchPointer(container, 'pointerup', 20, 10);
    fixture.detectChanges();

    // Without the fix, `boxFor` would fall through to the stale key edit
    // (11%) once drag state resets — the drag having started must have
    // discarded it instead, so the box follows the slot's real (unmoved)
    // box, not the key edit from before the drag.
    expect(parseFloat(box.style.left)).toBeCloseTo(10, 6);
  });

  it('keeps each slot’s pending arrow-key edit independent — audit crop-review #5', async () => {
    const SLOT_B: CropSlot = {
      ...SLOT,
      target: { kind: 'alternative', alternativeIndex: 0 },
      label: 'Alternativa a)',
      box: { x: 0.05, y: 0.05, w: 0.2, h: 0.2 },
    };
    const fixture = await render([SLOT, SLOT_B]);
    const compiled = fixture.nativeElement as HTMLElement;
    const boxes = compiled.querySelectorAll<HTMLElement>('[data-testid="crop-box"]');
    const [firstBox, secondBox] = [boxes[0], boxes[1]];

    // Arrow-edit the FIRST slot only, twice.
    firstBox.focus();
    firstBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    firstBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(parseFloat(firstBox.style.left)).toBeCloseTo(12, 6);
    // The second slot was never touched — its own box is untouched too.
    expect(parseFloat(secondBox.style.left)).toBeCloseTo(5, 6);

    // Now arrow-edit the SECOND slot — this must not discard the first
    // slot's still-pending edit.
    secondBox.focus();
    secondBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    expect(parseFloat(secondBox.style.top)).toBeCloseTo(6, 6);
    expect(parseFloat(firstBox.style.left)).toBeCloseTo(12, 6);

    // Applying the first slot's edit only resolves ITS pending edit.
    const emitted: unknown[] = [];
    fixture.componentInstance.recrop.subscribe((event) => emitted.push(event));
    firstBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(emitted.length).toBe(1);
    const event = emitted[0] as { target: unknown; box: { x: number } };
    expect(event.target).toEqual({ kind: 'figure' });
    expect(event.box.x).toBeCloseTo(0.12, 6);
    // The second slot's pending edit is still there, unresolved.
    expect(parseFloat(secondBox.style.top)).toBeCloseTo(6, 6);
  });

  it('clears every pending arrow-key edit once the slots input changes — audit crop-review #3', async () => {
    const fixture = await render([SLOT]);
    const compiled = fixture.nativeElement as HTMLElement;

    const box = compiled.querySelector<HTMLElement>('[data-testid="crop-box"]')!;
    box.focus();
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    fixture.detectChanges();
    expect(parseFloat(box.style.left)).toBeCloseTo(11, 6);

    // The caller pushes a fresh `slots` value (e.g. the server's response to
    // an unrelated recrop) — any stale pending edit must not survive it.
    fixture.componentRef.setInput('slots', [SLOT]);
    fixture.detectChanges();

    expect(parseFloat(box.style.left)).toBeCloseTo(10, 6);
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
