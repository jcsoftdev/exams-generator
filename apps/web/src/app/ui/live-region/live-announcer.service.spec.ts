import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { LiveAnnouncerService } from './live-announcer.service';

describe('LiveAnnouncerService', () => {
  it('defaults to an empty, polite message', () => {
    const service = TestBed.inject(LiveAnnouncerService);
    expect(service.message()).toBe('');
    expect(service.politeness()).toBe('polite');
  });

  it('announce() sets the message, defaulting to polite politeness', () => {
    const service = TestBed.inject(LiveAnnouncerService);
    service.announce('Pregunta guardada.');

    expect(service.message()).toBe('Pregunta guardada.');
    expect(service.politeness()).toBe('polite');
  });

  it('announce() accepts an explicit politeness', () => {
    const service = TestBed.inject(LiveAnnouncerService);
    service.announce('No se pudo guardar.', 'assertive');

    expect(service.message()).toBe('No se pudo guardar.');
    expect(service.politeness()).toBe('assertive');
  });

  // audit crop-review/live-region #7: two consecutive identical announce()
  // calls left `message()` at the same value (Object.is no-op for the
  // signal), so a LiveRegionComponent bound only to `message()` never
  // re-rendered its DOM text and assistive tech never re-announced it.
  // `revision()` is the escape hatch — it changes on every call, message or not.
  it('bumps revision() on every announce() call, even a repeat of the same message', () => {
    const service = TestBed.inject(LiveAnnouncerService);

    service.announce('Pregunta guardada.');
    const first = service.revision();

    service.announce('Pregunta guardada.');
    const second = service.revision();

    expect(service.message()).toBe('Pregunta guardada.');
    expect(second).not.toBe(first);
  });
});
