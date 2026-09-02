import { Injectable, signal } from '@angular/core';

export type LiveRegionPoliteness = 'polite' | 'assertive';

/**
 * D3 (audit M12): "carga y éxito no se anuncian; solo los errores tienen
 * `role="alert"`". A visual toast/banner is invisible to a screen-reader user
 * unless something with `aria-live` changes text — this service is that
 * signal-backed message bus, read by the single `ui-live-region` sink
 * (`LiveRegionComponent`) so the whole app shares ONE live region instead of
 * a new one per feature (multiple concurrent `aria-live` regions is its own
 * a11y footgun — announcements can interleave or get dropped by AT).
 *
 * `providedIn: 'root'` — any component can inject and call `announce()`
 * without wiring; only the mounted `ui-live-region` needs to exist somewhere
 * in the tree for the announcement to reach assistive tech.
 */
@Injectable({ providedIn: 'root' })
export class LiveAnnouncerService {
  private readonly _message = signal('');
  private readonly _politeness = signal<LiveRegionPoliteness>('polite');
  /**
   * Bumped on every `announce()` call, including a repeat of the exact same
   * message (audit crop-review/live-region #7): `signal.set()` compares with
   * `Object.is`, so two consecutive identical announcements would otherwise
   * leave `message()` unchanged — nothing for `LiveRegionComponent`'s
   * template to re-render, so the DOM text never actually changes and
   * assistive tech never re-announces it. `LiveRegionComponent` mixes this
   * into the rendered text as an invisible marker so its DOM node's text
   * content changes even when the message repeats verbatim. `message()`
   * itself stays the exact string passed in — this is a separate signal so
   * callers reading `message()` directly (tests included) keep getting back
   * exactly what they announced.
   */
  private readonly _revision = signal(0);

  readonly message = this._message.asReadonly();
  readonly politeness = this._politeness.asReadonly();
  readonly revision = this._revision.asReadonly();

  /**
   * `politeness` defaults to `'polite'` (queued after the AT's current
   * speech) — the right default for routine state changes ("Pregunta
   * guardada."). Pass `'assertive'` only for something that must interrupt,
   * the aria-live equivalent of the existing `role="alert"` error banners.
   */
  announce(message: string, politeness: LiveRegionPoliteness = 'polite'): void {
    this._politeness.set(politeness);
    this._message.set(message);
    this._revision.update((n) => n + 1);
  }
}
