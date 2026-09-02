import { CanDeactivateFn } from '@angular/router';
import { BankNewComponent } from './bank-new.component';

/**
 * M7 (leave guard): warns before navigating away from `/app/bank/new` with
 * unsaved work — a half-reviewed AI extraction, a save in flight, or a
 * structured question the teacher started writing but never submitted.
 * Delegates the actual decision to `BankNewComponent.canDeactivate()` since
 * only the component knows its own dirty state; this guard is just the
 * router-facing adapter `CanDeactivateFn` requires.
 */
export const bankNewLeaveGuard: CanDeactivateFn<BankNewComponent> = (component) =>
  component.canDeactivate();
