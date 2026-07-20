import { GenerateQuestionStreamEvent } from './ai.models';

export interface ParsedStreamFrames {
  readonly events: readonly GenerateQuestionStreamEvent[];
  readonly remainder: string;
}

/**
 * Parses `data: {...}\n\n` frames (our own SSE-shaped wire format, written
 * by `AiController.generateStream`) out of `buffer`. `buffer` must be the
 * UNCONSUMED tail from the previous call (`remainder`) plus whatever new
 * text just arrived — stateless, no internal buffering.
 */
export function parseGenerateStreamFrames(buffer: string): ParsedStreamFrames {
  const frames = buffer.split('\n\n');
  const remainder = frames.pop() ?? '';
  const events: GenerateQuestionStreamEvent[] = [];

  for (const frame of frames) {
    const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const payload = dataLine.slice('data:'.length).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload) as GenerateQuestionStreamEvent);
    } catch {
      // Malformed frame — skip rather than crash the whole stream.
    }
  }

  return { events, remainder };
}
