import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FileUploadComponent } from './file-upload.component';

function setup() {
  TestBed.configureTestingModule({ imports: [FileUploadComponent] });
  const fixture = TestBed.createComponent(FileUploadComponent);
  const compiled = fixture.nativeElement as HTMLElement;
  return { fixture, compiled };
}

function dropEventWith(file: File | null): Event {
  const event = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { files: file ? [file] : [] },
  });
  return event;
}

describe('FileUploadComponent', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [FileUploadComponent] });
  });

  it('renders the label and, with no file picked, the hint text', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('label', 'Imagen del enunciado');
    fixture.componentRef.setInput('hint', 'Arrastra una imagen o haz clic para elegirla');
    fixture.detectChanges();

    expect(compiled.textContent).toContain('Imagen del enunciado');
    expect(compiled.textContent).toContain('Arrastra una imagen o haz clic para elegirla');
    expect(compiled.querySelector('img')).toBeFalsy();
  });

  it('renders the preview image and filename once previewUrl/fileName are set', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('testIdPrefix', 'image-upload');
    fixture.componentRef.setInput('previewUrl', 'blob:fake-url');
    fixture.componentRef.setInput('fileName', 'foto.png');
    fixture.detectChanges();

    const img = compiled.querySelector<HTMLImageElement>('[data-testid="image-upload-preview"]');
    expect(img?.src).toBe('blob:fake-url');
    expect(compiled.querySelector('[data-testid="image-upload-filename"]')?.textContent).toContain(
      'foto.png',
    );
    expect(compiled.querySelector('[data-testid="image-upload-change"]')).toBeTruthy();
  });

  it('keeps the native file input hidden (sr-only) under the host testIdPrefix', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('testIdPrefix', 'image-upload');
    fixture.detectChanges();

    expect(compiled.querySelector('[data-testid="image-upload"]')).toBeTruthy();
    const input = compiled.querySelector<HTMLInputElement>(
      '[data-testid="image-upload"] input[type="file"]',
    );
    expect(input).toBeTruthy();
    expect(input!.classList.contains('sr-only')).toBe(true);
  });

  it('emits fileSelected when a file is picked via the native input', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();
    const emitted: File[][] = [];
    fixture.componentInstance.fileSelected.subscribe((files) => emitted.push(files));
    const file = new File(['x'], 'foto.png', { type: 'image/png' });
    const input = compiled.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    input.dispatchEvent(new Event('change'));

    expect(emitted).toEqual([[file]]);
  });

  it('emits fileSelected with the dropped file — real drag-and-drop, not just the native picker', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();
    const emitted: File[][] = [];
    fixture.componentInstance.fileSelected.subscribe((files) => emitted.push(files));
    const file = new File(['x'], 'grafico.png', { type: 'image/png' });
    const dropZone = compiled.querySelector('label')!;

    dropZone.dispatchEvent(dropEventWith(file));

    expect(emitted).toEqual([[file]]);
  });

  it('shows a visible drag-over style while a file is dragged over the control, cleared again on drop', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();
    const dropZone = compiled.querySelector('label')!;
    const initialClass = dropZone.className;

    const dragOverEvent = new Event('dragover', { bubbles: true, cancelable: true });
    dropZone.dispatchEvent(dragOverEvent);
    fixture.detectChanges();
    expect(dropZone.className).not.toBe(initialClass);

    dropZone.dispatchEvent(dropEventWith(new File(['x'], 'a.png', { type: 'image/png' })));
    fixture.detectChanges();
    expect(dropZone.className).toBe(initialClass);
  });

  it('opens the file picker on Enter or Space while the control has focus (keyboard access)', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();
    const input = compiled.querySelector<HTMLInputElement>('input[type="file"]')!;
    const clickSpy = vi
      .spyOn(HTMLInputElement.prototype, 'click')
      .mockImplementation(() => undefined);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));

    expect(clickSpy).toHaveBeenCalledTimes(2);
    clickSpy.mockRestore();
  });

  it('ignores a drop while disabled', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();
    const emitted: File[][] = [];
    fixture.componentInstance.fileSelected.subscribe((files) => emitted.push(files));
    const dropZone = compiled.querySelector('label')!;

    dropZone.dispatchEvent(dropEventWith(new File(['x'], 'a.png', { type: 'image/png' })));

    expect(emitted).toEqual([]);
  });

  it('marks the native input disabled when disabled=true', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    expect(compiled.querySelector('input[type="file"]')?.hasAttribute('disabled')).toBe(true);
  });

  /**
   * `webkitdirectory` does not ADD folder picking, it REPLACES the dialog: with
   * the attribute present the browser only offers a directory chooser, so a
   * teacher can no longer pick one image — and `accept` stops being honoured.
   * It has to be opt-in, which is what these two cover.
   */
  it('picks files, not folders, by default — no webkitdirectory on the native input', () => {
    const { fixture, compiled } = setup();
    fixture.detectChanges();

    const input = compiled.querySelector('input[type="file"]')!;
    expect(input.hasAttribute('webkitdirectory')).toBe(false);
    expect(input.hasAttribute('multiple')).toBe(true);
  });

  it('picks folders only when directory=true', () => {
    const { fixture, compiled } = setup();
    fixture.componentRef.setInput('directory', true);
    fixture.detectChanges();

    expect(compiled.querySelector('input[type="file"]')!.hasAttribute('webkitdirectory')).toBe(
      true,
    );
  });
});
