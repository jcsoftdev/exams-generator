import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { LiveAnnouncerService } from './live-announcer.service';

/**
 * D3 (audit M12): the single `aria-live` sink for `LiveAnnouncerService`.
 * Visually hidden (`sr-only`) — this is an announcement channel for
 * assistive tech, never a visible toast.
 *
 * MOUNT ONCE. Belongs in the app shell (one instance app-wide), but the
 * shell (`apps/web/src/app/shell/**`) is out of Line D's ownership — mounted
 * here inside `bank-list` instead so the service has a live sink to prove it
 * out, and exported so another line can drop `<ui-live-region>` into the
 * shell at merge and delete it from `bank-list`.
 */
@Component({
  selector: 'ui-live-region',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      data-testid="live-region"
      class="sr-only"
      role="status"
      [attr.aria-live]="announcer.politeness()"
      aria-atomic="true"
    >
      {{ announcer.message() }}
    </div>
  `,
})
export class LiveRegionComponent {
  protected readonly announcer = inject(LiveAnnouncerService);
}
