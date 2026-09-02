import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { LiveAnnouncerService } from './live-announcer.service';

/** Every other character toggles a zero-width space in/out — see `revisionMarker`. */
const ZERO_WIDTH_SPACE = '​';

/**
 * D3 (audit M12): the single `aria-live` sink for `LiveAnnouncerService`.
 * Visually hidden (`sr-only`) — this is an announcement channel for
 * assistive tech, never a visible toast.
 *
 * MOUNTED ONCE, in the app shell (`apps/web/src/app/features/shell/**`,
 * inside `<main>`) — moved there at merge from its original home inside
 * `bank-list` (Line D didn't own the shell while this was built) so it
 * exists for every routed screen instead of only while `bank-list` happens
 * to be routed. A screen rendered OUTSIDE the shell — currently only
 * `/login` — has no sink: nothing calling `announce()` there would ever
 * reach assistive tech.
 */
@Component({
  selector: 'ui-live-region',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      data-testid="live-region"
      class="sr-only"
      [attr.role]="announcer.politeness() === 'assertive' ? 'alert' : 'status'"
      [attr.aria-live]="announcer.politeness()"
      aria-atomic="true"
    >
      {{ announcer.message() }}{{ revisionMarker() }}
    </div>
  `,
})
export class LiveRegionComponent {
  protected readonly announcer = inject(LiveAnnouncerService);

  /**
   * Audit #7: two consecutive identical `announce()` calls leave `message()`
   * at the same value, so this alone would never change the DOM text — and a
   * live region only re-announces when its text actually changes. Mixing in
   * an invisible marker that flips on every `revision()` bump (message
   * changed or not) guarantees the DOM node's content changes every time.
   */
  protected readonly revisionMarker = computed(() =>
    ZERO_WIDTH_SPACE.repeat(this.announcer.revision() % 2),
  );
}
