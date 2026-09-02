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
});
