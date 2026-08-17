import { Injectable, inject, signal } from '@angular/core';
import { AiService } from './ai.service';

/**
 * Lightweight pending-drafts counter for the sidebar badge ("Cola de
 * revisión · N", design doc §4 pantalla 4 / shell fix #6). Deliberately NOT
 * a full drafts fetch called directly from the shell — that would fire a
 * request on every shell render (every route change). Instead this
 * `providedIn: 'root'` singleton fetches the count exactly ONCE on
 * construction (first time it's injected, i.e. app start), and both
 * `AiReviewQueueComponent` and `GenerationJobDetailComponent` keep it in
 * sync afterwards — the former calling `set()` with the server `total`
 * whenever its own `listDraftsPaged()` response arrives or a draft is
 * approved/rejected/saved, the latter calling `refresh()` after resolving
 * newly-created ids via `getDraft()` (it never has the full queue in hand to
 * derive a count from) — no extra network round-trips beyond what those
 * screens already do.
 *
 * `refresh()` calls `AiService.countDrafts()` — the badge only needs a
 * number, never the actual draft rows. Downloading every draft row just to
 * call `.length` on it was the exact shape of the central-bank P0
 * (`/app/bank` downloading 41MB) — harmless at 0 drafts, but the same defect
 * waiting for a bulk AI-generation run (docs/audit-2026-08-14.md).
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
    this.aiService.countDrafts().subscribe({
      next: (total) => this.count.set(total),
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
