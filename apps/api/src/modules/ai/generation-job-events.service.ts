import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

/**
 * In-process pub/sub bridging `GenerationJobsProcessor` (writes) to
 * `AiJobsController`'s `GET :id/stream` SSE endpoint (reads) — the worker
 * and the HTTP server share one Nest process here, so a plain `Subject` is
 * enough to push job updates live with zero polling on either side.
 * `notify()` must be called AFTER the triggering DB write commits, so a
 * subscriber that reacts to an emission by re-fetching the row never races
 * the write that caused it.
 */
@Injectable()
export class GenerationJobEventsService {
  private readonly subject = new Subject<string>();
  readonly updates$ = this.subject.asObservable();

  notify(jobId: string): void {
    this.subject.next(jobId);
  }
}
