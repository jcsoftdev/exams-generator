import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FeatureFlag, FeatureFlagsDto, MeResponseDto } from '@exams-generator/shared';
import { environment } from '../../../environments/environment';

/**
 * The signed-in user's effective feature flags, app-wide.
 *
 * This exists because the web had no shared identity store at all: the shell
 * called `GET /auth/me` once into a signal private to that component, and
 * everything else re-derived what it needed from the JWT. Flags cannot come
 * from the JWT — a token lives 8h and does not refresh, so a feature switched
 * off this morning would keep reading as on for the rest of the school day.
 *
 * A flag change therefore reaches the UI on the next FULL load, not on the
 * next navigation. That is a deliberate limit, not an oversight: the API
 * enforces every flag on its own, so a stale menu entry costs one honest 403,
 * never unauthorized access.
 */
@Injectable({ providedIn: 'root' })
export class FeatureFlagsStore {
  private readonly http = inject(HttpClient);
  private readonly flags = signal<FeatureFlagsDto | null>(null);

  /** `false` until `/auth/me` answers. Consumers hide rather than flash. */
  readonly loaded = computed(() => this.flags() !== null);

  /**
   * Feeds the store from a `/auth/me` response the caller already has, so
   * the shell's existing identity call doubles as the flag load instead of
   * costing a second request.
   */
  applyFrom(me: MeResponseDto): void {
    this.flags.set(me.features);
  }

  /**
   * For anything that needs flags BEFORE the shell has rendered — a route
   * guard, say. Idempotent: a store already filled stays as it is.
   */
  load(): void {
    if (this.flags() !== null) {
      return;
    }
    this.http.get<MeResponseDto>(`${environment.apiBaseUrl}/auth/me`).subscribe({
      next: (me) => this.applyFrom(me),
      // Same swallow as the shell's own `me()` call: a failed load leaves
      // every gated entry hidden, which is the safe direction.
      error: () => {},
    });
  }

  /**
   * Whether one feature is on. Answers `false` while the flags are still
   * loading — showing a menu entry and yanking it a moment later reads as a
   * bug, while a slightly late entry reads as loading.
   */
  isEnabled(flag: FeatureFlag): boolean {
    return this.flags()?.[flag] ?? false;
  }

  /** Only for tests that need to put the store in a known state. */
  reset(): void {
    this.flags.set(null);
  }
}
