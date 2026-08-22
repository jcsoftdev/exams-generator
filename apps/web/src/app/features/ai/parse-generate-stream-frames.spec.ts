import { describe, it, expect } from 'vitest';
import {
  parseGenerateStreamFrames,
  parseGenerationJobStreamFrames,
} from './parse-generate-stream-frames';

function frame(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

describe('parseGenerateStreamFrames', () => {
  it('parses one complete frame into its event, with an empty remainder', () => {
    const { events, remainder } = parseGenerateStreamFrames(frame({ type: 'delta', text: 'Hola' }));

    expect(events).toEqual([{ type: 'delta', text: 'Hola' }]);
    expect(remainder).toBe('');
  });

  it('parses multiple complete frames in order', () => {
    const buffer = frame({ type: 'delta', text: 'Hola' }) + frame({ type: 'restart' });

    const { events } = parseGenerateStreamFrames(buffer);

    expect(events).toEqual([{ type: 'delta', text: 'Hola' }, { type: 'restart' }]);
  });

  it('keeps an incomplete trailing frame in remainder instead of dropping or crashing', () => {
    const complete = frame({ type: 'delta', text: 'Hola' });
    const incomplete = frame({ type: 'delta', text: 'Mundo' }).slice(0, 10);

    const { events, remainder } = parseGenerateStreamFrames(complete + incomplete);

    expect(events).toEqual([{ type: 'delta', text: 'Hola' }]);
    expect(remainder).toBe(incomplete);
  });

  it('skips a malformed frame instead of throwing', () => {
    const { events } = parseGenerateStreamFrames('data: not json\n\n');

    expect(events).toEqual([]);
  });

  it('returns no events for an empty buffer', () => {
    expect(parseGenerateStreamFrames('')).toEqual({ events: [], remainder: '' });
  });
});

describe('parseGenerationJobStreamFrames', () => {
  it('parses one complete job frame, keeping an incomplete trailer in remainder', () => {
    const complete = frame({ id: 'job-1', status: 'running', createdCount: 1 });
    const incomplete = frame({ id: 'job-1', status: 'completed' }).slice(0, 10);

    const { events, remainder } = parseGenerationJobStreamFrames(complete + incomplete);

    expect(events).toEqual([{ id: 'job-1', status: 'running', createdCount: 1 }]);
    expect(remainder).toBe(incomplete);
  });
});
