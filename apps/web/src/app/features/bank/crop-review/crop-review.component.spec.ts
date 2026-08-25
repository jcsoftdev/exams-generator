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
