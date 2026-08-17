import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { of, throwError } from 'rxjs';
import { DraftCountService } from './draft-count.service';
import { AiService } from './ai.service';

/**
 * `countDrafts()` (not `listDrafts()`) is the fetch under test here — the
 * badge only ever needs a number, never the actual draft rows. See
 * `ai.service.ts` `countDrafts()` doc for why sharing `listDrafts()` was the
 * bug: it downloaded every draft row just to call `.length` on it.
 */
function setup(countImpl?: () => unknown) {
  const countDrafts = vi.fn(countImpl ?? (() => of(2)));
  TestBed.configureTestingModule({
    providers: [{ provide: AiService, useValue: { countDrafts } }],
  });
  const service = TestBed.inject(DraftCountService);
  return { service, countDrafts };
}

describe('DraftCountService', () => {
  it('fetches the draft count once on construction', () => {
    const { service, countDrafts } = setup();
    expect(countDrafts).toHaveBeenCalledTimes(1);
    expect(service.count()).toBe(2);
  });

  it('leaves the count unset (null) if the initial fetch fails', () => {
    const { service } = setup(() => throwError(() => new Error('boom')));
    expect(service.count()).toBeNull();
  });

  it('allows the review queue to push a fresh count via set()', () => {
    const { service } = setup();
    service.set(5);
    expect(service.count()).toBe(5);
  });

  it('re-fetches the count via refresh()', () => {
    const { service, countDrafts } = setup();
    countDrafts.mockReturnValue(of(1));
    service.refresh();
    expect(countDrafts).toHaveBeenCalledTimes(2);
    expect(service.count()).toBe(1);
  });
});
