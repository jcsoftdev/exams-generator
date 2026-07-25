import { ExamVersionJob } from '../exam-versions/exam-versions.models';
import { GenerateQuestionStreamEvent, GenerationJob } from './ai.models';

export interface ParsedStreamFrames<T> {
  readonly events: readonly T[];
  readonly remainder: string;
}

/**
 * Parses `data: {...}\n\n` frames (our own SSE-shaped wire format) out of
 * `buffer`. `buffer` must be the UNCONSUMED tail from the previous call
 * (`remainder`) plus whatever new text just arrived — stateless, no
 * internal buffering. Generic over the frame payload type: both
 * `AiController.generateStream` (`GenerateQuestionStreamEvent`) and
 * `AiJobsController`'s job-progress stream (`GenerationJob`) write this
 * exact shape.
 */
function parseSseFrames<T>(buffer: string): ParsedStreamFrames<T> {
  const frames = buffer.split('\n\n');
  const remainder = frames.pop() ?? '';
  const events: T[] = [];

  for (const frame of frames) {
    const dataLine = frame.split('\n').find((line) => line.startsWith('data:'));
    if (!dataLine) continue;
    const payload = dataLine.slice('data:'.length).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload) as T);
    } catch {
      // Malformed frame — skip rather than crash the whole stream.
    }
  }

  return { events, remainder };
}

export function parseGenerateStreamFrames(buffer: string): ParsedStreamFrames<GenerateQuestionStreamEvent> {
  return parseSseFrames<GenerateQuestionStreamEvent>(buffer);
}

export function parseGenerationJobStreamFrames(buffer: string): ParsedStreamFrames<GenerationJob> {
  return parseSseFrames<GenerationJob>(buffer);
}

/** `ExamsController`'s version-job progress stream writes the same frame shape (`ExamVersionsService.streamVersionJob`). */
export function parseExamVersionJobStreamFrames(buffer: string): ParsedStreamFrames<ExamVersionJob> {
  return parseSseFrames<ExamVersionJob>(buffer);
}
