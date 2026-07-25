import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

/**
 * In-process pub/sub bridging `ExamVersionJobsProcessor` (writes) to
 * `ExamsController`'s `GET :examId/versions/jobs/:jobId/stream` SSE endpoint
 * (reads) — the worker and the HTTP server share one Nest process, so a
 * plain `Subject` pushes progress live with zero polling on either side.
 * Same contract as `GenerationJobEventsService`: `notify()` must be called
 * AFTER the triggering DB write commits, so a subscriber that reacts by
 * re-fetching the row never races the write that caused it.
 */
@Injectable()
export class ExamVersionJobEventsService {
  private readonly subject = new Subject<string>();
  readonly updates$ = this.subject.asObservable();

  notify(jobId: string): void {
    this.subject.next(jobId);
  }
}
