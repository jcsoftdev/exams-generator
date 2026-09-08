import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { FeatureFlag, MeResponseDto, Role } from '@exams-generator/shared';
import { environment } from '../../../environments/environment';
import { FeatureFlagsStore } from './feature-flags.store';

function me(features: Partial<Record<FeatureFlag, boolean>>): MeResponseDto {
  return {
    id: 'u1',
    name: 'Ana',
    email: 'ana@colegio.pe',
    role: Role.Teacher,
    tenantId: 't1',
    features: {
      [FeatureFlag.GlobalBank]: false,
      [FeatureFlag.AiGeneration]: false,
      [FeatureFlag.AiExtraction]: false,
      [FeatureFlag.ExamVersions]: false,
      [FeatureFlag.TenantBranding]: false,
      ...features,
    },
  };
}

describe('FeatureFlagsStore', () => {
  let store: FeatureFlagsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    store = TestBed.inject(FeatureFlagsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('answers false for every flag before anything has loaded', () => {
    // Hiding until we know beats showing an entry and yanking it a moment
    // later, which reads as a bug rather than as loading.
    expect(store.isEnabled(FeatureFlag.AiGeneration)).toBe(false);
    expect(store.loaded()).toBe(false);
  });

  it('takes the flags off a /auth/me response the caller already had', () => {
    store.applyFrom(me({ [FeatureFlag.AiGeneration]: true }));

    expect(store.loaded()).toBe(true);
    expect(store.isEnabled(FeatureFlag.AiGeneration)).toBe(true);
    expect(store.isEnabled(FeatureFlag.ExamVersions)).toBe(false);
  });

  it('loads on its own for callers that run before the shell', () => {
    store.load();

    http
      .expectOne(`${environment.apiBaseUrl}/auth/me`)
      .flush(me({ [FeatureFlag.TenantBranding]: true }));

    expect(store.isEnabled(FeatureFlag.TenantBranding)).toBe(true);
  });

  it('does not re-request once it already has an answer', () => {
    store.applyFrom(me({}));

    store.load();

    // `expectNone` rather than a count: the point is that a filled store
    // costs nothing, so a second shell render never re-hits the API.
    http.expectNone(`${environment.apiBaseUrl}/auth/me`);
  });

  it('leaves everything hidden when the load fails', () => {
    store.load();

    http.expectOne(`${environment.apiBaseUrl}/auth/me`).error(new ProgressEvent('network error'));

    // The safe direction: a features call that failed must never open a
    // feature, and the API enforces each flag on its own regardless.
    expect(store.isEnabled(FeatureFlag.GlobalBank)).toBe(false);
  });
});
