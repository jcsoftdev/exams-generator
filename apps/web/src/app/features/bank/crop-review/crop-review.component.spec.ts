import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CropReviewComponent, CropSlot } from './crop-review.component';

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
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('[data-testid="crop-slot-label"]'),
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
});
