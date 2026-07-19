import { Injectable, inject, signal } from '@angular/core';
import { AiService } from './ai.service';

/**
 * Lightweight pending-drafts counter for the sidebar badge ("Cola de
 * revisión · N", design doc §4 pantalla 4 / shell fix #6). Deliberately NOT
 * `AiService.listDrafts()` called directly from the shell — that would fire
 * a request on every shell render (every route change). Instead this
 * `providedIn: 'root'` singleton fetches the count exactly ONCE on
 * construction (first time it's injected, i.e. app start), and the review
 * queue component (`AiReviewQueueComponent`) keeps it in sync afterwards by
 * calling `set()` whenever its own `listDrafts()` response arrives or a
 * draft is approved/rejected — no extra network round-trips beyond what the
 * review queue already does.
 */
@Injectable({ providedIn: 'root' })
export class DraftCountService {
  private readonly aiService = inject(AiService);

  /** `null` = not loaded yet (or the initial fetch failed) — the sidebar renders no badge in that case. */
  readonly count = signal<number | null>(null);

  constructor() {
    this.refresh();
  }

  /** Re-fetches the count from the server. Safe to call repeatedly (e.g. on retry). */
  refresh(): void {
    this.aiService.listDrafts().subscribe({
      next: (drafts) => this.count.set(drafts.length),
      error: () => {
        /* leave count as-is (or null) — the sidebar simply omits the badge */
      },
    });
  }

  /** Pushes a fresh count without a round-trip — used by the review queue after it loads/approves/rejects. */
  set(value: number): void {
    this.count.set(value);
  }
}
